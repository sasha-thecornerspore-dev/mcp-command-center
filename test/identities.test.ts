import { describe, it, expect } from 'vitest'
import { buildHealthRequest, IdentityService, identitySecretKey } from '../src/main/services/identities'
import type { IdentityHealthCheck, ServerIdentityConfig, ServerSpec, ApplyResult } from '../src/shared/types'
import type { ConnectionPlan } from '../src/shared/types'

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
