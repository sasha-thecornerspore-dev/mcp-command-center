// Pure, dependency-free config transforms. No Node/Electron imports here so the
// merge/serialize logic is fully unit-testable. Each adapter knows where a given
// client dialect stores its MCP server map and how to read/upsert/remove entries
// WITHOUT disturbing any other keys in the file.

import type { ClientFormat, ServerEntry, ServerSpec, Transport } from '../../shared/types'

export interface FormatAdapter {
  format: ClientFormat
  /** Extract the server entries currently declared in a parsed config object. */
  extract(config: unknown): ServerEntry[]
  /** Return a NEW config object with `entry` upserted, preserving all other keys. */
  upsert(config: unknown, entry: ServerEntry): Record<string, unknown>
  /** Return a NEW config object with the named server removed. */
  remove(config: unknown, id: string): Record<string, unknown>
}

function asObject(config: unknown): Record<string, unknown> {
  return config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {}
}

function transportOf(raw: Record<string, unknown>): Transport {
  if (typeof raw.url === 'string') return raw.type === 'sse' ? 'sse' : 'http'
  return 'stdio'
}

/** Object-map dialect: { mcpServers: { "<name>": { command, args, env } | { url } } }. */
function objectMapAdapter(format: ClientFormat, key: string): FormatAdapter {
  return {
    format,
    extract(config) {
      const root = asObject(config)
      const map = (root[key] as Record<string, unknown>) ?? {}
      return Object.entries(map).map(([id, v]) => {
        const raw = asObject(v)
        return {
          id,
          transport: transportOf(raw),
          command: raw.command as string | undefined,
          args: (raw.args as string[] | undefined) ?? undefined,
          env: (raw.env as Record<string, string> | undefined) ?? undefined,
          url: raw.url as string | undefined,
          disabled: raw.disabled === true
        }
      })
    },
    upsert(config, entry) {
      const root = asObject(config)
      const map = { ...((root[key] as Record<string, unknown>) ?? {}) }
      map[entry.id] = entryToRaw(entry)
      root[key] = map
      return root
    },
    remove(config, id) {
      const root = asObject(config)
      const map = { ...((root[key] as Record<string, unknown>) ?? {}) }
      delete map[id]
      root[key] = map
      return root
    }
  }
}

function entryToRaw(entry: ServerEntry): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  if (entry.transport === 'stdio') {
    if (entry.command) raw.command = entry.command
    if (entry.args && entry.args.length) raw.args = entry.args
    if (entry.env && Object.keys(entry.env).length) raw.env = entry.env
  } else {
    if (entry.url) raw.url = entry.url
    raw.type = entry.transport
  }
  if (entry.disabled) raw.disabled = true
  return raw
}

/** Zed dialect: { context_servers: { "<name>": { command: { path, args, env } } } }. */
const zedAdapter: FormatAdapter = {
  format: 'zed',
  extract(config) {
    const root = asObject(config)
    const map = (root.context_servers as Record<string, unknown>) ?? {}
    return Object.entries(map).map(([id, v]) => {
      const raw = asObject(v)
      const cmd = asObject(raw.command)
      return {
        id,
        transport: 'stdio' as Transport,
        command: cmd.path as string | undefined,
        args: (cmd.args as string[] | undefined) ?? undefined,
        env: (cmd.env as Record<string, string> | undefined) ?? undefined
      }
    })
  },
  upsert(config, entry) {
    const root = asObject(config)
    const map = { ...((root.context_servers as Record<string, unknown>) ?? {}) }
    map[entry.id] = {
      source: 'custom',
      command: {
        path: entry.command,
        args: entry.args ?? [],
        env: entry.env ?? {}
      }
    }
    root.context_servers = map
    return root
  },
  remove(config, id) {
    const root = asObject(config)
    const map = { ...((root.context_servers as Record<string, unknown>) ?? {}) }
    delete map[id]
    root.context_servers = map
    return root
  }
}

/** Continue dialect: { mcpServers: [ { name, command, args, env } ] } (array). */
const continueAdapter: FormatAdapter = {
  format: 'continue',
  extract(config) {
    const root = asObject(config)
    const arr = (root.mcpServers as unknown[]) ?? []
    return arr.map((v) => {
      const raw = asObject(v)
      return {
        id: (raw.name as string) ?? 'unknown',
        transport: (typeof raw.url === 'string' ? 'http' : 'stdio') as Transport,
        command: raw.command as string | undefined,
        args: (raw.args as string[] | undefined) ?? undefined,
        env: (raw.env as Record<string, string> | undefined) ?? undefined,
        url: raw.url as string | undefined
      }
    })
  },
  upsert(config, entry) {
    const root = asObject(config)
    const arr = [...(((root.mcpServers as unknown[]) ?? []) as Record<string, unknown>[])]
    const next: Record<string, unknown> = { name: entry.id }
    if (entry.transport === 'stdio') {
      next.command = entry.command
      if (entry.args?.length) next.args = entry.args
      if (entry.env && Object.keys(entry.env).length) next.env = entry.env
    } else {
      next.url = entry.url
    }
    const idx = arr.findIndex((s) => s.name === entry.id)
    if (idx >= 0) arr[idx] = next
    else arr.push(next)
    root.mcpServers = arr
    return root
  },
  remove(config, id) {
    const root = asObject(config)
    const arr = (((root.mcpServers as unknown[]) ?? []) as Record<string, unknown>[]).filter(
      (s) => s.name !== id
    )
    root.mcpServers = arr
    return root
  }
}

const ADAPTERS: Record<ClientFormat, FormatAdapter> = {
  'claude-desktop': objectMapAdapter('claude-desktop', 'mcpServers'),
  'claude-code': objectMapAdapter('claude-code', 'mcpServers'),
  cursor: objectMapAdapter('cursor', 'mcpServers'),
  windsurf: objectMapAdapter('windsurf', 'mcpServers'),
  vscode: objectMapAdapter('vscode', 'servers'),
  'generic-mcpServers': objectMapAdapter('generic-mcpServers', 'mcpServers'),
  zed: zedAdapter,
  continue: continueAdapter
}

export function getAdapter(format: ClientFormat): FormatAdapter {
  return ADAPTERS[format] ?? ADAPTERS['generic-mcpServers']
}

/**
 * Convert a catalog ServerSpec into a concrete client entry, injecting any
 * resolved secrets into env vars or the URL (via ${KEY} placeholders).
 */
export function specToEntry(spec: ServerSpec, secrets: Record<string, string> = {}): ServerEntry {
  const env: Record<string, string> = { ...(spec.env ?? {}) }
  let url = spec.url

  for (const req of spec.requiredSecrets ?? []) {
    const value = secrets[req.key]
    if (value == null) continue
    if (req.target === 'env') env[req.key] = value
    else if (req.target === 'url' && url) url = url.replaceAll(`\${${req.key}}`, value)
  }

  return {
    id: spec.id,
    transport: spec.transport,
    command: spec.command,
    args: spec.args,
    env: Object.keys(env).length ? env : undefined,
    url
  }
}

/** Pretty-print config preserving 2-space indentation and a trailing newline. */
export function serializeConfig(config: unknown): string {
  return JSON.stringify(config, null, 2) + '\n'
}

/** Parse a config file's text; tolerant of empty files and trailing whitespace. */
export function parseConfig(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  return JSON.parse(trimmed) as Record<string, unknown>
}
