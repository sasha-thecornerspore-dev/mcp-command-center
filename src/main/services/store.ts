import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type {
  Preferences,
  Profile,
  Suggestion,
  CatalogSource,
  ServerIdentityConfig,
  PendingKey
} from '../../shared/types'

const DEFAULT_PREFS: Preferences = {
  anthropicApiKeyConfigured: false,
  catalogRefreshHours: 24,
  sources: {
    bundled: true,
    remote: true,
    'official-registry': true,
    web: true,
    scanner: true
  } as Record<CatalogSource, boolean>,
  dismissedSuggestionIds: [],
  favoriteServerIds: [],
  baseBuild: 'standard',
  keyDiscoverySources: { appEnv: true, otherClients: true, envFiles: false }
}

interface Persisted {
  preferences: Preferences
  profiles: Profile[]
  dismissedSuggestions: string[]
  suggestions: Suggestion[]
  identityConfigs: ServerIdentityConfig[]
  pendingKeys: PendingKey[]
}

/** Simple JSON-file persistence for preferences, profiles, and surfaced suggestions. */
export class Store {
  private file: string
  private data: Persisted

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'store.json')
    this.data = this.load()
  }

  private load(): Persisted {
    const base: Persisted = {
      preferences: { ...DEFAULT_PREFS },
      profiles: [],
      dismissedSuggestions: [],
      suggestions: [],
      identityConfigs: [],
      pendingKeys: []
    }
    if (!existsSync(this.file)) return base
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
      return {
        preferences: {
          ...DEFAULT_PREFS,
          ...(parsed.preferences ?? {}),
          keyDiscoverySources: {
            ...DEFAULT_PREFS.keyDiscoverySources,
            ...(parsed.preferences?.keyDiscoverySources ?? {})
          }
        },
        profiles: parsed.profiles ?? [],
        dismissedSuggestions: parsed.dismissedSuggestions ?? [],
        suggestions: parsed.suggestions ?? [],
        identityConfigs: parsed.identityConfigs ?? [],
        pendingKeys: parsed.pendingKeys ?? []
      }
    } catch {
      return base
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
  }

  getPreferences(): Preferences {
    return {
      ...this.data.preferences,
      dismissedSuggestionIds: this.data.dismissedSuggestions
    }
  }

  savePreferences(patch: Partial<Preferences>): Preferences {
    this.data.preferences = { ...this.data.preferences, ...patch }
    this.persist()
    return this.getPreferences()
  }

  getProfiles(): Profile[] {
    return this.data.profiles
  }

  saveProfile(profile: Profile): Profile[] {
    const idx = this.data.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) this.data.profiles[idx] = profile
    else this.data.profiles.push(profile)
    this.persist()
    return this.data.profiles
  }

  deleteProfile(id: string): Profile[] {
    this.data.profiles = this.data.profiles.filter((p) => p.id !== id)
    this.persist()
    return this.data.profiles
  }

  getIdentityConfigs(): ServerIdentityConfig[] {
    return this.data.identityConfigs
  }

  saveIdentityConfig(cfg: ServerIdentityConfig): ServerIdentityConfig[] {
    const idx = this.data.identityConfigs.findIndex((c) => c.serverId === cfg.serverId)
    if (idx >= 0) this.data.identityConfigs[idx] = cfg
    else this.data.identityConfigs.push(cfg)
    this.persist()
    return this.data.identityConfigs
  }

  deleteIdentityConfig(serverId: string): ServerIdentityConfig[] {
    this.data.identityConfigs = this.data.identityConfigs.filter((c) => c.serverId !== serverId)
    this.persist()
    return this.data.identityConfigs
  }

  getPendingKeys(): PendingKey[] {
    return this.data.pendingKeys
  }

  /** Add pending keys, replacing any existing entry for the same server+key. */
  addPendingKeys(keys: PendingKey[]): PendingKey[] {
    for (const pk of keys) {
      this.data.pendingKeys = this.data.pendingKeys.filter(
        (e) => !(e.serverId === pk.serverId && e.key === pk.key)
      )
      this.data.pendingKeys.push(pk)
    }
    this.persist()
    return this.data.pendingKeys
  }

  removePendingKey(id: string): PendingKey[] {
    this.data.pendingKeys = this.data.pendingKeys.filter((p) => p.id !== id)
    this.persist()
    return this.data.pendingKeys
  }

  getSuggestions(): Suggestion[] {
    const dismissed = new Set(this.data.dismissedSuggestions)
    return this.data.suggestions.filter((s) => !dismissed.has(s.id))
  }

  setSuggestions(suggestions: Suggestion[]): void {
    this.data.suggestions = suggestions
    this.persist()
  }

  dismissSuggestion(id: string): Suggestion[] {
    if (!this.data.dismissedSuggestions.includes(id)) {
      this.data.dismissedSuggestions.push(id)
      this.persist()
    }
    return this.getSuggestions()
  }
}
