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
