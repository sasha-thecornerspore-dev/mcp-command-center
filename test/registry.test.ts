import { describe, it, expect } from 'vitest'
import registry from '../resources/registry/servers.json'
import type { ServerSpec } from '../src/shared/types'

const servers = (registry as { servers: ServerSpec[] }).servers

describe('bundled registry integrity', () => {
  it('every server has id, name, transport, tags, and a runtime', () => {
    for (const s of servers) {
      expect(s.id, `${s.name} id`).toBeTruthy()
      expect(s.name, `${s.id} name`).toBeTruthy()
      expect(s.transport, `${s.id} transport`).toBeTruthy()
      expect(Array.isArray(s.tags), `${s.id} tags`).toBe(true)
      expect(s.runtime, `${s.id} runtime`).toBeTruthy()
    }
  })

  it('server ids are unique', () => {
    const ids = servers.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('node-runtime stdio servers launch via npx; python-runtime via uvx', () => {
    for (const s of servers) {
      if (s.transport !== 'stdio') continue
      if (s.runtime === 'node') expect(s.command, `${s.id}`).toBe('npx')
      if (s.runtime === 'python') expect(s.command, `${s.id}`).toBe('uvx')
    }
  })

  it('servers requiring secrets declare them with a target', () => {
    for (const s of servers) {
      for (const req of s.requiredSecrets ?? []) {
        expect(req.key).toBeTruthy()
        expect(['env', 'url']).toContain(req.target)
      }
    }
  })
})
