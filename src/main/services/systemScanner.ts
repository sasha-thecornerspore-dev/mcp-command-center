import { existsSync } from 'fs'
import { execSync } from 'child_process'
import { platform } from 'os'
import type { ScanFinding, ServerSpec } from '../../shared/types'
import type { Catalog } from './catalog'

/** Is an executable resolvable on PATH? (cross-platform, never throws) */
function onPath(bin: string): boolean {
  try {
    const cmd = platform() === 'win32' ? `where ${bin}` : `command -v ${bin}`
    execSync(cmd, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

interface Probe {
  toolId: string
  toolName: string
  /** Returns evidence string if detected, else null. */
  detect: () => string | null
  /** Catalog server id this tool maps to. */
  serverId: string
}

const PROBES: Probe[] = [
  {
    toolId: 'node',
    toolName: 'Node.js / npx (Filesystem + Fetch)',
    serverId: 'filesystem',
    detect: () => (onPath('node') ? 'node found on PATH' : null)
  },
  {
    toolId: 'git',
    toolName: 'Git',
    serverId: 'git',
    detect: () => (onPath('git') ? 'git found on PATH' : null)
  },
  {
    toolId: 'gh',
    toolName: 'GitHub CLI',
    serverId: 'github',
    detect: () => (onPath('gh') ? 'gh (GitHub CLI) found on PATH' : null)
  },
  {
    toolId: 'docker',
    toolName: 'Docker',
    serverId: 'fetch',
    detect: () => (onPath('docker') ? 'docker found on PATH' : null)
  },
  {
    toolId: 'psql',
    toolName: 'PostgreSQL client',
    serverId: 'postgres',
    detect: () => (onPath('psql') ? 'psql found on PATH' : null)
  },
  {
    toolId: 'sqlite',
    toolName: 'SQLite',
    serverId: 'sqlite',
    detect: () => (onPath('sqlite3') ? 'sqlite3 found on PATH' : null)
  }
]

/**
 * Inspect the machine for tools that have a known MCP server and propose wiring
 * them. Pure detection — produces suggestions, never changes anything.
 */
export function scanSystem(catalog: Catalog): ScanFinding[] {
  const findings: ScanFinding[] = []
  for (const probe of PROBES) {
    const evidence = probe.detect()
    if (!evidence) continue
    const server: ServerSpec | undefined = catalog.byId(probe.serverId)
    if (!server) continue
    findings.push({ toolId: probe.toolId, toolName: probe.toolName, evidence, server })
  }
  return findings
}

/** Best-effort check that a user's home directory exists (sanity probe). */
export function homeReachable(home: string): boolean {
  return existsSync(home)
}
