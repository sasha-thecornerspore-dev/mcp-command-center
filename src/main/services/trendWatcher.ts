import type { ServerSpec, Suggestion } from '../../shared/types'
import type { Catalog } from './catalog'
import type { Store } from './store'

const OFFICIAL_REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers'

/**
 * Keeps the catalog current and surfaces "New & Relevant" servers. Queries the
 * official MCP registry (best-effort) and ranks novelty against what the user
 * already has. Web-search discovery is wired through the same merge path.
 */
export class TrendWatcher {
  constructor(
    private catalog: Catalog,
    private store: Store
  ) {}

  /**
   * Fetch the official registry, normalize, merge into the catalog, and emit
   * suggestions for servers the user hasn't seen. Never throws — returns whatever
   * it could gather.
   */
  async check(): Promise<Suggestion[]> {
    const discovered = await this.fetchOfficial()
    if (discovered.length) this.catalog.mergeExternal(discovered)

    const known = new Set(this.store.getSuggestions().map((s) => s.server.id))
    const now = new Date().toISOString()
    const suggestions: Suggestion[] = discovered
      .filter((s) => !known.has(s.id))
      .slice(0, 25)
      .map((server) => ({
        id: `trend:${server.id}`,
        kind: 'trend' as const,
        title: `New: ${server.name}`,
        reason: server.description || 'Newly published MCP server from the official registry.',
        server,
        suggestedClients: [],
        createdAt: now
      }))

    // Persist merged suggestion set (existing + new), de-duplicated by id.
    const merged = dedupeSuggestions([...this.store.getSuggestions(), ...suggestions])
    this.store.setSuggestions(merged)
    return this.store.getSuggestions()
  }

  private async fetchOfficial(): Promise<ServerSpec[]> {
    try {
      const res = await fetch(OFFICIAL_REGISTRY, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return []
      const json = (await res.json()) as { servers?: unknown[] }
      const rows = Array.isArray(json.servers) ? json.servers : []
      return rows.map(normalizeRegistryRow).filter((s): s is ServerSpec => s !== null)
    } catch {
      return []
    }
  }
}

/** Map an official-registry row to our ServerSpec (tolerant of schema drift). */
function normalizeRegistryRow(row: unknown): ServerSpec | null {
  const r = row as Record<string, any>
  const name: string | undefined = r?.name
  if (!name) return null
  const id = String(name).split('/').pop() ?? String(name)
  const pkg = Array.isArray(r.packages) ? r.packages[0] : undefined
  const remote = Array.isArray(r.remotes) ? r.remotes[0] : undefined

  if (remote?.url) {
    return {
      id,
      name: r.title ?? id,
      description: r.description ?? '',
      transport: remote.transport_type === 'sse' ? 'sse' : 'http',
      url: remote.url,
      tags: ['registry'],
      source: 'official-registry',
      homepage: r.repository?.url
    }
  }

  return {
    id,
    name: r.title ?? id,
    description: r.description ?? '',
    transport: 'stdio',
    command: 'npx',
    args: pkg?.identifier ? ['-y', pkg.identifier] : [],
    tags: ['registry'],
    source: 'official-registry',
    homepage: r.repository?.url
  }
}

function dedupeSuggestions(list: Suggestion[]): Suggestion[] {
  const seen = new Map<string, Suggestion>()
  for (const s of list) if (!seen.has(s.id)) seen.set(s.id, s)
  return [...seen.values()]
}
