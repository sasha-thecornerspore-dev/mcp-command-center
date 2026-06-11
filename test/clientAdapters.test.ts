import { describe, it, expect } from 'vitest'
import {
  getAdapter,
  specToEntry,
  parseConfig,
  serializeConfig
} from '../src/main/services/clientAdapters'
import type { ServerSpec } from '../src/shared/types'

describe('object-map adapter (claude/cursor/windsurf)', () => {
  const adapter = getAdapter('claude-desktop')

  it('extracts existing servers', () => {
    const cfg = {
      mcpServers: { foo: { command: 'npx', args: ['-y', 'foo'], env: { A: '1' } } }
    }
    const entries = adapter.extract(cfg)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'foo', command: 'npx', transport: 'stdio' })
    expect(entries[0].args).toEqual(['-y', 'foo'])
  })

  it('upserts without disturbing unrelated keys', () => {
    const cfg = { theme: 'dark', mcpServers: { existing: { command: 'old' } } }
    const next = adapter.upsert(cfg, {
      id: 'new',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'new']
    })
    expect(next.theme).toBe('dark') // unrelated key preserved
    const servers = next.mcpServers as Record<string, unknown>
    expect(Object.keys(servers).sort()).toEqual(['existing', 'new'])
  })

  it('does not mutate the input object', () => {
    const cfg = { mcpServers: { a: { command: 'x' } } }
    const snapshot = JSON.stringify(cfg)
    adapter.upsert(cfg, { id: 'b', transport: 'stdio', command: 'y' })
    expect(JSON.stringify(cfg)).toBe(snapshot)
  })

  it('removes a server by id', () => {
    const cfg = { mcpServers: { a: { command: 'x' }, b: { command: 'y' } } }
    const next = adapter.remove(cfg, 'a')
    expect(Object.keys(next.mcpServers as object)).toEqual(['b'])
  })

  it('round-trips http transport entries', () => {
    const next = adapter.upsert(
      {},
      { id: 'remote', transport: 'http', url: 'https://example.com/mcp' }
    )
    const back = adapter.extract(next)
    expect(back[0]).toMatchObject({ id: 'remote', transport: 'http', url: 'https://example.com/mcp' })
  })
})

describe('vscode adapter uses "servers" key', () => {
  const adapter = getAdapter('vscode')
  it('writes under servers, not mcpServers', () => {
    const next = adapter.upsert({}, { id: 'x', transport: 'stdio', command: 'npx' })
    expect(next).toHaveProperty('servers')
    expect(next).not.toHaveProperty('mcpServers')
  })
})

describe('zed adapter uses context_servers with nested command', () => {
  const adapter = getAdapter('zed')
  it('nests command/args/env under command object', () => {
    const next = adapter.upsert(
      {},
      { id: 'z', transport: 'stdio', command: 'npx', args: ['-y', 'z'], env: { K: 'v' } }
    ) as any
    expect(next.context_servers.z.command.path).toBe('npx')
    expect(next.context_servers.z.command.args).toEqual(['-y', 'z'])
    const back = adapter.extract(next)
    expect(back[0]).toMatchObject({ id: 'z', command: 'npx' })
  })
})

describe('continue adapter uses an array', () => {
  const adapter = getAdapter('continue')
  it('appends and replaces by name', () => {
    let cfg: any = {}
    cfg = adapter.upsert(cfg, { id: 'one', transport: 'stdio', command: 'a' })
    cfg = adapter.upsert(cfg, { id: 'two', transport: 'stdio', command: 'b' })
    cfg = adapter.upsert(cfg, { id: 'one', transport: 'stdio', command: 'a2' })
    expect(Array.isArray(cfg.mcpServers)).toBe(true)
    expect(cfg.mcpServers).toHaveLength(2)
    expect(cfg.mcpServers.find((s: any) => s.name === 'one').command).toBe('a2')
  })
})

describe('specToEntry secret injection', () => {
  const spec: ServerSpec = {
    id: 'gh',
    name: 'GitHub',
    description: '',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'gh'],
    requiredSecrets: [
      { key: 'TOKEN', label: 'Token', target: 'env', required: true }
    ],
    tags: [],
    source: 'bundled'
  }

  it('injects secrets into env', () => {
    const entry = specToEntry(spec, { TOKEN: 'abc' })
    expect(entry.env).toEqual({ TOKEN: 'abc' })
  })

  it('omits env when no secrets provided', () => {
    const entry = specToEntry(spec, {})
    expect(entry.env).toBeUndefined()
  })

  it('substitutes url placeholders', () => {
    const urlSpec: ServerSpec = {
      ...spec,
      transport: 'http',
      command: undefined,
      url: 'https://x/${TOKEN}',
      requiredSecrets: [{ key: 'TOKEN', label: 'T', target: 'url', required: true }]
    }
    const entry = specToEntry(urlSpec, { TOKEN: 'xyz' })
    expect(entry.url).toBe('https://x/xyz')
  })
})

describe('parse/serialize', () => {
  it('tolerates empty files', () => {
    expect(parseConfig('')).toEqual({})
    expect(parseConfig('   \n')).toEqual({})
  })
  it('serializes with trailing newline and 2-space indent', () => {
    const out = serializeConfig({ a: 1 })
    expect(out).toBe('{\n  "a": 1\n}\n')
  })
})
