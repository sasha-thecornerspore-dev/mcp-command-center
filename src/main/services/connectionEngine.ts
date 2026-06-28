import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import type {
  ApplyResult,
  ConnectionPlan,
  DetectedClient,
  PlanDiff,
  PlanItem,
  ServerEntry
} from '../../shared/types'
import { getAdapter, parseConfig, serializeConfig, specToEntry } from './clientAdapters'

export type SecretResolver = (serverId: string, keys: string[]) => Record<string, string>

interface BackupRecord {
  id: string
  clientId: string
  originalPath: string
  createdAt: string
}

/**
 * The ONLY component that writes client configs. Every write is preceded by a
 * timestamped backup and performed as an atomic temp+rename. On any failure the
 * original file is restored from the backup.
 */
export class ConnectionEngine {
  private indexPath: string

  constructor(
    private backupDir: string,
    private clients: () => DetectedClient[],
    private resolveSecrets: SecretResolver = () => ({})
  ) {
    mkdirSync(this.backupDir, { recursive: true })
    this.indexPath = join(this.backupDir, 'index.json')
  }

  setClientsSource(fn: () => DetectedClient[]): void {
    this.clients = fn
  }

  private client(id: string): DetectedClient | undefined {
    return this.clients().find((c) => c.id === id)
  }

  private readText(path: string): string {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }

  /**
   * Build the post-change config object for one client given its plan items.
   * `placeholders` supplies a fallback value (e.g. "<SET:KEY>") for required
   * secrets the user deferred, so the entry is written but plainly incomplete.
   */
  private computeNext(
    client: DetectedClient,
    items: PlanItem[],
    placeholders: Record<string, string> = {}
  ): Record<string, unknown> {
    const adapter = getAdapter(client.format)
    let config = parseConfig(this.readText(client.configPath))
    for (const item of items) {
      if (item.action === 'connect') {
        const reqKeys = (item.server.requiredSecrets ?? []).map((s) => s.key)
        const secrets = this.resolveSecrets(item.server.id, reqKeys)
        for (const key of reqKeys) {
          if (secrets[key] == null && placeholders[key] != null) secrets[key] = placeholders[key]
        }
        const entry: ServerEntry = specToEntry(item.server, secrets)
        config = adapter.upsert(config, entry)
      } else {
        config = adapter.remove(config, item.server.id)
      }
    }
    return config
  }

  private groupByClient(plan: ConnectionPlan): Map<string, PlanItem[]> {
    const map = new Map<string, PlanItem[]>()
    for (const item of plan.items) {
      const arr = map.get(item.clientId) ?? []
      arr.push(item)
      map.set(item.clientId, arr)
    }
    return map
  }

  /** Compute before/after text for each affected client without writing anything. */
  preview(plan: ConnectionPlan): PlanDiff[] {
    const diffs: PlanDiff[] = []
    for (const [clientId, items] of this.groupByClient(plan)) {
      const client = this.client(clientId)
      if (!client) continue
      const before = this.readText(client.configPath)
      const after = serializeConfig(this.computeNext(client, items))
      diffs.push({ clientId, configPath: client.configPath, before, after })
    }
    return diffs
  }

  /** Apply a plan: one backup + atomic write per affected client. */
  apply(plan: ConnectionPlan, placeholders: Record<string, string> = {}): ApplyResult[] {
    const results: ApplyResult[] = []
    for (const [clientId, items] of this.groupByClient(plan)) {
      const client = this.client(clientId)
      if (!client) {
        for (const item of items) {
          results.push({
            clientId,
            serverId: item.server.id,
            action: item.action,
            ok: false,
            error: 'Client not found'
          })
        }
        continue
      }

      let backupId: string | undefined
      try {
        backupId = this.backup(client)
        const nextText = serializeConfig(this.computeNext(client, items, placeholders))
        // Validate it's parseable before committing.
        parseConfig(nextText)
        this.atomicWrite(client.configPath, nextText)
        const restartHint = this.restartHint(client)
        for (const item of items) {
          results.push({
            clientId,
            serverId: item.server.id,
            action: item.action,
            ok: true,
            backupId,
            restartHint
          })
        }
      } catch (err) {
        if (backupId) this.tryRollback(client.configPath, backupId)
        for (const item of items) {
          results.push({
            clientId,
            serverId: item.server.id,
            action: item.action,
            ok: false,
            backupId,
            error: (err as Error).message
          })
        }
      }
    }
    return results
  }

  private restartHint(client: DetectedClient): string | undefined {
    if (!client.processHints?.length) return undefined
    return `${client.name} may need to be restarted for changes to take effect.`
  }

  private atomicWrite(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.mcc-tmp-${process.pid}`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, path)
  }

  // ---- backups ----

  private loadIndex(): BackupRecord[] {
    if (!existsSync(this.indexPath)) return []
    try {
      return JSON.parse(readFileSync(this.indexPath, 'utf8')) as BackupRecord[]
    } catch {
      return []
    }
  }

  private saveIndex(records: BackupRecord[]): void {
    writeFileSync(this.indexPath, JSON.stringify(records, null, 2), 'utf8')
  }

  private backup(client: DetectedClient): string | undefined {
    if (!existsSync(client.configPath)) return undefined // nothing to back up yet
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const id = `${client.id}__${stamp}`
    const dest = join(this.backupDir, `${id}.json`)
    writeFileSync(dest, readFileSync(client.configPath, 'utf8'), 'utf8')
    const records = this.loadIndex()
    records.push({ id, clientId: client.id, originalPath: client.configPath, createdAt: stamp })
    this.saveIndex(records)
    return id
  }

  private tryRollback(path: string, backupId: string): void {
    const dest = join(this.backupDir, `${backupId}.json`)
    if (existsSync(dest)) this.atomicWrite(path, readFileSync(dest, 'utf8'))
  }

  /** Restore a client config from a specific backup id. */
  restore(clientId: string, backupId: string): ApplyResult {
    const rec = this.loadIndex().find((r) => r.id === backupId && r.clientId === clientId)
    if (!rec) {
      return { clientId, serverId: '*', action: 'disconnect', ok: false, error: 'Backup not found' }
    }
    const src = join(this.backupDir, `${backupId}.json`)
    try {
      this.atomicWrite(rec.originalPath, readFileSync(src, 'utf8'))
      return { clientId, serverId: '*', action: 'disconnect', ok: true, backupId }
    } catch (err) {
      return {
        clientId,
        serverId: '*',
        action: 'disconnect',
        ok: false,
        error: (err as Error).message
      }
    }
  }

  listBackups(clientId?: string): BackupRecord[] {
    const all = this.loadIndex()
    return clientId ? all.filter((r) => r.clientId === clientId) : all
  }
}
