import { findByIds, type Device } from 'usb'
import type { DeviceInfo, NagaModel, WriteSupport } from './types'

export const RAZER_VENDOR_ID = 0x1532

interface NagaDeviceDefinition {
  model: NagaModel
  productId: number
  productName: string
  writeSupport: WriteSupport
}

const NAGA_DEVICES: readonly NagaDeviceDefinition[] = [
  {
    model: 'naga-trinity',
    productId: 0x0067,
    productName: 'Razer Naga Trinity',
    writeSupport: 'full',
  },
  {
    model: 'naga-pro-wired',
    productId: 0x008f,
    productName: 'Razer Naga Pro',
    writeSupport: 'buttons-only',
  },
]

export interface DetectedNagaDevice {
  device: Device
  definition: NagaDeviceDefinition
}

export const findSupportedNaga = (): DetectedNagaDevice | undefined => {
  for (const definition of NAGA_DEVICES) {
    const device = findByIds(RAZER_VENDOR_ID, definition.productId)
    if (device) return { device, definition }
  }
  return undefined
}

export const toDeviceInfo = (detected: DetectedNagaDevice | undefined): DeviceInfo => {
  if (!detected) {
    return { connected: false, interfaces: 0 }
  }

  const { device, definition } = detected
  return {
    connected: true,
    model: definition.model,
    writeSupport: definition.writeSupport,
    productName: definition.productName,
    manufacturer: 'Razer',
    vendorId: device.deviceDescriptor.idVendor,
    productId: device.deviceDescriptor.idProduct,
    interfaces: device.configDescriptor?.bNumInterfaces ?? 0,
  }
}

export const requireWritableNaga = (): DetectedNagaDevice => {
  const detected = findSupportedNaga()
  if (!detected) {
    throw new Error('No supported Razer Naga mouse found.')
  }

  if (detected.definition.writeSupport !== 'full') {
    throw new Error(
      `${detected.definition.productName} detected, but full hardware writes are not enabled for this model.`,
    )
  }

  return detected
}
