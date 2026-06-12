import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// SecretStore imports electron; stub safeStorage so the b64 fallback path runs.
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { SecretStore } from '../src/main/services/secrets'

describe('SecretStore identity extensions', () => {
  let dir: string
  let store: SecretStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-sec-'))
    store = new SecretStore(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('deletes a key and persists the deletion', () => {
    store.set('identity:opnsense:root:KEY', 'v1')
    expect(store.has('identity:opnsense:root:KEY')).toBe(true)
    store.delete('identity:opnsense:root:KEY')
    expect(store.has('identity:opnsense:root:KEY')).toBe(false)
    // a fresh instance reads the persisted file
    const reloaded = new SecretStore(dir)
    expect(reloaded.has('identity:opnsense:root:KEY')).toBe(false)
  })

  it('lists keys by prefix', () => {
    store.set('identity:opnsense:root:A', '1')
    store.set('identity:opnsense:root:B', '2')
    store.set('identity:opnsense:sasha:A', '3')
    store.set('OTHER', '4')
    expect(store.keysWithPrefix('identity:opnsense:root:').sort()).toEqual([
      'identity:opnsense:root:A',
      'identity:opnsense:root:B'
    ])
  })

  it('deleting an absent key does not create or touch the secrets file', () => {
    store.delete('never-set')
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false)
  })

  it('has() reports empty-string values as present', () => {
    store.set('EMPTY', '')
    expect(store.has('EMPTY')).toBe(true)
  })
})
