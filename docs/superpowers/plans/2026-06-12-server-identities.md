# Server Credential Identities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a server own multiple named credential sets (identities) with an optional health check, switchable from the Matrix with one click, re-applying configs to every client that has the server.

**Architecture:** New `IdentityService` in the main process owns identity configs (persisted in `store.json`, no secret values) and namespaced secrets (`identity:<serverId>:<identityId>:<key>` in the existing DPAPI-backed `SecretStore`). The `ConnectionEngine`'s secret resolver gains a `serverId` parameter so identity values win over plain secrets at apply time. Four IPC channels; renderer gets an identity switcher row in the Matrix server column plus an editor modal.

**Tech Stack:** Electron (main/preload/renderer), TypeScript, React 18, Tailwind, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-12-server-identities-design.md`

**Branch:** `server-identities` (already created; spec committed).

**Conventions:** run all commands from the repo root `C:\Users\sasha\Documents\Repos\mcp-command-center`. Test runner: `npx vitest run <file>`. Typecheck: `npm run typecheck`. The repo has unrelated uncommitted changes (`.gitignore`, `scripts/make-cert.ps1`) — never `git add -A`; always add named files.

---

### Task 1: Shared types and IPC channel names

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add identity types** — in `src/shared/types.ts`, directly after the `Profile` interface (~line 133), insert:

```ts
/** A named credential set for a server (e.g. "sasha", "root"). */
export interface ServerIdentity {
  id: string // slug, unique within the server
  label: string
  healthCheck?: IdentityHealthCheck
}

/** Optional pre-switch verification request. */
export interface IdentityHealthCheck {
  url: string
  method?: 'GET' | 'POST' // default GET
  auth: 'basic' | 'bearer' | 'none'
  /** Secret keys (of this server) used to build the auth header. */
  usernameSecretKey?: string // basic: username side
  passwordSecretKey?: string // basic: password side; bearer: the token
  skipTlsVerify?: boolean // self-signed certs
}

/** Per-server identity state, persisted in the store (no secret values here). */
export interface ServerIdentityConfig {
  serverId: string
  identities: ServerIdentity[]
  activeIdentityId: string
}

export interface HealthCheckResult {
  ok: boolean
  status?: number
  error?: string
}

/** Outcome of an identity switch. */
export interface SwitchResult {
  healthCheck?: HealthCheckResult
  blocked?: 'health-check' | 'missing-secrets' | 'not-found'
  missingKeys?: string[]
  applyResults: ApplyResult[]
}
```

- [ ] **Step 2: Extend AppState** — change the `AppState` interface to:

```ts
export interface AppState {
  clients: DetectedClient[]
  catalog: ServerSpec[]
  suggestions: Suggestion[]
  preferences: Preferences
  profiles: Profile[]
  identityConfigs: ServerIdentityConfig[]
  /** "<serverId>:<identityId>" -> secret keys that have a stored value (names only). */
  identitySecretsPresent: Record<string, string[]>
}
```

- [ ] **Step 3: Add IPC channels** — inside the `IPC` const, after `applyProfile`:

```ts
  saveIdentities: 'identities:save',
  switchIdentity: 'identities:switch',
  testIdentity: 'identities:test',
  deleteIdentities: 'identities:delete',
```

- [ ] **Step 4: Typecheck** — Run: `npm run typecheck`
Expected: errors ONLY about `AppState` missing the two new fields in `src/main/services/index.ts` (`getState`) and `src/renderer/src/mockApi.ts`. That's expected — they're fixed in Tasks 8. If other errors appear, fix before continuing. To keep the build green for the commit, add temporary stubs at both sites: in `Services.getState()` return object add `identityConfigs: [], identitySecretsPresent: {}`, and the same two fields to the mock's state object in `mockApi.ts` (find the object literal it returns for `getState`). Re-run typecheck. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/services/index.ts src/renderer/src/mockApi.ts
git commit -m "feat(identities): shared types and IPC channels for server identities"
```

---

### Task 2: SecretStore — delete and prefix listing

**Files:**
- Modify: `src/main/services/secrets.ts`
- Create: `test/secrets.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/secrets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// SecretStore imports electron; stub safeStorage so the b64 fallback path runs.
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { SecretStore } from '../src/main/services/secrets'

describe('SecretStore identity extensions', () => {
  let dir: string
  let store: SecretStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-sec-'))
    store = new SecretStore(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('deletes a key and persists the deletion', () => {
    store.set('identity:opnsense:root:KEY', 'v1')
    expect(store.has('identity:opnsense:root:KEY')).toBe(true)
    store.delete('identity:opnsense:root:KEY')
    expect(store.has('identity:opnsense:root:KEY')).toBe(false)
    // a fresh instance reads the persisted file
    const reloaded = new SecretStore(dir)
    expect(reloaded.has('identity:opnsense:root:KEY')).toBe(false)
  })

  it('lists keys by prefix', () => {
    store.set('identity:opnsense:root:A', '1')
    store.set('identity:opnsense:root:B', '2')
    store.set('identity:opnsense:sasha:A', '3')
    store.set('OTHER', '4')
    expect(store.keysWithPrefix('identity:opnsense:root:').sort()).toEqual([
      'identity:opnsense:root:A',
      'identity:opnsense:root:B'
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/secrets.test.ts`
Expected: FAIL — `store.delete is not a function`

- [ ] **Step 3: Implement** — in `src/main/services/secrets.ts`, after the `has()` method add:

```ts
  delete(key: string): void {
    delete this.cache[key]
    this.persist()
  }

  keysWithPrefix(prefix: string): string[] {
    return Object.keys(this.cache).filter((k) => k.startsWith(prefix))
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/secrets.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/secrets.ts test/secrets.test.ts
git commit -m "feat(identities): SecretStore delete + prefix listing"
```

---

### Task 3: Store — persist identity configs

**Files:**
- Modify: `src/main/services/store.ts`
- Create: `test/store.test.ts`

- [ ] **Step 1: Write the failing test** — create `test/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Store } from '../src/main/services/store'
import type { ServerIdentityConfig } from '../src/shared/types'

const CFG: ServerIdentityConfig = {
  serverId: 'opnsense',
  activeIdentityId: 'sasha',
  identities: [
    { id: 'sasha', label: 'sasha' },
    { id: 'root', label: 'root' }
  ]
}

describe('Store identity configs', () => {
  let dir: string
  let store: Store

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcc-store-'))
    store = new Store(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('defaults to empty', () => {
    expect(store.getIdentityConfigs()).toEqual([])
  })

  it('saves, upserts by serverId, and persists', () => {
    store.saveIdentityConfig(CFG)
    store.saveIdentityConfig({ ...CFG, activeIdentityId: 'root' })
    expect(store.getIdentityConfigs()).toHaveLength(1)
    expect(store.getIdentityConfigs()[0].activeIdentityId).toBe('root')
    const reloaded = new Store(dir)
    expect(reloaded.getIdentityConfigs()[0].serverId).toBe('opnsense')
  })

  it('deletes by serverId', () => {
    store.saveIdentityConfig(CFG)
    store.deleteIdentityConfig('opnsense')
    expect(store.getIdentityConfigs()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — `store.getIdentityConfigs is not a function`

- [ ] **Step 3: Implement** — in `src/main/services/store.ts`:

Add `ServerIdentityConfig` to the type import from `'../../shared/types'`. Extend `Persisted`:

```ts
interface Persisted {
  preferences: Preferences
  profiles: Profile[]
  dismissedSuggestions: string[]
  suggestions: Suggestion[]
  identityConfigs: ServerIdentityConfig[]
}
```

In `load()`, add `identityConfigs: []` to the `base` object and `identityConfigs: parsed.identityConfigs ?? []` to the parsed return. After `deleteProfile`, add:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/store.ts test/store.test.ts
git commit -m "feat(identities): persist identity configs in store"
```

---

### Task 4: ConnectionEngine — serverId-aware secret resolver

**Files:**
- Modify: `src/main/services/connectionEngine.ts:13` and `:57-59`
- Modify: `src/main/services/index.ts:43`
- Modify: `test/connectionEngine.test.ts:51`

- [ ] **Step 1: Update the resolver type and call site** — in `src/main/services/connectionEngine.ts` change line 13:

```ts
export type SecretResolver = (serverId: string, keys: string[]) => Record<string, string>
```

and the call in `computeNext` (lines 57-59):

```ts
        const secrets = this.resolveSecrets(
          item.server.id,
          (item.server.requiredSecrets ?? []).map((s) => s.key)
        )
```

Also update the constructor default on line 33: `private resolveSecrets: SecretResolver = () => ({})` stays valid as-is (extra params are fine), leave it.

- [ ] **Step 2: Update the composition** — in `src/main/services/index.ts` line 43, change the engine construction's third argument to:

```ts
      (_serverId, keys) => this.secrets.resolve(keys)
```

(Identity-aware resolution lands in Task 8 once `IdentityService` exists.)

- [ ] **Step 3: Update the engine test** — in `test/connectionEngine.test.ts` line 51, change the resolver stub to:

```ts
      (_serverId, keys) => Object.fromEntries(keys.map((k) => [k, 'secret-' + k]))
```

- [ ] **Step 4: Add the adapter-level env test** — append to `test/connectionEngine.test.ts` (inside the top-level `describe`): a per-server resolver must land its values in the written env for both Claude formats.

```ts
  it('injects serverId-resolved secrets into env for claude-desktop and claude-code formats', () => {
    const mk = (format: 'claude-desktop' | 'claude-code', path: string): DetectedClient => ({
      id: format,
      name: format,
      format,
      configPath: path,
      installed: true,
      configExists: false,
      servers: []
    })
    const cdPath = join(dir, 'cd.json')
    const ccPath = join(dir, 'cc.json')
    const eng = new ConnectionEngine(
      join(dir, 'b2'),
      () => [mk('claude-desktop', cdPath), mk('claude-code', ccPath)],
      (serverId, keys) => Object.fromEntries(keys.map((k) => [k, `${serverId}:root:${k}`]))
    )
    const plan: ConnectionPlan = {
      id: 'p2',
      title: 't',
      items: [
        { clientId: 'claude-desktop', server: GH, action: 'connect' },
        { clientId: 'claude-code', server: GH, action: 'connect' }
      ],
      missingSecrets: []
    }
    const results = eng.apply(plan)
    expect(results.every((r) => r.ok)).toBe(true)
    for (const p of [cdPath, ccPath]) {
      const written = JSON.parse(readFileSync(p, 'utf8'))
      expect(written.mcpServers.github.env.TOKEN).toBe('github:root:TOKEN')
    }
  })
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/connectionEngine.test.ts && npm run typecheck`
Expected: PASS, no type errors

- [ ] **Step 6: Commit**

```bash
git add src/main/services/connectionEngine.ts src/main/services/index.ts test/connectionEngine.test.ts
git commit -m "refactor(identities): secret resolver receives serverId"
```

---

### Task 5: Health check — request construction and transport

**Files:**
- Create: `src/main/services/identities.ts`
- Create: `test/identities.test.ts`

- [ ] **Step 1: Write the failing tests** — create `test/identities.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHealthRequest } from '../src/main/services/identities'
import type { IdentityHealthCheck } from '../src/shared/types'

describe('buildHealthRequest', () => {
  const base: IdentityHealthCheck = {
    url: 'https://fw.example/api/core/firmware/status',
    auth: 'basic',
    usernameSecretKey: 'OPNSENSE_API_KEY',
    passwordSecretKey: 'OPNSENSE_API_SECRET',
    skipTlsVerify: true
  }

  it('builds basic auth from the two referenced secrets', () => {
    const spec = buildHealthRequest(base, {
      OPNSENSE_API_KEY: 'user1',
      OPNSENSE_API_SECRET: 'pass1'
    })
    expect(spec.method).toBe('GET')
    expect(spec.rejectUnauthorized).toBe(false)
    expect(spec.headers.Authorization).toBe(
      'Basic ' + Buffer.from('user1:pass1').toString('base64')
    )
  })

  it('builds bearer auth from passwordSecretKey', () => {
    const spec = buildHealthRequest(
      { url: 'https://x', auth: 'bearer', passwordSecretKey: 'TOKEN' },
      { TOKEN: 'tok' }
    )
    expect(spec.headers.Authorization).toBe('Bearer tok')
    expect(spec.rejectUnauthorized).toBe(true)
  })

  it('sends no auth header for auth none and honors method', () => {
    const spec = buildHealthRequest({ url: 'https://x', auth: 'none', method: 'POST' }, {})
    expect(spec.headers.Authorization).toBeUndefined()
    expect(spec.method).toBe('POST')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/identities.test.ts`
Expected: FAIL — cannot resolve `../src/main/services/identities`

- [ ] **Step 3: Create `src/main/services/identities.ts`** with the health-check half (the service class comes in Task 6):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/identities.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/identities.ts test/identities.test.ts
git commit -m "feat(identities): health check request construction and node transport"
```

---

### Task 6: IdentityService — resolve, save, delete, secretsPresent

**Files:**
- Modify: `src/main/services/identities.ts`
- Modify: `test/identities.test.ts`

The service depends on narrow structural ports (not the concrete classes) so tests need no electron mocks.

- [ ] **Step 1: Write the failing tests** — append to `test/identities.test.ts`:

```ts
import { IdentityService, identitySecretKey } from '../src/main/services/identities'
import type { ServerIdentityConfig, ServerSpec, ApplyResult } from '../src/shared/types'

function fakeSecrets(): {
  store: Map<string, string>
  port: ConstructorParameters<typeof IdentityService>[1]
} {
  const store = new Map<string, string>()
  return {
    store,
    port: {
      get: (k: string) => store.get(k),
      set: (k: string, v: string) => void store.set(k, v),
      has: (k: string) => store.has(k),
      delete: (k: string) => void store.delete(k),
      keysWithPrefix: (p: string) => [...store.keys()].filter((k) => k.startsWith(p)),
      resolve: (keys: string[]) =>
        Object.fromEntries(keys.flatMap((k) => (store.has(k) ? [[k, store.get(k)!]] : [])))
    }
  }
}

function fakeStore(initial: ServerIdentityConfig[] = []): {
  configs: ServerIdentityConfig[]
  port: ConstructorParameters<typeof IdentityService>[0]
} {
  const configs = [...initial]
  return {
    configs,
    port: {
      getIdentityConfigs: () => configs,
      saveIdentityConfig: (cfg: ServerIdentityConfig) => {
        const i = configs.findIndex((c) => c.serverId === cfg.serverId)
        if (i >= 0) configs[i] = cfg
        else configs.push(cfg)
        return configs
      },
      deleteIdentityConfig: (serverId: string) => {
        const i = configs.findIndex((c) => c.serverId === serverId)
        if (i >= 0) configs.splice(i, 1)
        return configs
      }
    }
  }
}

const OPNSENSE: ServerSpec = {
  id: 'opnsense',
  name: 'OPNsense',
  description: '',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@richard-stovall/opnsense-mcp-server'],
  tags: [],
  source: 'bundled',
  requiredSecrets: [
    { key: 'OPNSENSE_API_KEY', label: 'API key', target: 'env', required: true },
    { key: 'OPNSENSE_API_SECRET', label: 'API secret', target: 'env', required: true }
  ]
}

const TWO_IDS: ServerIdentityConfig = {
  serverId: 'opnsense',
  activeIdentityId: 'sasha',
  identities: [
    { id: 'sasha', label: 'sasha' },
    { id: 'root', label: 'root' }
  ]
}

function makeService(opts: {
  configs?: ServerIdentityConfig[]
  clients?: { id: string; serverIds: string[] }[]
  applyResults?: ApplyResult[]
  transportStatus?: number | Error
}) {
  const secrets = fakeSecrets()
  const store = fakeStore(opts.configs ?? [])
  const applied: ConnectionPlan_[] = []
  const svc = new IdentityService(
    store.port,
    secrets.port,
    { byId: (id: string) => (id === 'opnsense' ? OPNSENSE : undefined) },
    () =>
      (opts.clients ?? []).map((c) => ({
        id: c.id,
        name: c.id,
        format: 'claude-desktop' as const,
        configPath: '/x',
        installed: true,
        configExists: true,
        servers: c.serverIds.map((sid) => ({ id: sid, transport: 'stdio' as const }))
      })),
    {
      apply: (plan) => {
        applied.push(plan)
        return opts.applyResults ?? []
      }
    },
    async () => {
      if (opts.transportStatus instanceof Error) throw opts.transportStatus
      return { status: opts.transportStatus ?? 200 }
    }
  )
  return { svc, secrets, store, applied }
}
type ConnectionPlan_ = Parameters<
  ConstructorParameters<typeof IdentityService>[4]['apply']
>[0]

describe('IdentityService resolve/save/delete', () => {
  it('resolveForServer returns active identity values, omitting unset keys', () => {
    const { svc, secrets } = makeService({ configs: [structuredClone(TWO_IDS)] })
    secrets.store.set(identitySecretKey('opnsense', 'sasha', 'OPNSENSE_API_KEY'), 'k1')
    const out = svc.resolveForServer('opnsense', ['OPNSENSE_API_KEY', 'OPNSENSE_API_SECRET'])
    expect(out).toEqual({ OPNSENSE_API_KEY: 'k1' })
  })

  it('resolveForServer returns undefined for servers without identities', () => {
    const { svc } = makeService({})
    expect(svc.resolveForServer('github', ['TOKEN'])).toBeUndefined()
  })

  it('save stores non-empty secret values and prunes removed identities', () => {
    const { svc, secrets } = makeService({ configs: [structuredClone(TWO_IDS)] })
    svc.save(structuredClone(TWO_IDS), {
      root: { OPNSENSE_API_KEY: 'rk', OPNSENSE_API_SECRET: '' }
    })
    expect(secrets.store.get(identitySecretKey('opnsense', 'root', 'OPNSENSE_API_KEY'))).toBe('rk')
    expect(secrets.store.has(identitySecretKey('opnsense', 'root', 'OPNSENSE_API_SECRET'))).toBe(
      false
    )
    // now remove the root identity entirely — its secrets must be pruned
    svc.save(
      { serverId: 'opnsense', activeIdentityId: 'sasha', identities: [{ id: 'sasha', label: 'sasha' }] },
      undefined
    )
    expect(secrets.store.has(identitySecretKey('opnsense', 'root', 'OPNSENSE_API_KEY'))).toBe(false)
  })

  it('save with zero identities deletes the config and prunes all secrets', () => {
    const { svc, secrets, store } = makeService({ configs: [structuredClone(TWO_IDS)] })
    secrets.store.set(identitySecretKey('opnsense', 'sasha', 'OPNSENSE_API_KEY'), 'x')
    svc.save({ serverId: 'opnsense', activeIdentityId: '', identities: [] })
    expect(store.configs).toEqual([])
    expect(secrets.store.size).toBe(0)
  })

  it('delete removes the config and all namespaced secrets', () => {
    const { svc, secrets, store } = makeService({ configs: [structuredClone(TWO_IDS)] })
    secrets.store.set(identitySecretKey('opnsense', 'sasha', 'OPNSENSE_API_KEY'), 'x')
    svc.delete('opnsense')
    expect(store.configs).toEqual([])
    expect(secrets.store.size).toBe(0)
  })

  it('secretsPresent maps serverId:identityId to set key names', () => {
    const { svc, secrets } = makeService({ configs: [structuredClone(TWO_IDS)] })
    secrets.store.set(identitySecretKey('opnsense', 'root', 'OPNSENSE_API_KEY'), 'x')
    expect(svc.secretsPresent()).toEqual({
      'opnsense:sasha': [],
      'opnsense:root': ['OPNSENSE_API_KEY']
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/identities.test.ts`
Expected: FAIL — `IdentityService` not exported

- [ ] **Step 3: Implement the service** — append to `src/main/services/identities.ts`:

```ts
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
  resolve(keys: string[]): Record<string, string>
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
   */
  save(
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): ServerIdentityConfig[] {
    if (cfg.identities.length === 0) return this.delete(cfg.serverId)
    for (const [identityId, values] of Object.entries(secretValues ?? {})) {
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
    if (!identity.healthCheck) return { ok: true }
    const spec = buildHealthRequest(identity.healthCheck, this.identityValues(serverId, identityId))
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/identities.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/identities.ts test/identities.test.ts
git commit -m "feat(identities): IdentityService resolve/save/delete/secretsPresent"
```

---

### Task 7: IdentityService.switch — tests

**Files:**
- Modify: `test/identities.test.ts`

(The implementation already landed in Task 6 — these tests pin the switch flow's behavior. If any fail, fix `switch()` until they pass; do not change the tests.)

- [ ] **Step 1: Write the tests** — append to `test/identities.test.ts`:

```ts
describe('IdentityService.switch', () => {
  const withSecrets = (svcBundle: ReturnType<typeof makeService>): void => {
    for (const id of ['sasha', 'root']) {
      svcBundle.secrets.store.set(identitySecretKey('opnsense', id, 'OPNSENSE_API_KEY'), 'k-' + id)
      svcBundle.secrets.store.set(
        identitySecretKey('opnsense', id, 'OPNSENSE_API_SECRET'),
        's-' + id
      )
    }
  }

  it('blocks when required secrets are unset', async () => {
    const b = makeService({ configs: [structuredClone(TWO_IDS)] })
    const r = await b.svc.switch('opnsense', 'root')
    expect(r.blocked).toBe('missing-secrets')
    expect(r.missingKeys).toEqual(['OPNSENSE_API_KEY', 'OPNSENSE_API_SECRET'])
    expect(b.applied).toHaveLength(0)
    expect(b.store.configs[0].activeIdentityId).toBe('sasha') // unchanged
  })

  it('blocks on failed health check without flipping or applying', async () => {
    const cfg = structuredClone(TWO_IDS)
    cfg.identities[1].healthCheck = {
      url: 'https://fw/api/core/firmware/status',
      auth: 'basic',
      usernameSecretKey: 'OPNSENSE_API_KEY',
      passwordSecretKey: 'OPNSENSE_API_SECRET'
    }
    const b = makeService({ configs: [cfg], transportStatus: 401 })
    withSecrets(b)
    const r = await b.svc.switch('opnsense', 'root')
    expect(r.blocked).toBe('health-check')
    expect(r.healthCheck).toEqual({ ok: false, status: 401 })
    expect(b.applied).toHaveLength(0)
    expect(b.store.configs[0].activeIdentityId).toBe('sasha')
  })

  it('flips the pointer and re-applies to exactly the clients that have the server', async () => {
    const b = makeService({
      configs: [structuredClone(TWO_IDS)],
      clients: [
        { id: 'claude-code', serverIds: ['opnsense', 'git'] },
        { id: 'claude-desktop', serverIds: ['opnsense'] },
        { id: 'cursor', serverIds: ['git'] }
      ],
      applyResults: [
        { clientId: 'claude-code', serverId: 'opnsense', action: 'connect', ok: true },
        { clientId: 'claude-desktop', serverId: 'opnsense', action: 'connect', ok: true }
      ]
    })
    withSecrets(b)
    const r = await b.svc.switch('opnsense', 'root')
    expect(r.blocked).toBeUndefined()
    expect(b.store.configs[0].activeIdentityId).toBe('root')
    expect(b.applied).toHaveLength(1)
    expect(b.applied[0].items.map((i) => i.clientId).sort()).toEqual([
      'claude-code',
      'claude-desktop'
    ])
    expect(r.applyResults).toHaveLength(2)
  })

  it('returns not-found for unknown server or identity', async () => {
    const b = makeService({ configs: [structuredClone(TWO_IDS)] })
    expect((await b.svc.switch('nope', 'root')).blocked).toBe('not-found')
    expect((await b.svc.switch('opnsense', 'nope')).blocked).toBe('not-found')
  })
})
```

- [ ] **Step 2: Run the full identity suite**

Run: `npx vitest run test/identities.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 3: Commit**

```bash
git add test/identities.test.ts
git commit -m "test(identities): pin switch flow behavior"
```

---

### Task 8: Wire everything — Services, IPC, preload, shared api, mock

**Files:**
- Modify: `src/main/services/index.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/shared/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/mockApi.ts`

- [ ] **Step 1: Wire `Services`** — in `src/main/services/index.ts`:

Add to imports: `import { IdentityService } from './identities'` and add `ServerIdentityConfig, SwitchResult, HealthCheckResult` to the type import if needed by signatures below. Add the field and construction (engine first, identities after — the resolver closure references `this.identities` lazily, which is safe because resolution only runs on apply):

```ts
  readonly identities: IdentityService
```

In the constructor replace the engine + advisor block with:

```ts
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
```

In `getState()`, replace the Task 1 stubs with real values:

```ts
      profiles: this.store.getProfiles(),
      identityConfigs: this.store.getIdentityConfigs(),
      identitySecretsPresent: this.identities.secretsPresent()
```

- [ ] **Step 2: IPC handlers** — in `src/main/ipc.ts`, add `ServerIdentityConfig` to the type import and after the `applyProfile` handler add:

```ts
  ipcMain.handle(
    IPC.saveIdentities,
    (_e, cfg: ServerIdentityConfig, secretValues?: Record<string, Record<string, string>>) =>
      services.identities.save(cfg, secretValues)
  )

  ipcMain.handle(IPC.switchIdentity, (_e, serverId: string, identityId: string) => {
    services.refreshClients() // ensure latest on-disk state before writing
    return services.identities.switch(serverId, identityId)
  })

  ipcMain.handle(IPC.testIdentity, (_e, serverId: string, identityId: string) =>
    services.identities.test(serverId, identityId)
  )

  ipcMain.handle(IPC.deleteIdentities, (_e, serverId: string) =>
    services.identities.delete(serverId)
  )
```

- [ ] **Step 3: Shared api surface** — in `src/shared/api.ts`, add `ServerIdentityConfig, SwitchResult, HealthCheckResult` to the type import and these members to `McpApi` after `applyProfile`:

```ts
  saveIdentities(
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): Promise<ServerIdentityConfig[]>
  switchIdentity(serverId: string, identityId: string): Promise<SwitchResult>
  testIdentity(serverId: string, identityId: string): Promise<HealthCheckResult>
  deleteIdentities(serverId: string): Promise<ServerIdentityConfig[]>
```

- [ ] **Step 4: Preload bridge** — in `src/preload/index.ts`, add the same three types to the type import and these entries to the `api` object after `applyProfile`:

```ts
  saveIdentities: (
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): Promise<ServerIdentityConfig[]> => ipcRenderer.invoke(IPC.saveIdentities, cfg, secretValues),
  switchIdentity: (serverId: string, identityId: string): Promise<SwitchResult> =>
    ipcRenderer.invoke(IPC.switchIdentity, serverId, identityId),
  testIdentity: (serverId: string, identityId: string): Promise<HealthCheckResult> =>
    ipcRenderer.invoke(IPC.testIdentity, serverId, identityId),
  deleteIdentities: (serverId: string): Promise<ServerIdentityConfig[]> =>
    ipcRenderer.invoke(IPC.deleteIdentities, serverId),
```

- [ ] **Step 5: Mock api** — in `src/renderer/src/mockApi.ts`, add matching members to the returned mock object (find where it implements `applyProfile` and append alongside, importing the types it needs):

```ts
  saveIdentities: async (cfg) => [cfg],
  switchIdentity: async () => ({ applyResults: [] }),
  testIdentity: async () => ({ ok: true, status: 200 }),
  deleteIdentities: async () => [],
```

Also confirm the mock's `getState` object includes `identityConfigs: []` and `identitySecretsPresent: {}` (added as stubs in Task 1).

- [ ] **Step 6: Typecheck and full test run**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors; all suites pass

- [ ] **Step 7: Commit**

```bash
git add src/main/services/index.ts src/main/ipc.ts src/shared/api.ts src/preload/index.ts src/renderer/src/mockApi.ts
git commit -m "feat(identities): wire IdentityService through services, IPC, preload, and mock"
```

---

### Task 9: IdentitySwitcher component + Matrix integration

**Files:**
- Create: `src/renderer/src/components/IdentitySwitcher.tsx`
- Modify: `src/renderer/src/views/Matrix.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/IdentitySwitcher.tsx`:**

```tsx
import React, { useState } from 'react'
import { api } from '../api'
import { Badge } from './ui'
import type { ServerIdentityConfig, SwitchResult } from '@shared/types'

/** Inline identity chip + dropdown for a server row. */
export function IdentitySwitcher({
  config,
  onManage,
  onSwitched
}: {
  config: ServerIdentityConfig
  onManage: () => void
  onSwitched: (result: SwitchResult, identityLabel: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)

  const active = config.identities.find((i) => i.id === config.activeIdentityId)

  async function doSwitch(identityId: string, label: string): Promise<void> {
    setBusy(identityId)
    try {
      const result = await api.switchIdentity(config.serverId, identityId)
      setVerified(result.blocked === undefined && result.healthCheck?.ok === true)
      onSwitched(result, label)
      if (!result.blocked) setOpen(false)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative inline-flex items-center gap-1 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-edge bg-ink text-gray-300 hover:border-muted"
        title="Switch credential identity"
      >
        <span className="text-muted">id:</span>
        <span className="font-medium">{active?.label ?? '—'}</span>
        <span className="text-muted">▾</span>
      </button>
      {verified && <Badge tone="good">verified</Badge>}
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-40 rounded-md border border-edge bg-panel2 shadow-lg">
          {config.identities.map((identity) => (
            <button
              key={identity.id}
              disabled={busy !== null || identity.id === config.activeIdentityId}
              onClick={() => void doSwitch(identity.id, identity.label)}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-edge disabled:opacity-60"
            >
              <span>{identity.label}</span>
              {identity.id === config.activeIdentityId ? (
                <span className="text-muted">active</span>
              ) : (
                <span className="text-claw">{busy === identity.id ? '…' : 'switch'}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => {
              setOpen(false)
              onManage()
            }}
            className="w-full border-t border-edge px-3 py-1.5 text-left text-muted hover:bg-edge"
          >
            Manage identities…
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Integrate into the Matrix server cell** — in `src/renderer/src/views/Matrix.tsx`:

Add imports:

```ts
import { IdentitySwitcher } from '../components/IdentitySwitcher'
import type { ConnectionPlan, ServerSpec, SwitchResult } from '@shared/types'
```

Add state next to the existing `useState` calls:

```ts
  const [identityServer, setIdentityServer] = useState<ServerSpec | null>(null)
  const [switchNote, setSwitchNote] = useState<string | null>(null)
```

Add a helper above `return`:

```ts
  function describeSwitch(r: SwitchResult, serverName: string, label: string): string {
    if (r.blocked === 'health-check')
      return `${serverName}: health check failed (${r.healthCheck?.status ?? r.healthCheck?.error}) — switch blocked`
    if (r.blocked === 'missing-secrets')
      return `${serverName}: missing secrets ${r.missingKeys?.join(', ')} — switch blocked`
    if (r.blocked === 'not-found') return `${serverName}: identity not found`
    const failed = r.applyResults.filter((a) => !a.ok)
    if (failed.length) return `${serverName} → ${label}: ${failed.length} client(s) failed to update`
    return `${serverName} → ${label}: applied to ${r.applyResults.length} client(s) — restart them to pick it up`
  }
```

In the server `<td>` (after the existing tags `<div className="text-xs text-muted">…`), render the switcher when a config exists:

```tsx
                  {(() => {
                    const cfg = state.identityConfigs.find((c) => c.serverId === s.id)
                    return cfg ? (
                      <div className="mt-1">
                        <IdentitySwitcher
                          config={cfg}
                          onManage={() => setIdentityServer(s)}
                          onSwitched={(r, label) => {
                            setSwitchNote(describeSwitch(r, s.name, label))
                            void reload()
                          }}
                        />
                      </div>
                    ) : null
                  })()}
```

Below the `<header>` element (before the "No installed clients" block), surface the note:

```tsx
      {switchNote && (
        <div className="flex items-center justify-between rounded-md border border-edge bg-panel2 px-3 py-2 text-sm text-gray-300">
          <span>{switchNote}</span>
          <button className="text-muted hover:text-gray-200" onClick={() => setSwitchNote(null)}>
            ✕
          </button>
        </div>
      )}
```

(`identityServer` drives the editor modal added in Task 10 — at this commit it is set but never read, which TypeScript allows. If `npm run typecheck` rejects it anyway, commit Tasks 9 and 10 together as one commit instead.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (TS allows unused state variables; only unused imports error)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/IdentitySwitcher.tsx src/renderer/src/views/Matrix.tsx
git commit -m "feat(identities): identity switcher in matrix server rows"
```

---

### Task 10: Identity editor modal

**Files:**
- Create: `src/renderer/src/components/IdentityModal.tsx`
- Modify: `src/renderer/src/views/Matrix.tsx`

- [ ] **Step 1: Create `src/renderer/src/components/IdentityModal.tsx`:**

```tsx
import React, { useState } from 'react'
import { api } from '../api'
import { Button, Badge, Modal } from './ui'
import type {
  HealthCheckResult,
  ServerIdentityConfig,
  ServerIdentity,
  ServerSpec
} from '@shared/types'

/** Create/edit a server's identities, their secret values, and health checks. */
export function IdentityModal({
  server,
  config,
  secretsPresent,
  onClose,
  onSaved
}: {
  server: ServerSpec
  config: ServerIdentityConfig | null
  /** "<serverId>:<identityId>" -> set secret key names (from AppState). */
  secretsPresent: Record<string, string[]>
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [identities, setIdentities] = useState<ServerIdentity[]>(
    config?.identities ?? [{ id: 'default', label: 'default' }]
  )
  const [activeId, setActiveId] = useState(config?.activeIdentityId ?? identities[0]?.id ?? '')
  // values[identityId][secretKey] — only non-empty entries are sent (write-only).
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [testResult, setTestResult] = useState<Record<string, HealthCheckResult>>({})
  const [saving, setSaving] = useState(false)

  const secretKeys = (server.requiredSecrets ?? []).map((r) => r.key)

  function setIdentity(idx: number, patch: Partial<ServerIdentity>): void {
    setIdentities((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function setValue(identityId: string, key: string, value: string): void {
    setValues((prev) => ({ ...prev, [identityId]: { ...prev[identityId], [key]: value } }))
  }

  function addIdentity(): void {
    const id = `id-${Date.now().toString(36)}`
    setIdentities((prev) => [...prev, { id, label: '' }])
  }

  function removeIdentity(idx: number): void {
    const removed = identities[idx]
    const next = identities.filter((_, i) => i !== idx)
    setIdentities(next)
    if (removed.id === activeId && next.length) setActiveId(next[0].id)
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await api.saveIdentities(
        { serverId: server.id, identities, activeIdentityId: activeId },
        values
      )
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function test(identity: ServerIdentity): Promise<void> {
    // Save first so the health check runs against current values, then test.
    await api.saveIdentities(
      { serverId: server.id, identities, activeIdentityId: activeId },
      values
    )
    const r = await api.testIdentity(server.id, identity.id)
    setTestResult((prev) => ({ ...prev, [identity.id]: r }))
  }

  return (
    <Modal title={`Identities — ${server.name}`} onClose={onClose} wide>
      <div className="space-y-4">
        {identities.map((identity, idx) => {
          const present = secretsPresent[`${server.id}:${identity.id}`] ?? []
          const hc = identity.healthCheck
          const result = testResult[identity.id]
          return (
            <div key={identity.id} className="rounded-lg border border-edge p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={identity.label}
                  placeholder="label (e.g. root)"
                  onChange={(e) => setIdentity(idx, { label: e.target.value })}
                  className="bg-ink border border-edge rounded-md px-2 py-1 text-sm w-40"
                />
                <label className="flex items-center gap-1 text-xs text-muted">
                  <input
                    type="radio"
                    checked={activeId === identity.id}
                    onChange={() => setActiveId(identity.id)}
                  />
                  active
                </label>
                {result && (
                  <Badge tone={result.ok ? 'good' : 'bad'}>
                    {result.ok ? `ok ${result.status ?? ''}` : (result.error ?? `HTTP ${result.status}`)}
                  </Badge>
                )}
                <div className="ml-auto flex gap-2">
                  <Button onClick={() => void test(identity)}>Test</Button>
                  <Button variant="danger" onClick={() => removeIdentity(idx)}>
                    Remove
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {secretKeys.map((key) => (
                  <label key={key} className="text-xs text-muted">
                    {key}
                    <input
                      type="password"
                      placeholder={present.includes(key) ? '••••• (set — blank keeps)' : 'not set'}
                      value={values[identity.id]?.[key] ?? ''}
                      onChange={(e) => setValue(identity.id, key, e.target.value)}
                      className="mt-0.5 w-full bg-ink border border-edge rounded-md px-2 py-1 text-sm text-gray-200"
                    />
                  </label>
                ))}
              </div>
              <details open={Boolean(hc)}>
                <summary className="text-xs text-muted cursor-pointer">
                  Health check (optional)
                </summary>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <label className="col-span-2 text-muted">
                    URL
                    <input
                      value={hc?.url ?? ''}
                      placeholder="https://host/api/health"
                      onChange={(e) =>
                        setIdentity(idx, {
                          healthCheck: e.target.value
                            ? { auth: 'basic', ...hc, url: e.target.value }
                            : undefined
                        })
                      }
                      className="mt-0.5 w-full bg-ink border border-edge rounded-md px-2 py-1 text-sm text-gray-200"
                    />
                  </label>
                  {hc && (
                    <>
                      <label className="text-muted">
                        Auth
                        <select
                          value={hc.auth}
                          onChange={(e) =>
                            setIdentity(idx, {
                              healthCheck: { ...hc, auth: e.target.value as typeof hc.auth }
                            })
                          }
                          className="mt-0.5 w-full bg-ink border border-edge rounded-md px-2 py-1 text-sm text-gray-200"
                        >
                          <option value="basic">basic</option>
                          <option value="bearer">bearer</option>
                          <option value="none">none</option>
                        </select>
                      </label>
                      {hc.auth === 'basic' && (
                        <label className="text-muted">
                          Username key
                          <select
                            value={hc.usernameSecretKey ?? ''}
                            onChange={(e) =>
                              setIdentity(idx, {
                                healthCheck: { ...hc, usernameSecretKey: e.target.value }
                              })
                            }
                            className="mt-0.5 w-full bg-ink border border-edge rounded-md px-2 py-1 text-sm text-gray-200"
                          >
                            <option value="">—</option>
                            {secretKeys.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {hc.auth !== 'none' && (
                        <label className="text-muted">
                          {hc.auth === 'basic' ? 'Password key' : 'Token key'}
                          <select
                            value={hc.passwordSecretKey ?? ''}
                            onChange={(e) =>
                              setIdentity(idx, {
                                healthCheck: { ...hc, passwordSecretKey: e.target.value }
                              })
                            }
                            className="mt-0.5 w-full bg-ink border border-edge rounded-md px-2 py-1 text-sm text-gray-200"
                          >
                            <option value="">—</option>
                            {secretKeys.map((k) => (
                              <option key={k} value={k}>
                                {k}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label className="flex items-center gap-1 text-muted">
                        <input
                          type="checkbox"
                          checked={hc.skipTlsVerify ?? false}
                          onChange={(e) =>
                            setIdentity(idx, {
                              healthCheck: { ...hc, skipTlsVerify: e.target.checked }
                            })
                          }
                        />
                        skip TLS verify (self-signed)
                      </label>
                    </>
                  )}
                </div>
              </details>
            </div>
          )
        })}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={addIdentity}>
            + Add identity
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saving || identities.some((i) => !i.label.trim())}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Wire the modal into Matrix** — in `src/renderer/src/views/Matrix.tsx`:

Add import: `import { IdentityModal } from '../components/IdentityModal'`

Add an "identities" affordance for servers WITHOUT a config — in the server `<td>`, extend the Task 9 block's `null` branch (servers with a config keep the switcher):

```tsx
                    ) : (
                      <button
                        onClick={() => setIdentityServer(s)}
                        className="mt-1 text-[11px] text-muted hover:text-gray-300"
                        title="Define credential identities for this server"
                      >
                        + identities
                      </button>
                    )
```

Next to the existing `<PlanReviewModal>` at the bottom, render:

```tsx
      {identityServer && (
        <IdentityModal
          server={identityServer}
          config={state.identityConfigs.find((c) => c.serverId === identityServer.id) ?? null}
          secretsPresent={state.identitySecretsPresent}
          onClose={() => setIdentityServer(null)}
          onSaved={() => void reload()}
        />
      )}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/IdentityModal.tsx src/renderer/src/views/Matrix.tsx
git commit -m "feat(identities): identity editor modal"
```

---

### Task 11: Full verification and smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full test suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all suites pass (clientAdapters, connectionEngine, registry, secrets, store, identities), zero type errors

- [ ] **Step 2: Smoke test in dev** — Run: `npm run dev`, then in the app:
1. Open the Matrix view → every server row shows a small `+ identities` affordance; rows render normally otherwise.
2. Click `+ identities` on any server with required secrets (e.g. github) → modal opens; add two identities, set values, save → row now shows the `id: <label> ▾` chip.
3. Open the chip → switch to the other identity → note strip appears reporting applied clients (0 if the server isn't wired anywhere — that's valid).
4. Re-open the modal → placeholders show `(set — blank keeps)` for stored keys; blank inputs on save leave them intact (switch still works).
5. Close and relaunch the app → config and active identity persist.

Expected: all five behaviors as described, no devtools console errors.

- [ ] **Step 3: Update README feature list** — `README.md` has a features section; add one line:

```markdown
- **Credential identities** — give a server multiple named credential sets (e.g. user vs. root API keys) with an optional health check, and switch between them with one click; secrets stay OS-encrypted, never in client configs until apply.
```

(Adjust placement/format to match the existing list style.)

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: credential identities feature blurb"
```

---

## Post-ship configuration (the motivating OPNsense case — manual, not code)

After the feature is merged and the app rebuilt: add the `opnsense` server to the catalog/registry if not present (`resources/registry/servers.json` — `npx -y @richard-stovall/opnsense-mcp-server`, env `OPNSENSE_URL`, `OPNSENSE_VERIFY_SSL`, requiredSecrets `OPNSENSE_API_KEY` + `OPNSENSE_API_SECRET`), create identities `sasha` and `root`, paste the keys from the DPAPI files (`D:\Users\sasha\Documents\opnsense\tcs-opn1-{sasha,root}-apikey.dpapi.xml`, decrypt via `Import-Clixml`), set the health check to `https://tcs-opn1.thecornerspore.dev/api/core/firmware/status`, basic auth, skip TLS verify. Then retire `Use-OpnsenseKey.ps1`.
