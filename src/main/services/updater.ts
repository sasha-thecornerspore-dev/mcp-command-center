import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import type { UpdateCheckFrequency, UpdateStatus } from '../../shared/types'

export class UpdaterService {
  private status: UpdateStatus = { phase: 'idle' }
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly getWindow: () => BrowserWindow | null

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => this.push({ phase: 'checking' }))
    autoUpdater.on('update-available', (info) =>
      this.push({ phase: 'downloading', version: info.version, percent: 0 })
    )
    autoUpdater.on('update-not-available', () => this.push({ phase: 'idle' }))
    autoUpdater.on('download-progress', (p) =>
      this.push({ phase: 'downloading', percent: Math.round(p.percent), version: this.status.version })
    )
    autoUpdater.on('update-downloaded', (info) =>
      this.push({ phase: 'ready', version: info.version })
    )
    autoUpdater.on('error', (e: Error) =>
      this.push({ phase: 'error', error: e.message })
    )
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  check(): void {
    autoUpdater.checkForUpdates().catch((e: Error) =>
      this.push({ phase: 'error', error: e.message })
    )
  }

  install(): void {
    autoUpdater.quitAndInstall()
  }

  scheduleChecks(frequency: UpdateCheckFrequency): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (frequency === 'never') return
    this.check()
    if (frequency === 'launch') return
    const ms = frequency === 'daily' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    this.timer = setInterval(() => this.check(), ms)
  }

  private push(status: UpdateStatus): void {
    this.status = status
    this.getWindow()?.webContents.send('updater:status', status)
  }
}
