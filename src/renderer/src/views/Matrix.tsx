import React, { useMemo, useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Button, Badge, Spinner } from '../components/ui'
import { PlanReviewModal } from '../components/PlanReviewModal'
import { IdentitySwitcher } from '../components/IdentitySwitcher'
import { IdentityModal } from '../components/IdentityModal'
import type { ConnectionPlan, ServerSpec, SwitchResult } from '@shared/types'

type Action = 'connect' | 'disconnect'

export function Matrix(): React.JSX.Element {
  const { state, reload, readiness } = useAppState()
  const [pending, setPending] = useState<Record<string, Action>>({})
  const [plan, setPlan] = useState<ConnectionPlan | null>(null)
  const [filter, setFilter] = useState('')
  const [identityServer, setIdentityServer] = useState<ServerSpec | null>(null)
  const [switchNote, setSwitchNote] = useState<string | null>(null)

  const clients = useMemo(
    () => (state ? state.clients.filter((c) => c.installed) : []),
    [state]
  )
  const servers = useMemo(() => {
    if (!state) return []
    const q = filter.toLowerCase()
    return state.catalog.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))
    )
  }, [state, filter])

  if (!state) return <Spinner />

  // A server whose host runtime is missing can be wired but won't launch — flag it.
  const runtimeGap = (runtime?: string): string | null => {
    if (!readiness || !runtime || runtime === 'none') return null
    if (runtime === 'node' && !readiness.ready.node) return 'needs Node'
    if (runtime === 'python' && !readiness.ready.python) return 'needs uv'
    if (runtime === 'docker' && !readiness.ready.docker) return 'needs Docker'
    return null
  }

  const isConnected = (clientId: string, serverId: string): boolean =>
    state.clients.find((c) => c.id === clientId)?.servers.some((s) => s.id === serverId) ?? false

  const key = (clientId: string, serverId: string): string => `${clientId}|${serverId}`

  function toggle(clientId: string, serverId: string): void {
    const connected = isConnected(clientId, serverId)
    const k = key(clientId, serverId)
    const desired: Action = connected ? 'disconnect' : 'connect'
    setPending((prev) => {
      const next = { ...prev }
      if (next[k]) delete next[k]
      else next[k] = desired
      return next
    })
  }

  // Effective state of a cell after pending edits.
  function cellState(clientId: string, serverId: string): 'on' | 'off' | 'will-on' | 'will-off' {
    const k = key(clientId, serverId)
    const connected = isConnected(clientId, serverId)
    if (pending[k] === 'connect') return 'will-on'
    if (pending[k] === 'disconnect') return 'will-off'
    return connected ? 'on' : 'off'
  }

  async function review(): Promise<void> {
    const changes = Object.entries(pending).map(([k, action]) => {
      const [clientId, serverId] = k.split('|')
      return { clientId, serverId, action }
    })
    if (!changes.length) return
    const p = await api.buildMatrixPlan(changes)
    setPlan(p)
  }

  const pendingCount = Object.keys(pending).length

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

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Connection Matrix</h1>
          <p className="text-muted text-sm">
            Click a cell to connect or disconnect a server, then review &amp; apply.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            placeholder="Filter servers…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-ink border border-edge rounded-md px-3 py-1.5 text-sm w-48"
          />
          {pendingCount > 0 && <Badge tone="warn">{pendingCount} pending</Badge>}
          <Button variant="primary" onClick={review} disabled={pendingCount === 0}>
            Review &amp; apply
          </Button>
        </div>
      </header>

      {switchNote && (
        <div className="flex items-center justify-between rounded-md border border-edge bg-panel2 px-3 py-2 text-sm text-gray-300">
          <span>{switchNote}</span>
          <button className="text-muted hover:text-gray-200" onClick={() => setSwitchNote(null)}>
            ✕
          </button>
        </div>
      )}

      {clients.length === 0 && (
        <div className="text-muted text-sm">
          No installed clients detected. Install Claude Desktop, Cursor, etc., or check Settings.
        </div>
      )}

      <div className="overflow-auto border border-edge rounded-xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-panel2">
              <th className="text-left px-4 py-3 sticky left-0 bg-panel2 z-10 font-medium text-gray-300">
                Server
              </th>
              {clients.map((c) => (
                <th key={c.id} className="px-3 py-3 text-center font-medium text-gray-300 min-w-28">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id} className="border-t border-edge hover:bg-panel2/40">
                <td className="px-4 py-2 sticky left-0 bg-panel z-10">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-100">{s.name}</span>
                    {runtimeGap(s.runtime) && <Badge tone="warn">{runtimeGap(s.runtime)}</Badge>}
                  </div>
                  <div className="text-xs text-muted">{s.tags.slice(0, 3).join(' · ')}</div>
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
                          onError={(msg) => setSwitchNote(`${s.name}: ${msg}`)}
                        />
                      </div>
                    ) : (
                      <button
                        onClick={() => setIdentityServer(s)}
                        className="mt-1 text-[11px] text-muted hover:text-gray-300"
                        title="Define credential identities for this server"
                      >
                        + identities
                      </button>
                    )
                  })()}
                </td>
                {clients.map((c) => {
                  const st = cellState(c.id, s.id)
                  return (
                    <td key={c.id} className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggle(c.id, s.id)}
                        title={`${st} — click to toggle`}
                        className={`w-7 h-7 rounded-md border transition-colors ${cellClass(st)}`}
                      >
                        {cellGlyph(st)}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan && (
        <PlanReviewModal
          plan={plan}
          onClose={() => setPlan(null)}
          onApplied={() => {
            setPending({})
            void reload()
          }}
        />
      )}
      {identityServer && (
        <IdentityModal
          key={identityServer.id}
          server={identityServer}
          config={state.identityConfigs.find((c) => c.serverId === identityServer.id) ?? null}
          secretsPresent={state.identitySecretsPresent}
          onClose={() => setIdentityServer(null)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  )
}

function cellClass(st: string): string {
  switch (st) {
    case 'on':
      return 'bg-good/20 border-good/50 text-good'
    case 'off':
      return 'bg-ink border-edge text-edge hover:border-muted'
    case 'will-on':
      return 'bg-good/40 border-good text-white animate-pulse'
    case 'will-off':
      return 'bg-bad/40 border-bad text-white animate-pulse'
    default:
      return ''
  }
}

function cellGlyph(st: string): string {
  if (st === 'on' || st === 'will-on') return '✓'
  if (st === 'will-off') return '✕'
  return ''
}
