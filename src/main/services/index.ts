import { join } from 'path'
import type {
  AppState,
  ConnectionPlan,
  DetectedClient,
  PlanItem,
  SecretRequirement,
  Suggestion
} from '../../shared/types'
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
      identitySecretsPresent: this.identities.secretsPresent()
    }
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
                ? { ...req, help: `This server uses identities — set this value in its identity editor (Matrix → id chip → Manage identities), not here.` }
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
