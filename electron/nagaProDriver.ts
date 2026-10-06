import type { Device } from 'usb'
import { findSupportedNaga } from './nagaDevices'
import type { ApplyResult, ButtonBinding, NagaProfile } from './types'

const REPORT_LEN = 90
const SET_REPORT_REQUEST_TYPE = 0x21
const SET_REPORT_REQUEST = 0x09
const SET_REPORT_VALUE = 0x0300
const TX_BUTTONS = 0x1f
const DIRECT_PROFILE = 0x00
const SIDE_BUTTON_BASE = 0x40

const F13_TO_F24_HID: readonly number[] = [
  0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73,
]

const FACTORY_SIDE_HID: readonly number[] = [
  0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2d, 0x2e,
]

const createReport = (commandClass: number, commandId: number, dataSize: number) => {
  const report = Buffer.alloc(REPORT_LEN)
  report[0] = 0x00
  report[1] = TX_BUTTONS
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
  setCrc(report)
  await controlSetReport(device, report)
}

const writeDisabledBinding = async (device: Device, buttonIndex: number) => {
  const report = createReport(0x02, 0x0c, 0x0a)
  report[8] = DIRECT_PROFILE
  report[9] = SIDE_BUTTON_BASE + buttonIndex
  report[10] = 0x00
  report[11] = 0x00
  report[12] = 0x00
  setCrc(report)
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

export const applyNagaProButtons = async (profile: NagaProfile): Promise<ApplyResult> => {
  if (profile.sidePlate !== 'twelve') {
    return {
      ok: false,
      message: 'Naga Pro button writes currently support the 12-button MMO side plate only.',
    }
  }

  let device: Device | undefined
  try {
    device = openNagaPro()

    for (let index = 0; index < 12; index += 1) {
      const resolved = resolveBinding(profile, index)
      if (resolved.disabled) {
        await writeDisabledBinding(device, index)
      } else {
        await writeKeyboardBinding(device, index, resolved.hidUsage)
      }
      await wait(20)
    }

    return {
      ok: true,
      message: 'Naga Pro 12-button plate bindings applied to the volatile profile.',
      stage: 'complete',
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown Naga Pro USB error.',
    }
  } finally {
    if (device) closeDevice(device)
  }
}
