import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ConnectionEngine } from '../src/main/services/connectionEngine'
import type { ConnectionPlan, DetectedClient, ServerSpec } from '../src/shared/types'

const SERVER: ServerSpec = {
  id: 'memory',
  name: 'Memory',
  description: '',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
  tags: [],
  source: 'bundled'
}

const GH: ServerSpec = {
  ...SERVER,
  id: 'github',
  name: 'GitHub',
  args: ['-y', 'gh'],
  requiredSecrets: [{ key: 'TOKEN', label: 'T', target: 'env', required: true }]
}

describe('ConnectionEngine', () => {
  let dir: string
  let configPath: string
  let engine: ConnectionEngine

  const client = (): DetectedClient => ({
    id: 'claude-desktop',
    name: 'Claude Desktop',
    format: 'claude-desktop',
    configPath,
    installed: true,
    configExists: existsSync(configPath),
    servers: [],
    processHints: ['Claude.exe']
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-'))
    configPath = join(dir, 'claude_desktop_config.json')
    const backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    engine = new ConnectionEngine(
      backupDir,
      () => [client()],
      (keys) => Object.fromEntries(keys.map((k) => [k, 'secret-' + k]))
    )
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const connectPlan = (server = SERVER): ConnectionPlan => ({
    id: 'p',
    title: 't',
    items: [{ clientId: 'claude-desktop', server, action: 'connect' }],
    missingSecrets: []
  })

  it('connects by writing a merged config and preserving unrelated keys', () => {
    writeFileSync(configPath, JSON.stringify({ windowBounds: { w: 800 } }, null, 2))
    const results = engine.apply(connectPlan())
    expect(results[0].ok).toBe(true)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.windowBounds).toEqual({ w: 800 }) // preserved
    expect(written.mcpServers.memory.command).toBe('npx')
  })

  it('creates a backup before writing', () => {
    writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))
    const res = engine.apply(connectPlan())
    expect(res[0].backupId).toBeTruthy()
    const backups = engine.listBackups('claude-desktop')
    expect(backups).toHaveLength(1)
  })

  it('injects resolved secrets into env', () => {
    writeFileSync(configPath, '{}')
    engine.apply(connectPlan(GH))
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.mcpServers.github.env.TOKEN).toBe('secret-TOKEN')
  })

  it('disconnects by removing the entry', () => {
    writeFileSync(
      configPath,
      JSON.stringify({ mcpServers: { memory: { command: 'npx' }, keep: { command: 'x' } } })
    )
    const plan: ConnectionPlan = {
      id: 'p',
      title: 't',
      items: [{ clientId: 'claude-desktop', server: SERVER, action: 'disconnect' }],
      missingSecrets: []
    }
    engine.apply(plan)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.mcpServers.memory).toBeUndefined()
    expect(written.mcpServers.keep).toBeDefined()
  })

  it('preview does not write to disk', () => {
    writeFileSync(configPath, '{}')
    const before = readFileSync(configPath, 'utf8')
    const diffs = engine.preview(connectPlan())
    expect(diffs).toHaveLength(1)
    expect(diffs[0].after).toContain('memory')
    expect(readFileSync(configPath, 'utf8')).toBe(before) // unchanged
  })

  it('restores a previous backup', () => {
    const original = JSON.stringify({ mcpServers: { original: { command: 'orig' } } }, null, 2)
    writeFileSync(configPath, original)
    const res = engine.apply(connectPlan())
    const backupId = res[0].backupId!
    // config now has the newly-connected server in addition to the original
    expect(readFileSync(configPath, 'utf8')).toContain('memory')
    const restore = engine.restore('claude-desktop', backupId)
    expect(restore.ok).toBe(true)
    const restored = readFileSync(configPath, 'utf8')
    expect(restored).toContain('original') // pre-existing entry back
    expect(restored).not.toContain('memory') // our change rolled back
  })

  it('batches multiple items to one client into a single write', () => {
    writeFileSync(configPath, '{}')
    const plan: ConnectionPlan = {
      id: 'p',
      title: 't',
      items: [
        { clientId: 'claude-desktop', server: SERVER, action: 'connect' },
        { clientId: 'claude-desktop', server: { ...SERVER, id: 'fetch', name: 'Fetch' }, action: 'connect' }
      ],
      missingSecrets: []
    }
    engine.apply(plan)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(Object.keys(written.mcpServers).sort()).toEqual(['fetch', 'memory'])
    // one backup for the batch
    expect(engine.listBackups('claude-desktop')).toHaveLength(1)
  })
})
