import { existsSync, readFileSync } from 'fs'
import type { CatalogSource, ServerSpec } from '../../shared/types'

interface BundledFile {
  version: number
  updated: string
  servers: ServerSpec[]
}

/**
 * The Server Catalog merges entries from multiple sources into one normalized
 * list. Phase 1 ships the bundled registry; Phase 3 layers in remote refresh,
 * the official MCP registry API, and live web discovery (see trendWatcher).
 */
export class Catalog {
  private bundledPaths: string[]
  private extra: ServerSpec[] = []
  private cache: ServerSpec[] = []

  constructor(bundledPaths: string[]) {
    this.bundledPaths = bundledPaths
    this.cache = this.loadBundled()
  }

  private loadBundled(): ServerSpec[] {
    for (const p of this.bundledPaths) {
      if (!existsSync(p)) continue
      try {
        const parsed = JSON.parse(readFileSync(p, 'utf8')) as BundledFile
        return parsed.servers.map((s) => normalize(s, 'bundled', parsed.updated))
      } catch {
        /* try next candidate */
      }
    }
    return []
  }

  /** Merge externally-discovered specs (remote/official/web/scanner) into the catalog. */
  mergeExternal(specs: ServerSpec[]): ServerSpec[] {
    this.extra = dedupe([...this.extra, ...specs])
    this.cache = this.recompute()
    return this.cache
  }

  private recompute(): ServerSpec[] {
    return dedupe([...this.loadBundled(), ...this.extra])
  }

  all(): ServerSpec[] {
    return this.cache
  }

  byId(id: string): ServerSpec | undefined {
    return this.cache.find((s) => s.id === id)
  }
}

function normalize(spec: ServerSpec, source: CatalogSource, firstSeen?: string): ServerSpec {
  return {
    ...spec,
    source: spec.source ?? source,
    tags: spec.tags ?? [],
    firstSeen: spec.firstSeen ?? firstSeen
  }
}

/** Dedupe by id; earlier entries win (bundled/curated beats discovered). */
export function dedupe(specs: ServerSpec[]): ServerSpec[] {
  const seen = new Map<string, ServerSpec>()
  for (const s of specs) {
    if (!seen.has(s.id)) seen.set(s.id, s)
  }
  return [...seen.values()]
}
