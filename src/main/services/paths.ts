import { homedir, platform } from 'os'
import { join } from 'path'
import type { ClientFormat } from '../../shared/types'

export interface ClientLocation {
  id: string
  name: string
  format: ClientFormat
  /** Candidate config paths, in priority order (first existing wins for reads). */
  candidates: string[]
  processHints: string[]
}

const home = homedir()
const plat = platform() // 'win32' | 'darwin' | 'linux'

function appData(): string {
  if (plat === 'win32') return process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  if (plat === 'darwin') return join(home, 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(home, '.config')
}

/**
 * Known MCP-capable clients and where each stores its global MCP config on the
 * current OS. Project-scoped configs (e.g. .vscode/mcp.json) are intentionally
 * out of scope for v1 — we manage user/global configs.
 */
export function knownClientLocations(): ClientLocation[] {
  const ad = appData()

  const claudeDesktop =
    plat === 'win32' || plat === 'darwin'
      ? join(ad, 'Claude', 'claude_desktop_config.json')
      : join(ad, 'Claude', 'claude_desktop_config.json')

  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      format: 'claude-desktop',
      candidates: [claudeDesktop],
      processHints: plat === 'win32' ? ['Claude.exe'] : ['Claude']
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      format: 'claude-code',
      candidates: [join(home, '.claude.json'), join(home, '.claude', 'mcp.json')],
      processHints: ['claude']
    },
    {
      id: 'cursor',
      name: 'Cursor',
      format: 'cursor',
      candidates: [join(home, '.cursor', 'mcp.json')],
      processHints: plat === 'win32' ? ['Cursor.exe'] : ['Cursor']
    },
    {
      id: 'vscode',
      name: 'VS Code',
      format: 'vscode',
      candidates: [join(ad, 'Code', 'User', 'mcp.json')],
      processHints: plat === 'win32' ? ['Code.exe'] : ['Code', 'code']
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      format: 'windsurf',
      candidates: [join(home, '.codeium', 'windsurf', 'mcp_config.json')],
      processHints: plat === 'win32' ? ['Windsurf.exe'] : ['Windsurf']
    },
    {
      id: 'continue',
      name: 'Continue',
      format: 'continue',
      candidates: [join(home, '.continue', 'config.json')],
      processHints: []
    },
    {
      id: 'zed',
      name: 'Zed',
      format: 'zed',
      candidates: [join(ad, 'Zed', 'settings.json'), join(home, '.config', 'zed', 'settings.json')],
      processHints: plat === 'win32' ? ['Zed.exe'] : ['zed', 'Zed']
    }
  ]
}

/** Directory where we keep config backups. */
export function defaultBackupDir(userDataDir: string): string {
  return join(userDataDir, 'backups')
}
