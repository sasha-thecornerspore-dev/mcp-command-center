import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Preferences, Profile, Suggestion, CatalogSource } from '../../shared/types'

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
  favoriteServerIds: []
}

interface Persisted {
  preferences: Preferences
  profiles: Profile[]
  dismissedSuggestions: string[]
  suggestions: Suggestion[]
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
      suggestions: []
    }
    if (!existsSync(this.file)) return base
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
      return {
        preferences: { ...DEFAULT_PREFS, ...(parsed.preferences ?? {}) },
        profiles: parsed.profiles ?? [],
        dismissedSuggestions: parsed.dismissedSuggestions ?? [],
        suggestions: parsed.suggestions ?? []
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
