import { request as httpsRequest } from 'https'
import { request as httpRequest } from 'http'
import type {
  ApplyResult,
  ConnectionPlan,
  DetectedClient,
  HealthCheckResult,
  IdentityHealthCheck,
  ServerIdentityConfig,
  ServerSpec,
  SwitchResult
} from '../../shared/types'

/** Namespacing scheme for identity secret values inside the SecretStore. */
export function identitySecretKey(serverId: string, identityId: string, key: string): string {
  return `identity:${serverId}:${identityId}:${key}`
}

export function identityPrefix(serverId: string, identityId?: string): string {
  return identityId ? `identity:${serverId}:${identityId}:` : `identity:${serverId}:`
}

/** Ids are embedded in colon-delimited secret keys — reject ids that would corrupt parsing. */
function assertSafeId(id: string, what: string): void {
  if (!id || id.includes(':')) throw new Error(`invalid ${what} "${id}": must be non-empty and contain no ':'`)
}

export interface HealthRequestSpec {
  url: string
  method: string
  headers: Record<string, string>
  rejectUnauthorized: boolean
}

/** Pure request construction — unit-testable without any network. */
export function buildHealthRequest(
  check: IdentityHealthCheck,
  secrets: Record<string, string>
): HealthRequestSpec {
  const headers: Record<string, string> = {}
  if (check.auth === 'basic') {
    const user = secrets[check.usernameSecretKey ?? ''] ?? ''
    const pass = secrets[check.passwordSecretKey ?? ''] ?? ''
    headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  } else if (check.auth === 'bearer') {
    headers.Authorization = 'Bearer ' + (secrets[check.passwordSecretKey ?? ''] ?? '')
  }
  return {
    url: check.url,
    method: check.method ?? 'GET',
    headers,
    rejectUnauthorized: !check.skipTlsVerify
  }
}

export type HealthTransport = (spec: HealthRequestSpec) => Promise<{ status: number }>

/** Real transport: node http/https with a 10s timeout. */
export const nodeTransport: HealthTransport = (spec) =>
  new Promise((resolve, reject) => {
    const u = new URL(spec.url)
    const fn = u.protocol === 'https:' ? httpsRequest : httpRequest
    const req = fn(
      u,
      {
        method: spec.method,
        headers: spec.headers,
        rejectUnauthorized: spec.rejectUnauthorized,
        timeout: 10_000
      },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout after 10s')))
    req.on('error', reject)
    req.end()
  })

// ---- structural ports (narrow on purpose: tests need no electron) ----
export interface IdentityStorePort {
  getIdentityConfigs(): ServerIdentityConfig[]
  saveIdentityConfig(cfg: ServerIdentityConfig): ServerIdentityConfig[]
  deleteIdentityConfig(serverId: string): ServerIdentityConfig[]
}

export interface SecretPort {
  get(key: string): string | undefined
  set(key: string, value: string): void
  has(key: string): boolean
  delete(key: string): void
  keysWithPrefix(prefix: string): string[]
}

export interface CatalogPort {
  byId(id: string): ServerSpec | undefined
}

export interface EnginePort {
  apply(plan: ConnectionPlan): ApplyResult[]
}

export class IdentityService {
  constructor(
    private store: IdentityStorePort,
    private secrets: SecretPort,
    private catalog: CatalogPort,
    private clients: () => DetectedClient[],
    private engine: EnginePort,
    private transport: HealthTransport = nodeTransport
  ) {}

  configFor(serverId: string): ServerIdentityConfig | undefined {
    return this.store.getIdentityConfigs().find((c) => c.serverId === serverId)
  }

  /**
   * Identity-aware secret presence: true/false when the server has an identity
   * config (checked against the active identity's namespaced store), undefined
   * when it doesn't (caller falls back to the plain secret store).
   */
  hasSecret(serverId: string, key: string): boolean | undefined {
    const cfg = this.configFor(serverId)
    if (!cfg) return undefined
    const active = cfg.identities.find((i) => i.id === cfg.activeIdentityId)
    if (!active) return undefined
    return this.secrets.has(identitySecretKey(serverId, active.id, key))
  }

  /** Active identity's values for the given keys, or undefined if no identity config. */
  resolveForServer(serverId: string, keys: string[]): Record<string, string> | undefined {
    const cfg = this.configFor(serverId)
    if (!cfg) return undefined
    const active = cfg.identities.find((i) => i.id === cfg.activeIdentityId)
    if (!active) return undefined
    const out: Record<string, string> = {}
    for (const k of keys) {
      const v = this.secrets.get(identitySecretKey(serverId, active.id, k))
      if (v != null) out[k] = v
    }
    return out
  }

  /**
   * Upsert a config plus optional write-only secret payload
   * ({ [identityId]: { [secretKey]: value } }). Empty values leave existing
   * secrets unchanged. Secrets of identities no longer in the config are pruned.
   * Saving a config with zero identities deletes it entirely.
   */
  save(
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): ServerIdentityConfig[] {
    assertSafeId(cfg.serverId, 'server id')
    for (const identity of cfg.identities) assertSafeId(identity.id, 'identity id')
    if (cfg.identities.length === 0) return this.delete(cfg.serverId)
    if (!cfg.identities.some((i) => i.id === cfg.activeIdentityId))
      throw new Error(`active identity "${cfg.activeIdentityId}" is not in the identity list`)
    for (const [identityId, values] of Object.entries(secretValues ?? {})) {
      assertSafeId(identityId, 'identity id')
      for (const [key, value] of Object.entries(values)) {
        if (value) this.secrets.set(identitySecretKey(cfg.serverId, identityId, key), value)
      }
    }
    const live = new Set(cfg.identities.map((i) => i.id))
    for (const stored of this.secrets.keysWithPrefix(identityPrefix(cfg.serverId))) {
      const identityId = stored.slice(identityPrefix(cfg.serverId).length).split(':')[0]
      if (!live.has(identityId)) this.secrets.delete(stored)
    }
    return this.store.saveIdentityConfig(cfg)
  }

  delete(serverId: string): ServerIdentityConfig[] {
    assertSafeId(serverId, 'server id')
    for (const k of this.secrets.keysWithPrefix(identityPrefix(serverId))) this.secrets.delete(k)
    return this.store.deleteIdentityConfig(serverId)
  }

  /** "<serverId>:<identityId>" -> names of secret keys that have stored values. */
  secretsPresent(): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    for (const cfg of this.store.getIdentityConfigs()) {
      for (const identity of cfg.identities) {
        const prefix = identityPrefix(cfg.serverId, identity.id)
        out[`${cfg.serverId}:${identity.id}`] = this.secrets
          .keysWithPrefix(prefix)
          .map((k) => k.slice(prefix.length))
      }
    }
    return out
  }

  /** All stored secret values for one identity, keyed by plain secret key. */
  private identityValues(serverId: string, identityId: string): Record<string, string> {
    const prefix = identityPrefix(serverId, identityId)
    const out: Record<string, string> = {}
    for (const k of this.secrets.keysWithPrefix(prefix)) {
      const v = this.secrets.get(k)
      if (v != null) out[k.slice(prefix.length)] = v
    }
    return out
  }

  async test(serverId: string, identityId: string): Promise<HealthCheckResult> {
    const cfg = this.configFor(serverId)
    const identity = cfg?.identities.find((i) => i.id === identityId)
    if (!identity) return { ok: false, error: 'identity not found' }
    if (!identity.healthCheck) return { ok: true } // no check defined — vacuously ok (callers should not present this as "verified")
    if (identity.healthCheck.auth === 'basic' && (!identity.healthCheck.usernameSecretKey || !identity.healthCheck.passwordSecretKey))
      return { ok: false, error: 'health check: select username and password secret keys' }
    if (identity.healthCheck.auth === 'bearer' && !identity.healthCheck.passwordSecretKey)
      return { ok: false, error: 'health check: select a token secret key' }
    const referenced = [
      ...(identity.healthCheck.auth === 'basic' ? [identity.healthCheck.usernameSecretKey] : []),
      ...(identity.healthCheck.auth !== 'none' ? [identity.healthCheck.passwordSecretKey] : [])
    ].filter((k): k is string => Boolean(k))
    const values = this.identityValues(serverId, identityId)
    const unset = referenced.filter((k) => values[k] == null)
    if (unset.length) return { ok: false, error: `secret not set: ${unset.join(', ')}` }
    const spec = buildHealthRequest(identity.healthCheck, values)
    try {
      const { status } = await this.transport(spec)
      return { ok: status >= 200 && status < 300, status }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async switch(serverId: string, identityId: string): Promise<SwitchResult> {
    const cfg = this.configFor(serverId)
    const identity = cfg?.identities.find((i) => i.id === identityId)
    const server = this.catalog.byId(serverId)
    if (!cfg || !identity || !server) return { blocked: 'not-found', applyResults: [] }

    const requiredKeys = (server.requiredSecrets ?? []).filter((r) => r.required).map((r) => r.key)
    const missingKeys = requiredKeys.filter(
      (k) => !this.secrets.has(identitySecretKey(serverId, identityId, k))
    )
    if (missingKeys.length) return { blocked: 'missing-secrets', missingKeys, applyResults: [] }

    let healthCheck: HealthCheckResult | undefined
    if (identity.healthCheck) {
      healthCheck = await this.test(serverId, identityId)
      if (!healthCheck.ok) return { healthCheck, blocked: 'health-check', applyResults: [] }
    }

    this.store.saveIdentityConfig({ ...cfg, activeIdentityId: identityId })

    const targets = this.clients().filter((c) => c.servers.some((s) => s.id === serverId))
    const plan: ConnectionPlan = {
      id: `identity-${serverId}-${identityId}`,
      title: `Switch ${server.name} to ${identity.label}`,
      items: targets.map((c) => ({ clientId: c.id, server, action: 'connect' as const })),
      missingSecrets: []
    }
    return { healthCheck, applyResults: this.engine.apply(plan) }
  }
}
