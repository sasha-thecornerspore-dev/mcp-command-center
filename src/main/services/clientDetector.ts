import { existsSync, readFileSync } from 'fs'
import type { DetectedClient } from '../../shared/types'
import { getAdapter, parseConfig } from './clientAdapters'
import { knownClientLocations, type ClientLocation } from './paths'

/** Pick the first existing candidate path, else the first candidate (write target). */
function resolveConfigPath(loc: ClientLocation): { path: string; exists: boolean } {
  for (const c of loc.candidates) {
    if (existsSync(c)) return { path: c, exists: true }
  }
  return { path: loc.candidates[0], exists: false }
}

/** A client is considered "installed" if its config exists OR its parent dir exists. */
function looksInstalled(loc: ClientLocation, configExists: boolean): boolean {
  if (configExists) return true
  // Heuristic: presence of the app's config directory.
  return loc.candidates.some((c) => {
    const dir = c.replace(/[\\/][^\\/]+$/, '')
    return existsSync(dir)
  })
}

export function detectClients(): DetectedClient[] {
  return knownClientLocations().map((loc) => {
    const { path, exists } = resolveConfigPath(loc)
    const warnings: string[] = []
    let servers: DetectedClient['servers'] = []

    if (exists) {
      try {
        const text = readFileSync(path, 'utf8')
        const config = parseConfig(text)
        servers = getAdapter(loc.format).extract(config)
      } catch (err) {
        warnings.push(`Could not parse ${path}: ${(err as Error).message}`)
      }
    }

    return {
      id: loc.id,
      name: loc.name,
      format: loc.format,
      configPath: path,
      installed: looksInstalled(loc, exists),
      configExists: exists,
      servers,
      processHints: loc.processHints,
      warnings: warnings.length ? warnings : undefined
    }
  })
}
