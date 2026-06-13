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
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [testResult, setTestResult] = useState<Record<string, HealthCheckResult>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const secretKeys = (server.requiredSecrets ?? []).map((r) => r.key)
  const invalid = identities.some((i) => !i.label.trim())

  function setIdentity(idx: number, patch: Partial<ServerIdentity>): void {
    setIdentities((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function setValue(identityId: string, key: string, value: string): void {
    setValues((prev) => ({ ...prev, [identityId]: { ...prev[identityId], [key]: value } }))
  }

  function addIdentity(): void {
    const id = `id-${crypto.randomUUID().slice(0, 8)}`
    setIdentities((prev) => [...prev, { id, label: '' }])
  }

  function removeIdentity(idx: number): void {
    const removed = identities[idx]
    const next = identities.filter((_, i) => i !== idx)
    setIdentities(next)
    if (removed.id === activeId && next.length) setActiveId(next[0].id)
  }

  async function save(): Promise<void> {
    setError(null)
    setSaving(true)
    try {
      await api.saveIdentities(
        { serverId: server.id, identities, activeIdentityId: activeId },
        values
      )
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function test(identity: ServerIdentity): Promise<void> {
    setError(null)
    try {
      await api.saveIdentities(
        { serverId: server.id, identities, activeIdentityId: activeId },
        values
      )
      onSaved()
      const r = await api.testIdentity(server.id, identity.id)
      setTestResult((prev) => ({ ...prev, [identity.id]: r }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
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
                  <Button onClick={() => void test(identity)} disabled={invalid}>Test</Button>
                  <Button variant="danger" onClick={() => removeIdentity(idx)}>
                    Remove
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {secretKeys.map((key) => (
                  <label key={key} className="text-xs text-muted">
                    {key}
                    {present.includes(key) && <span className="text-good"> · saved</span>}
                    <input
                      type="password"
                      placeholder={
                        present.includes(key) ? 'leave blank to keep saved value' : 'enter value'
                      }
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
        {error && <div className="text-xs text-bad">{error}</div>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={addIdentity}>
            + Add identity
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saving || invalid}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
