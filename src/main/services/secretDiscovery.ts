import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { DetectedClient, KeyDiscoverySources, SecretCandidate } from '../../shared/types'

function mask(value: string): string {
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

/** Our own deferred-key placeholder — never offer it back as a candidate. */
function isPlaceholder(v: string): boolean {
  return v.startsWith('<SET:')
}

/** Parse simple KEY=value lines from a .env file; returns the value for `key`. */
function valueFromEnvFile(path: string, key: string): string | null {
  if (!existsSync(path)) return null
  try {
    for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      if (line.slice(0, eq).trim() !== key) continue
      let v = line.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1)
      }
      return v || null
    }
  } catch {
    /* ignore unreadable file */
  }
  return null
}

/**
 * Finds candidate values for required secret keys from user-permitted sources.
 * Raw values are kept in-process and addressed by an opaque candidateId, so the
 * renderer only ever sees a masked preview and the source — never the secret.
 */
export class SecretDiscovery {
  private cache = new Map<string, string>()

  constructor(private clients: () => DetectedClient[]) {}

  discover(keys: string[], sources: KeyDiscoverySources): Record<string, SecretCandidate[]> {
    this.cache.clear()
    const out: Record<string, SecretCandidate[]> = {}

    for (const key of keys) {
      const candidates: SecretCandidate[] = []
      const seen = new Set<string>()
      const add = (value: string | null | undefined, source: string): void => {
        if (!value || isPlaceholder(value) || seen.has(value)) return
        seen.add(value)
        const candidateId = `${key}#${candidates.length}`
        this.cache.set(candidateId, value)
        candidates.push({ candidateId, source, preview: mask(value) })
      }

      if (sources.appEnv) add(process.env[key], 'app environment')

      if (sources.otherClients) {
        for (const client of this.clients()) {
          for (const server of client.servers) {
            add(server.env?.[key], `${client.name} config`)
          }
        }
      }

      if (sources.envFiles) {
        for (const file of [join(homedir(), '.env'), join(process.cwd(), '.env')]) {
          add(valueFromEnvFile(file, key), file)
        }
      }

      out[key] = candidates
    }
    return out
  }

  /** Resolve a candidateId from the most recent discover() call to its raw value. */
  resolve(candidateId: string): string | undefined {
    return this.cache.get(candidateId)
  }
}
