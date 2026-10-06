import type { Device } from 'usb'
import { findSupportedNaga } from './nagaDevices'
import type { ApplyResult, ButtonBinding, NagaProfile } from './types'

const REPORT_LEN = 90
const SET_REPORT_REQUEST_TYPE = 0x21
const SET_REPORT_REQUEST = 0x09
const SET_REPORT_VALUE = 0x0300
const TX = 0x1f
const DIRECT_PROFILE = 0x00
const WHEEL_TILT_LEFT_SLOT = 0x34
const WHEEL_TILT_RIGHT_SLOT = 0x35
const HORIZONTAL_SCROLL_LEFT_BUTTON = 0x09
const HORIZONTAL_SCROLL_RIGHT_BUTTON = 0x0a
const DEFAULT_TURBO_RATE = 0x8e

const MODIFIER_BITS: Record<string, number> = {
  CTRL: 0x01,
  CONTROL: 0x01,
  SHIFT: 0x02,
  ALT: 0x04,
  OPTION: 0x04,
  CMD: 0x08,
  COMMAND: 0x08,
  META: 0x08,
  GUI: 0x08,
}

let tiltQueue: Promise<void> = Promise.resolve()

const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = tiltQueue
  let release!: () => void
  tiltQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

const createReport = () => {
  const report = Buffer.alloc(REPORT_LEN)
  report[0] = 0x00
  report[1] = TX
  report[5] = 0x0a
  report[6] = 0x02
  report[7] = 0x0c
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
  if (key === 'ENTER' || key === 'RETURN') return 0x28
  if (key === 'ESC' || key === 'ESCAPE') return 0x29
  if (key === 'BACKSPACE') return 0x2a
  if (key === 'TAB') return 0x2b
  if (key === 'SPACE') return 0x2c
  if (key === 'RIGHT' || key === 'ARROWRIGHT') return 0x4f
  if (key === 'LEFT' || key === 'ARROWLEFT') return 0x50
  if (key === 'DOWN' || key === 'ARROWDOWN') return 0x51
  if (key === 'UP' || key === 'ARROWUP') return 0x52

  return undefined
}

const parseKeyChord = (value: string): { modifiers: number; hidUsage: number } | undefined => {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return undefined

  const keyPart = parts.at(-1)
  if (!keyPart) return undefined
  const hidUsage = hidForKey(keyPart)
  if (hidUsage === undefined) return undefined

  let modifiers = 0
  for (const modifier of parts.slice(0, -1)) {
    const bit = MODIFIER_BITS[modifier.toUpperCase()]
    if (bit === undefined) return undefined
    modifiers |= bit
  }

  return { modifiers, hidUsage }
}

const writeFunctionBlock = async (device: Device, slot: number, block: readonly number[]) => {
  const report = createReport()
  report[8] = DIRECT_PROFILE
  report[9] = slot
  report[10] = 0x00
  block.slice(0, 7).forEach((value, index) => {
    report[11 + index] = value
  })
  await controlSetReport(device, report)
}

const writeKeyboardBinding = async (
  device: Device,
  slot: number,
  modifiers: number,
  hidUsage: number,
) =>
  writeFunctionBlock(device, slot, [0x02, 0x02, modifiers & 0xff, hidUsage & 0xff, 0, 0, 0])

const writeDisabledBinding = async (device: Device, slot: number) =>
  writeFunctionBlock(device, slot, [0, 0, 0, 0, 0, 0, 0])

const writeDefaultHorizontalScroll = async (
  device: Device,
  slot: number,
  buttonId: number,
) =>
  writeFunctionBlock(device, slot, [0x0e, 0x03, buttonId, 0x00, DEFAULT_TURBO_RATE, 0x00, 0x00])

const applyTiltBinding = async (
  device: Device,
  binding: ButtonBinding | undefined,
  slot: number,
  defaultButtonId: number,
) => {
  if (binding?.action === 'disabled') {
    await writeDisabledBinding(device, slot)
    return
  }

  if (binding?.action === 'key') {
    const chord = parseKeyChord(binding.value)
    if (chord) {
      await writeKeyboardBinding(device, slot, chord.modifiers, chord.hidUsage)
      return
    }
  }

  await writeDefaultHorizontalScroll(device, slot, defaultButtonId)
}

export const applyNagaProWheelTilt = async (profile: NagaProfile): Promise<ApplyResult> => {
  try {
    await serialize(async () => {
      const device = openNagaPro()
      try {
        const left = profile.buttons.find((binding) => binding.id === 'base-6')
        const right = profile.buttons.find((binding) => binding.id === 'base-7')

        await applyTiltBinding(
          device,
          left,
          WHEEL_TILT_LEFT_SLOT,
          HORIZONTAL_SCROLL_LEFT_BUTTON,
        )
        await wait(12)
        await applyTiltBinding(
          device,
          right,
          WHEEL_TILT_RIGHT_SLOT,
          HORIZONTAL_SCROLL_RIGHT_BUTTON,
        )
      } finally {
        closeDevice(device)
      }
    })

    return {
      ok: true,
      message: 'Naga Pro wheel-tilt bindings applied.',
      stage: 'complete',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown Naga Pro wheel-tilt error.',
    }
  }
}
