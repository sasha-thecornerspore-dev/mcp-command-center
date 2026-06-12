import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'

const API_KEY = 'ANTHROPIC_API_KEY'

/**
 * Secret store backed by Electron safeStorage (OS-provided encryption — DPAPI on
 * Windows, Keychain on macOS). Values are never written to client configs or to
 * disk in plaintext. If OS encryption is unavailable we fall back to base64 with
 * a clear in-memory warning rather than refusing to function.
 */
export class SecretStore {
  private file: string
  private cache: Record<string, string> = {}

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'secrets.json')
    this.load()
  }

  private encrypt(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(value).toString('base64')
    }
    return 'b64:' + Buffer.from(value, 'utf8').toString('base64')
  }

  private decrypt(stored: string): string {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf8')
    }
    return stored
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>
      for (const [k, v] of Object.entries(raw)) this.cache[k] = this.decrypt(v)
    } catch {
      this.cache = {}
    }
  }

  private persist(): void {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.cache)) out[k] = this.encrypt(v)
    writeFileSync(this.file, JSON.stringify(out, null, 2), 'utf8')
  }

  set(key: string, value: string): void {
    this.cache[key] = value
    this.persist()
  }

  get(key: string): string | undefined {
    return this.cache[key]
  }

  has(key: string): boolean {
    return Boolean(this.cache[key])
  }

  delete(key: string): void {
    delete this.cache[key]
    this.persist()
  }

  keysWithPrefix(prefix: string): string[] {
    return Object.keys(this.cache).filter((k) => k.startsWith(prefix))
  }

  /** Resolve a set of keys into a plain map (for injection at apply time). */
  resolve(keys: string[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const k of keys) {
      const v = this.cache[k]
      if (v != null) out[k] = v
    }
    return out
  }

  setApiKey(value: string): void {
    this.set(API_KEY, value)
  }

  getApiKey(): string | undefined {
    return this.get(API_KEY)
  }

  hasApiKey(): boolean {
    return this.has(API_KEY)
  }
}
