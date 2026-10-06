import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  systemPreferences,
  Tray,
} from 'electron'
import { join } from 'node:path'
import { applyHardwareProfile, applyRgbOnly, setRgbOff } from './nagaDriver'
import { findSupportedNaga, toDeviceInfo } from './nagaDevices'
import {
  applyNagaProDpiOnly,
  applyNagaProProfile,
  applyNagaProRgbOnly,
  applyNagaProScrollDirection,
  setNagaProRgbOff,
} from './nagaProDriver'
import { registerProfileShortcuts, unregisterAllMacroShortcuts } from './macroEngine'
import {
  deleteProfile,
  duplicateProfile,
  readStore,
  setActiveProfile,
  updateSettings,
  upsertProfile,
  writeStore,
} from './profileStore'
import type {
  AppSettings,
  ApplyResult,
  NagaProfile,
  ProfileStore,
  RgbSettings,
} from './types'

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)

const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR4nGNgGOzgPxRTpJksQ9A1k2QILs1EGUJIM15DiNWM0xCKDaDYC8QaQhSgSDMuQ8gCFGmmDwAAhdVTrfcfBBYAAAAASUVORK5CYII='

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let deviceWatchTimer: NodeJS.Timeout | null = null
let cachedRgbOffOnLock = true
let cachedReverseMouseScroll = true
let cachedAutoApplyOnConnect = true
let cachedLang: 'de' | 'en' = 'de'

const TRAY_STRINGS = {
  de: {
    openWindow: 'Fenster öffnen',
    reapplyProfile: 'Profil neu anwenden',
    launchAtLogin: 'Bei macOS-Login starten',
    reverseMouseScroll: 'Naga-Mausrad umkehren',
    autoApplyOnConnect: 'Profil beim Anschließen anwenden',
    rgbOffOnLock: 'RGB beim Sperren ausschalten',
    quit: 'Beenden',
  },
  en: {
    openWindow: 'Open window',
    reapplyProfile: 'Re-apply profile',
    launchAtLogin: 'Launch at macOS login',
    reverseMouseScroll: 'Reverse Naga mouse wheel',
    autoApplyOnConnect: 'Apply profile when Naga connects',
    rgbOffOnLock: 'Turn RGB off when screen locks',
    quit: 'Quit',
  },
} as const

const tx = () => TRAY_STRINGS[cachedLang]

const detectInitialLang = (stored: 'de' | 'en' | undefined): 'de' | 'en' => {
  if (stored === 'de' || stored === 'en') return stored
  const sys = app.getLocale().toLowerCase()
  return sys.startsWith('de') ? 'de' : 'en'
}

const refreshSettingsCache = async () => {
  const store = await readStore()
  cachedRgbOffOnLock = store.settings?.rgbOffOnLock !== false
  cachedReverseMouseScroll = store.settings?.reverseMouseScroll !== false
  cachedAutoApplyOnConnect = store.settings?.autoApplyOnConnect !== false
  cachedLang = detectInitialLang(store.settings?.language)
}

const scanNaga = () => toDeviceInfo(findSupportedNaga())

const applyProfileSafely = async (profile: NagaProfile): Promise<ApplyResult> => {
  const device = scanNaga()
  if (device.connected && device.model === 'naga-pro-wired') {
    return applyNagaProProfile(profile, cachedReverseMouseScroll)
  }
  if (device.connected && device.writeSupport !== 'full') {
    return {
      ok: false,
      message: `${device.productName ?? 'Razer Naga'} does not support profile writes yet.`,
    }
  }
  return applyHardwareProfile(profile)
}

const applyRgbSafely = async (rgb: RgbSettings): Promise<ApplyResult> => {
  const device = scanNaga()
  if (device.connected && device.model === 'naga-pro-wired') {
    return applyNagaProRgbOnly(rgb)
  }
  if (device.connected && device.writeSupport !== 'full') {
    return { ok: false, message: `${device.productName ?? 'Razer Naga'} RGB is not supported yet.` }
  }
  return applyRgbOnly(rgb)
}

const previewDpiSafely = async (x: number, y: number): Promise<ApplyResult> => {
  const device = scanNaga()
  if (device.connected && device.model === 'naga-pro-wired') {
    return applyNagaProDpiOnly(x, y)
  }
  return {
    ok: false,
    message: `${device.productName ?? 'Razer Naga'} live mouse-speed preview is not supported yet.`,
  }
}

const setRgbOffSafely = async (): Promise<ApplyResult> => {
  const device = scanNaga()
  if (device.connected && device.model === 'naga-pro-wired') {
    return setNagaProRgbOff()
  }
  if (device.connected && device.writeSupport !== 'full') {
    return { ok: false, message: `${device.productName ?? 'Razer Naga'} RGB is not supported yet.` }
  }
  return setRgbOff()
}

const createWindow = async () => {
  if (mainWindow) {
    mainWindow.show()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: 'Razer Naga Control',
    backgroundColor: '#0a0c0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
    app.dock?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
  mainWindow.show()
}

const showWindow = async () => {
  app.dock?.show()
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  } else {
    await createWindow()
  }
}

const updateRuntimeSettings = async (partial: Partial<AppSettings>) => {
  const next = await updateSettings(partial)
  cachedRgbOffOnLock = next.settings?.rgbOffOnLock !== false
  cachedReverseMouseScroll = next.settings?.reverseMouseScroll !== false
  cachedAutoApplyOnConnect = next.settings?.autoApplyOnConnect !== false
  cachedLang = detectInitialLang(next.settings?.language)
  tray?.setContextMenu(buildTrayMenu())
  return next.settings ?? { rgbOffOnLock: true }
}

const updateScrollDirection = async (enabled: boolean) => {
  await updateRuntimeSettings({ reverseMouseScroll: enabled })
  const device = scanNaga()
  if (device.connected && device.model === 'naga-pro-wired') {
    const result = await applyNagaProScrollDirection(enabled)
    console.log('[naga] scroll direction:', result.ok ? 'OK' : 'FAIL', '-', result.message)
  }
}

const buildTrayMenu = () => {
  const s = tx()
  return Menu.buildFromTemplate([
    {
      label: s.openWindow,
      click: () => {
        void showWindow()
      },
    },
    {
      label: s.reapplyProfile,
      click: () => {
        void applyActiveProfile()
      },
    },
    { type: 'separator' },
    {
      label: s.launchAtLogin,
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true })
      },
    },
    {
      label: s.autoApplyOnConnect,
      type: 'checkbox',
      checked: cachedAutoApplyOnConnect,
      click: (item) => {
        void updateRuntimeSettings({ autoApplyOnConnect: item.checked })
      },
    },
    {
      label: s.reverseMouseScroll,
      type: 'checkbox',
      checked: cachedReverseMouseScroll,
      click: (item) => {
        void updateScrollDirection(item.checked)
      },
    },
    {
      label: s.rgbOffOnLock,
      type: 'checkbox',
      checked: cachedRgbOffOnLock,
      click: (item) => {
        void updateRuntimeSettings({ rgbOffOnLock: item.checked })
      },
    },
    { type: 'separator' },
    {
      label: s.quit,
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

const ensureAccessibilityPermission = () => {
  if (process.platform !== 'darwin') return
  systemPreferences.isTrustedAccessibilityClient(true)
}

const createTray = () => {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Razer Naga Control')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', () => {
    void showWindow()
  })
}

const applyActiveProfile = async () => {
  const store = await readStore()
  const active = store.profiles.find((p) => p.id === store.activeProfileId)
  if (!active) return
  const hwResult = await applyProfileSafely(active)
  console.log('[naga] applyHardwareProfile:', hwResult.ok ? 'OK' : 'FAIL', '-', hwResult.message)
  if (!hwResult.ok) return
  const reg = registerProfileShortcuts(active)
  console.log('[naga] macroShortcuts:', reg)
}

const restoreActiveProfileRgb = async () => {
  const store = await readStore()
  const active = store.profiles.find((p) => p.id === store.activeProfileId)
  if (!active) return
  await new Promise((resolve) => setTimeout(resolve, 600))
  void applyRgbSafely(active.rgb)
}

const shouldDimOnLock = async () => {
  const store = await readStore()
  return store.settings?.rgbOffOnLock !== false
}

const registerPowerHandlers = () => {
  powerMonitor.on('lock-screen', () => {
    void shouldDimOnLock().then((dim) => {
      if (dim) void setRgbOffSafely()
    })
  })
  powerMonitor.on('unlock-screen', () => {
    void restoreActiveProfileRgb()
  })
  powerMonitor.on('suspend', () => {
    void shouldDimOnLock().then((dim) => {
      if (dim) void setRgbOffSafely()
    })
  })
  powerMonitor.on('resume', () => {
    void restoreActiveProfileRgb()
  })
}

const registerDeviceWatcher = () => {
  let wasConnected = scanNaga().connected
  deviceWatchTimer = setInterval(() => {
    const connected = scanNaga().connected
    if (connected && !wasConnected && cachedAutoApplyOnConnect) {
      console.log('[naga] mouse connected; applying saved profile')
      setTimeout(() => void applyActiveProfile(), 650)
    }
    wasConnected = connected
  }, 1500)
}

const configureFirstRunBackground = async () => {
  if (isDev) return
  const store = await readStore()
  if (store.settings?.autoLaunchConfigured === true) return
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })
  await updateSettings({ autoLaunchConfigured: true })
}

ipcMain.handle('device:scan', () => scanNaga())
ipcMain.handle('store:read', () => readStore())
ipcMain.handle('store:write', async (_event, store: ProfileStore) => writeStore(store))
ipcMain.handle('profile:upsert', async (_event, profile: NagaProfile) => upsertProfile(profile))
ipcMain.handle('profile:delete', async (_event, id: string) => deleteProfile(id))
ipcMain.handle('profile:duplicate', async (_event, id: string) => duplicateProfile(id))
ipcMain.handle('profile:set-active', async (_event, id: string) => setActiveProfile(id))
ipcMain.handle('profile:apply', async (_event, profile: NagaProfile) => {
  const result = await applyProfileSafely(profile)
  if (result.ok) {
    await upsertProfile(profile)
    await setActiveProfile(profile.id)
    const reg = registerProfileShortcuts(profile)
    console.log('[naga] macroShortcuts after apply:', reg)
  }
  return result
})
ipcMain.handle('rgb:preview', async (_event, rgb: RgbSettings) => applyRgbSafely(rgb))
ipcMain.handle('dpi:preview', async (_event, x: number, y: number) => previewDpiSafely(x, y))

ipcMain.handle('app:get-login-item', () => app.getLoginItemSettings().openAtLogin)
ipcMain.handle('app:set-login-item', (_event, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true })
  tray?.setContextMenu(buildTrayMenu())
  return app.getLoginItemSettings().openAtLogin
})
ipcMain.handle('app:hide-window', () => {
  mainWindow?.hide()
  app.dock?.hide()
})
ipcMain.handle('app:get-settings', async () => {
  const store = await readStore()
  return store.settings ?? { rgbOffOnLock: true }
})
ipcMain.handle('app:update-settings', async (_event, partial: Partial<AppSettings>) =>
  updateRuntimeSettings(partial),
)

app.whenReady().then(async () => {
  ensureAccessibilityPermission()
  await configureFirstRunBackground()
  await refreshSettingsCache()
  registerPowerHandlers()
  registerDeviceWatcher()
  createTray()

  const launchedHidden = app.getLoginItemSettings().wasOpenedAsHidden
  if (!launchedHidden) {
    await createWindow()
  } else {
    app.dock?.hide()
  }

  void applyActiveProfile()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  void showWindow()
})

app.on('before-quit', () => {
  isQuitting = true
  if (deviceWatchTimer) clearInterval(deviceWatchTimer)
  unregisterAllMacroShortcuts()
})
