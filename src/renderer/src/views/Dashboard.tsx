import React, { useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Badge, Button, Spinner } from '../components/ui'
import { PlanReviewModal } from '../components/PlanReviewModal'
import type { ConnectionPlan, Suggestion } from '@shared/types'

export function Dashboard({ onNavigate }: { onNavigate: (t: any) => void }): React.JSX.Element {
  const { state, reload } = useAppState()
  const [plan, setPlan] = useState<ConnectionPlan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [checking, setChecking] = useState(false)

  if (!state) return <Spinner />

  const installed = state.clients.filter((c) => c.installed)
  const activeConnections = state.clients.reduce((n, c) => n + c.servers.length, 0)

  async function runScan(): Promise<void> {
    setScanning(true)
    try {
      await api.scanSystem()
      await reload()
    } finally {
      setScanning(false)
    }
  }

  async function checkTrends(): Promise<void> {
    setChecking(true)
    try {
      await api.checkTrends()
      await reload()
    } finally {
      setChecking(false)
    }
  }

  async function applySuggestion(s: Suggestion): Promise<void> {
    const targets = s.suggestedClients.length
      ? s.suggestedClients
      : installed.map((c) => c.id)
    const changes = targets.map((clientId) => ({
      clientId,
      serverId: s.server.id,
      action: 'connect' as const
    }))
    // Ensure the suggested server is resolvable by id in the catalog plan builder.
    const p = await api.buildMatrixPlan(changes)
    p.title = s.title
    p.rationale = s.reason
    setPlan(p)
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Command Center</h1>
          <p className="text-muted text-sm">
            One control plane for every AI client and MCP server on this machine.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={runScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan system'}
          </Button>
          <Button onClick={checkTrends} disabled={checking}>
            {checking ? 'Checking…' : 'Check for new MCPs'}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Clients detected" value={installed.length} sub={`${state.clients.length} known`} />
        <Stat label="Active connections" value={activeConnections} sub="across all clients" />
        <Stat label="Catalog servers" value={state.catalog.length} sub="available to wire" />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Clients</h2>
        <div className="grid grid-cols-2 gap-3">
          {state.clients.map((c) => (
            <Card key={c.id} className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-100">{c.name}</span>
                  <Badge tone={c.installed ? 'good' : 'muted'}>
                    {c.installed ? 'installed' : 'not found'}
                  </Badge>
                </div>
                <div className="text-xs text-muted font-mono mt-1 truncate max-w-xs">
                  {c.configPath}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-claw">{c.servers.length}</div>
                <div className="text-xs text-muted">servers</div>
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-3">
          <Button variant="ghost" onClick={() => onNavigate('matrix')}>
            Open Connection Matrix →
          </Button>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">
          Suggested & New
        </h2>
        {state.suggestions.length === 0 ? (
          <Card className="text-sm text-muted">
            Nothing yet. Run <b>Scan system</b> for suggested defaults, or{' '}
            <b>Check for new MCPs</b> to pull the latest from the official registry.
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {state.suggestions.slice(0, 8).map((s) => (
              <Card key={s.id}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-100">{s.title}</span>
                      <Badge tone={s.kind === 'trend' ? 'accent' : 'claw'}>{s.kind}</Badge>
                    </div>
                    <p className="text-xs text-muted mt-1">{s.reason}</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button variant="primary" onClick={() => applySuggestion(s)}>
                    Prepare
                  </Button>
                  <Button variant="ghost" onClick={() => api.dismissSuggestion(s.id).then(reload)}>
                    Dismiss
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {plan && (
        <PlanReviewModal plan={plan} onClose={() => setPlan(null)} onApplied={reload} />
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  sub
}: {
  label: string
  value: number
  sub: string
}): React.JSX.Element {
  return (
    <Card>
      <div className="text-3xl font-semibold text-gray-100">{value}</div>
      <div className="text-sm text-gray-300">{label}</div>
      <div className="text-xs text-muted">{sub}</div>
    </Card>
  )
}
