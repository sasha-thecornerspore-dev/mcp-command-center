import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store } from '../src/main/services/store'
import type { ServerIdentityConfig } from '../src/shared/types'

const CFG: ServerIdentityConfig = {
  serverId: 'opnsense',
  activeIdentityId: 'sasha',
  identities: [
    { id: 'sasha', label: 'sasha' },
    { id: 'root', label: 'root' }
  ]
}

describe('Store identity configs', () => {
  let dir: string
  let store: Store

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-store-'))
    store = new Store(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('defaults to empty', () => {
    expect(store.getIdentityConfigs()).toEqual([])
  })

  it('saves, upserts by serverId, and persists', () => {
    store.saveIdentityConfig(CFG)
    store.saveIdentityConfig({ ...CFG, activeIdentityId: 'root' })
    expect(store.getIdentityConfigs()).toHaveLength(1)
    expect(store.getIdentityConfigs()[0].activeIdentityId).toBe('root')
    const reloaded = new Store(dir)
    expect(reloaded.getIdentityConfigs()[0].serverId).toBe('opnsense')
  })

  it('deletes by serverId', () => {
    store.saveIdentityConfig(CFG)
    store.deleteIdentityConfig('opnsense')
    expect(store.getIdentityConfigs()).toEqual([])
  })
})
