import type { Device } from 'usb'
import { findSupportedNaga } from './nagaDevices'
import type {
  ApplyResult,
  ButtonBinding,
  NagaProfile,
  PollingRate,
  RgbSettings,
} from './types'

const REPORT_LEN = 90
const SET_REPORT_REQUEST_TYPE = 0x21
const SET_REPORT_REQUEST = 0x09
const SET_REPORT_VALUE = 0x0300
const TX = 0x1f
const DIRECT_PROFILE = 0x00
const SIDE_BUTTON_BASE = 0x40
const VARSTORE = 0x01
const LED_SCROLL = 0x01
const LED_LOGO = 0x04

const F13_TO_F24_HID: readonly number[] = [
  0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73,
]

const FACTORY_SIDE_HID: readonly number[] = [
  0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e,
]

const POLLING_BYTE: Record<PollingRate, number> = {
  125: 0x08,
  500: 0x02,
  1000: 0x01,
}

let ioQueue: Promise<void> = Promise.resolve()

const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = ioQueue
  let release!: () => void
  ioQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

const createReport = (commandClass: number, commandId: number, dataSize: number) => {
  const report = Buffer.alloc(REPORT_LEN)
  report[0] = 0x00
  report[1] = TX
  report[5] = dataSize
  report[6] = commandClass
  report[7] = commandId
  return report
}

const setCrc = (report: Buffer) => {
  let crc = 0
  for (let index = 2; index < 88; index += 1) crc ^= report[index]
  report[88] = crc
}

const controlSetReport = (device: Device, report: Buffer) =>
  new Promise<void>((resolve, reject) => {
    setCrc(report)
    device.controlTransfer(
      SET_REPORT_REQUEST_TYPE,
      SET_REPORT_REQUEST,
      SET_REPORT_VALUE,
      0x00,
      report,
      (error) => (error ? reject(error) : resolve()),
    )
  })

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const openNagaPro = (): Device => {
  const detected = findSupportedNaga()
  if (!detected || detected.definition.model !== 'naga-pro-wired') {
    throw new Error('Razer Naga Pro not found.')
  }
  detected.device.open()
  return detected.device
}

const closeDevice = (device: Device) => {
  try {
    device.close()
  } catch {
    // already closed
  }
}

const withNagaPro = async <T>(operation: (device: Device) => Promise<T>): Promise<T> =>
  serialize(async () => {
    const device = openNagaPro()
    try {
      return await operation(device)
    } finally {
      closeDevice(device)
    }
  })

const hidForKey = (value: string): number | undefined => {
  const key = value.trim().toUpperCase()

  const fMatch = /^F(\d{1,2})$/.exec(key)
  if (fMatch) {
    const number = Number(fMatch[1])
    if (number >= 1 && number <= 12) return 0x3a + number - 1
    if (number >= 13 && number <= 24) return 0x68 + number - 13
  }

  if (/^[A-Z]$/.test(key)) return 0x04 + key.charCodeAt(0) - 65
  if (/^[1-9]$/.test(key)) return 0x1e + Number(key) - 1
  if (key === '0') return 0x27
  if (key === '-' || key === 'MINUS') return 0x2d
  if (key === '=' || key === 'EQUAL') return 0x2e
  if (key === 'ENTER') return 0x28
  if (key === 'ESC' || key === 'ESCAPE') return 0x29
  if (key === 'BACKSPACE') return 0x2a
  if (key === 'TAB') return 0x2b
  if (key === 'SPACE') return 0x2c

  return undefined
}

const getSideBinding = (profile: NagaProfile, index: number): ButtonBinding | undefined =>
  profile.buttons.find((binding) => binding.id === `side-${index + 1}`)

const writeKeyboardBinding = async (
  device: Device,
  buttonIndex: number,
  hidUsage: number,
) => {
  const report = createReport(0x02, 0x0c, 0x0a)
  report[8] = DIRECT_PROFILE
  report[9] = SIDE_BUTTON_BASE + buttonIndex
  report[10] = 0x00
  report[11] = 0x02
  report[12] = 0x02
  report[13] = 0x00
  report[14] = hidUsage
  await controlSetReport(device, report)
}

const writeDisabledBinding = async (device: Device, buttonIndex: number) => {
  const report = createReport(0x02, 0x0c, 0x0a)
  report[8] = DIRECT_PROFILE
  report[9] = SIDE_BUTTON_BASE + buttonIndex
  report[10] = 0x00
  report[11] = 0x00
  report[12] = 0x00
  await controlSetReport(device, report)
}

const resolveBinding = (
  profile: NagaProfile,
  index: number,
): { disabled: true } | { disabled: false; hidUsage: number } => {
  const binding = getSideBinding(profile, index)

  if (binding?.action === 'disabled') return { disabled: true }
  if (binding?.action === 'macro') {
    return { disabled: false, hidUsage: F13_TO_F24_HID[index] }
  }
  if (binding?.action === 'key') {
    const usage = hidForKey(binding.value)
    if (usage !== undefined) return { disabled: false, hidUsage: usage }
  }

  return { disabled: false, hidUsage: FACTORY_SIDE_HID[index] }
}

const applyButtons = async (device: Device, profile: NagaProfile) => {
  if (profile.sidePlate !== 'twelve') {
    throw new Error('Naga Pro button writes currently support the 12-button MMO side plate only.')
  }

  for (let index = 0; index < 12; index += 1) {
    const resolved = resolveBinding(profile, index)
    if (resolved.disabled) {
      await writeDisabledBinding(device, index)
    } else {
      await writeKeyboardBinding(device, index, resolved.hidUsage)
    }
    await wait(12)
  }
}

interface Rgb {
  r: number
  g: number
  b: number
}

const parseHexColor = (color: string): Rgb => {
  const value = color.replace('#', '').trim()
  const safe = /^[0-9a-fA-F]{6}$/.test(value) ? value : '00ff66'
  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16),
  }
}

const setBrightness = async (device: Device, ledId: number, brightness: number) => {
  const report = createReport(0x0f, 0x04, 0x03)
  report[8] = VARSTORE
  report[9] = ledId
  report[10] = Math.max(0, Math.min(255, Math.round((brightness / 100) * 255)))
  await controlSetReport(device, report)
}

const setEffect = async (
  device: Device,
  ledId: number,
  rgb: RgbSettings,
  color: Rgb,
) => {
  let payload: number[]

  switch (rgb.effect) {
    case 'off':
      payload = [VARSTORE, ledId, 0x00, 0x00, 0x00, 0x00]
      break
    case 'static':
      payload = [VARSTORE, ledId, 0x01, 0x00, 0x00, 0x01, color.r, color.g, color.b]
      break
    case 'breathing':
      payload = [VARSTORE, ledId, 0x02, 0x01, 0x00, 0x01, color.r, color.g, color.b]
      break
    case 'spectrum':
      payload = [VARSTORE, ledId, 0x03, 0x00, 0x00, 0x00]
      break
    case 'wave':
      payload = [VARSTORE, ledId, 0x04, rgb.waveDirection === 'right' ? 0x01 : 0x02, 0x28, 0x00]
      break
    case 'reactive':
      payload = [
        VARSTORE,
        ledId,
        0x05,
        0x00,
        Math.max(1, Math.min(4, rgb.reactiveSpeed)),
        0x01,
        color.r,
        color.g,
        color.b,
      ]
      break
  }

  const report = createReport(0x0f, 0x02, payload.length)
  payload.forEach((value, index) => {
    report[8 + index] = value
  })
  await controlSetReport(device, report)
}

const applyRgb = async (device: Device, rgb: RgbSettings) => {
  const master = parseHexColor(rgb.color)
  const targets = [
    { ledId: LED_SCROLL, zone: rgb.zones.scroll },
    { ledId: LED_LOGO, zone: rgb.zones.logo },
  ]

  for (const target of targets) {
    await setBrightness(device, target.ledId, rgb.brightness)
    await wait(10)
    if (!target.zone.enabled) {
      await setEffect(device, target.ledId, { ...rgb, effect: 'off' }, master)
    } else {
      const color = rgb.syncZones ? master : parseHexColor(target.zone.color)
      await setEffect(device, target.ledId, rgb, color)
    }
    await wait(12)
  }
}

const applyDpi = async (device: Device, profile: NagaProfile) => {
  const stages = profile.dpi.stages.slice(0, 5)
  if (stages.length === 0) return

  const report = createReport(0x04, 0x06, 0x26)
  report[8] = 0x00
  report[9] = Math.max(1, Math.min(stages.length, profile.dpi.activeStage))
  report[10] = stages.length

  stages.forEach((stage, index) => {
    const x = Math.max(100, Math.min(20000, Math.round(stage.x)))
    const y = Math.max(100, Math.min(20000, Math.round(stage.y)))
    const base = 11 + index * 7
    report[base] = index + 1
    report[base + 1] = (x >> 8) & 0xff
    report[base + 2] = x & 0xff
    report[base + 3] = (y >> 8) & 0xff
    report[base + 4] = y & 0xff
    report[base + 5] = 0x00
    report[base + 6] = 0x00
  })

  await controlSetReport(device, report)
}

const applyPolling = async (device: Device, rate: PollingRate) => {
  const report = createReport(0x00, 0x05, 0x01)
  report[8] = POLLING_BYTE[rate]
  await controlSetReport(device, report)
}

const resultFromError = (error: unknown): ApplyResult => ({
  ok: false,
  message: error instanceof Error ? error.message : 'Unknown Naga Pro USB error.',
})

export const applyNagaProProfile = async (profile: NagaProfile): Promise<ApplyResult> => {
  try {
    await withNagaPro(async (device) => {
      await applyRgb(device, profile.rgb)
      await applyDpi(device, profile)
      await wait(12)
      await applyPolling(device, profile.pollingRate)
      await wait(12)
      await applyButtons(device, profile)
    })
    return {
      ok: true,
      message: 'Naga Pro profile applied.',
      stage: 'complete',
    }
  } catch (error) {
    return resultFromError(error)
  }
}

export const applyNagaProButtons = async (profile: NagaProfile): Promise<ApplyResult> => {
  try {
    await withNagaPro((device) => applyButtons(device, profile))
    return {
      ok: true,
      message: 'Naga Pro 12-button plate bindings applied to the volatile profile.',
      stage: 'complete',
    }
  } catch (error) {
    return resultFromError(error)
  }
}

export const applyNagaProRgbOnly = async (rgb: RgbSettings): Promise<ApplyResult> => {
  try {
    await withNagaPro((device) => applyRgb(device, rgb))
    return { ok: true, message: 'Naga Pro RGB applied.', stage: 'rgb' }
  } catch (error) {
    return resultFromError(error)
  }
}

export const setNagaProRgbOff = async (): Promise<ApplyResult> => {
  try {
    await withNagaPro(async (device) => {
      const off: RgbSettings = {
        effect: 'off',
        color: '#000000',
        secondaryColor: '#000000',
        brightness: 0,
        waveDirection: 'right',
        reactiveSpeed: 2,
        syncZones: true,
        zones: {
          logo: { enabled: true, color: '#000000' },
          scroll: { enabled: true, color: '#000000' },
          side: { enabled: false, color: '#000000' },
        },
      }
      await applyRgb(device, off)
    })
    return { ok: true, message: 'Naga Pro RGB off.', stage: 'rgb' }
  } catch (error) {
    return resultFromError(error)
  }
}
