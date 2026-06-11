import { app, BrowserWindow, Tray, Menu, nativeImage, shell } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { registerIpc } from './ipc'
import { Services, resolveBundledRegistry } from './services'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function iconPath(): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'registry', '..', 'icon.png')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function createWindow(): void {
  const ic = iconPath()
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0e14',
    title: 'MCP Command Center',
    icon: ic ?? undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Hide-to-tray on close (keeps trend watching alive in the background).
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const ic = iconPath()
  const image = ic ? nativeImage.createFromPath(ic).resize({ width: 18, height: 18 }) : nativeImage.createEmpty()
  tray = new Tray(image)
  tray.setToolTip('MCP Command Center')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Command Center', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showWindow())
}

function showWindow(): void {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
}

app.whenReady().then(() => {
  const services = new Services({
    userData: app.getPath('userData'),
    bundledRegistry: resolveBundledRegistry(app.getAppPath(), process.resourcesPath)
  })
  registerIpc(services)

  createWindow()
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

// Keep running in tray on Windows/Linux; standard macOS behavior otherwise.
app.on('window-all-closed', () => {
  // Intentionally do nothing: app lives in the tray until explicitly quit.
})
