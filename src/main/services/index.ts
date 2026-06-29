import { join } from 'path'
import type {
  AppState,
  ApplyResult,
  ConnectionPlan,
  DetectedClient,
  PendingKey,
  PlanItem,
  SecretCandidate,
  SecretRequirement,
  Suggestion
} from '../../shared/types'
import { KEY_PLACEHOLDER } from '../../shared/types'
import { detectClients } from './clientDetector'
import { ConnectionEngine } from './connectionEngine'
import { Catalog } from './catalog'
import { SecretStore } from './secrets'
import { Store } from './store'
import { defaultBackupDir } from './paths'
import { scanSystem } from './systemScanner'
import { AiAdvisor } from './aiAdvisor'
import { TrendWatcher } from './trendWatcher'
import { IdentityService } from './identities'
import { SecretDiscovery } from './secretDiscovery'

export interface AppPaths {
  userData: string
  /** Candidate locations for the bundled registry (dev + packaged). */
  bundledRegistry: string[]
}

/** Owns and wires every service. One instance per app run. */
export class Services {
  readonly catalog: Catalog
  readonly secrets: SecretStore
  readonly store: Store
  readonly engine: ConnectionEngine
  readonly identities: IdentityService
  readonly advisor: AiAdvisor
  readonly trends: TrendWatcher
  readonly discovery: SecretDiscovery
  private clientsCache: DetectedClient[] = []

  constructor(paths: AppPaths) {
    this.catalog = new Catalog(paths.bundledRegistry)
    this.secrets = new SecretStore(paths.userData)
    this.store = new Store(paths.userData)
    this.engine = new ConnectionEngine(
      defaultBackupDir(paths.userData),
      () => this.clientsCache,
      (serverId, keys) =>
        this.identities.resolveForServer(serverId, keys) ?? this.secrets.resolve(keys)
    )
    this.identities = new IdentityService(
      this.store,
      this.secrets,
      this.catalog,
      () => this.clientsCache,
      this.engine
    )
    this.advisor = new AiAdvisor(this.secrets, this.catalog)
    this.trends = new TrendWatcher(this.catalog, this.store)
    this.discovery = new SecretDiscovery(() => this.clientsCache)
    this.refreshClients()
  }

  refreshClients(): DetectedClient[] {
    this.clientsCache = detectClients()
    return this.clientsCache
  }

  clients(): DetectedClient[] {
    return this.clientsCache
  }

  /** Compose the full state snapshot the renderer renders from. */
  getState(): AppState {
    const prefs = this.store.getPreferences()
    return {
      clients: this.refreshClients(),
      catalog: this.catalog.all(),
      suggestions: this.store.getSuggestions(),
      preferences: { ...prefs, anthropicApiKeyConfigured: this.secrets.hasApiKey() },
      profiles: this.store.getProfiles(),
      identityConfigs: this.store.getIdentityConfigs(),
      identitySecretsPresent: this.identities.secretsPresent(),
      pendingKeys: this.store.getPendingKeys(),
      updateStatus: { phase: 'idle' as const }
    }
  }

  // ---- key discovery + deferral ----

  discoverSecrets(keys: string[]): Record<string, SecretCandidate[]> {
    const sources = this.store.getPreferences().keyDiscoverySources
    return this.discovery.discover(keys, sources)
  }

  useSecretCandidate(key: string, candidateId: string): boolean {
    const value = this.discovery.resolve(candidateId)
    if (value == null) return false
    this.secrets.set(key, value)
    return true
  }

  /** Apply a plan while writing placeholders for deferred keys, and record reminders. */
  deferKeys(plan: ConnectionPlan, keys: string[], remind: boolean): ApplyResult[] {
    this.refreshClients()
    const placeholders = Object.fromEntries(keys.map((k) => [k, KEY_PLACEHOLDER(k)]))
    const results = this.engine.apply(plan, placeholders)

    const deferred = new Set(keys)
    const pending: PendingKey[] = []
    const seen = new Set<string>()
    for (const item of plan.items) {
      if (item.action !== 'connect') continue
      for (const req of item.server.requiredSecrets ?? []) {
        if (!deferred.has(req.key)) continue
        const id = `${item.server.id}:${req.key}`
        if (seen.has(id)) {
          const existing = pending.find((p) => p.id === id)
          if (existing && !existing.clientIds.includes(item.clientId))
            existing.clientIds.push(item.clientId)
          continue
        }
        seen.add(id)
        pending.push({
          id,
          serverId: item.server.id,
          serverName: item.server.name,
          key: req.key,
          label: req.label,
          clientIds: [item.clientId],
          remind,
          createdAt: new Date().toISOString()
        })
      }
    }
    if (pending.length) this.store.addPendingKeys(pending)
    return results
  }

  /** Set a deferred key's real value and re-apply its server to replace the placeholder. */
  resolvePendingKey(id: string, value: string): PendingKey[] {
    const pk = this.store.getPendingKeys().find((p) => p.id === id)
    if (!pk) return this.store.getPendingKeys()
    if (value) this.secrets.set(pk.key, value)
    this.refreshClients()
    const changes = pk.clientIds.map((clientId) => ({
      clientId,
      serverId: pk.serverId,
      action: 'connect' as const
    }))
    this.engine.apply(this.buildMatrixPlan(changes))
    return this.store.removePendingKey(id)
  }

  dismissPendingKey(id: string): PendingKey[] {
    return this.store.removePendingKey(id)
  }

  /** Turn raw matrix toggles into a reviewable plan with missing-secret detection. */
  buildMatrixPlan(
    changes: { clientId: string; serverId: string; action: 'connect' | 'disconnect' }[]
  ): ConnectionPlan {
    const items: PlanItem[] = []
    const missing: SecretRequirement[] = []
    const seenSecret = new Set<string>()

    for (const ch of changes) {
      const server = this.catalog.byId(ch.serverId)
      if (!server) continue
      items.push({ clientId: ch.clientId, server, action: ch.action })
      if (ch.action === 'connect') {
        for (const req of server.requiredSecrets ?? []) {
          const present = this.identities.hasSecret(server.id, req.key) ?? this.secrets.has(req.key)
          if (req.required && !present && !seenSecret.has(req.key)) {
            seenSecret.add(req.key)
            missing.push(
              this.identities.configFor(server.id)
                ? { ...req, help: `Managed by this server's credential identities — set it on the active identity (Matrix → identity chip → Manage identities). Values entered in this dialog are ignored for identity-managed servers.` }
                : req
            )
          }
        }
      }
    }

    return {
      id: `matrix-${this.clientsCache.length}-${items.length}`,
      title: 'Matrix changes',
      items,
      missingSecrets: missing
    }
  }

  buildProfilePlan(profileId: string, clientIds: string[]): ConnectionPlan {
    const profile = this.store.getProfiles().find((p) => p.id === profileId)
    if (!profile) {
      return { id: 'profile-missing', title: 'Unknown profile', items: [], missingSecrets: [] }
    }
    const changes = clientIds.flatMap((clientId) =>
      profile.serverIds.map((serverId) => ({ clientId, serverId, action: 'connect' as const }))
    )
    const plan = this.buildMatrixPlan(changes)
    plan.title = `Apply profile: ${profile.name}`
    return plan
  }

  runSystemScan(): Suggestion[] {
    const findings = scanSystem(this.catalog)
    const suggestions: Suggestion[] = findings.map((f) => ({
      id: `scan:${f.toolId}`,
      kind: 'default',
      title: `Connect ${f.toolName}`,
      reason: f.evidence,
      server: f.server,
      suggestedClients: this.clientsCache.filter((c) => c.installed).map((c) => c.id),
      createdAt: new Date().toISOString()
    }))
    return suggestions
  }
}

export function resolveBundledRegistry(appPath: string, resourcesPath?: string): string[] {
  const candidates = [join(appPath, 'resources', 'registry', 'servers.json')]
  if (resourcesPath) candidates.push(join(resourcesPath, 'registry', 'servers.json'))
  return candidates
}
