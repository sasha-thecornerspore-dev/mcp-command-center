import React, { useMemo, useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Badge, Button, Modal, Spinner } from '../components/ui'
import { PlanReviewModal } from '../components/PlanReviewModal'
import type { ConnectionPlan, ServerSpec } from '@shared/types'

export function CatalogView(): React.JSX.Element {
  const { state, reload } = useAppState()
  const [filter, setFilter] = useState('')
  const [picking, setPicking] = useState<ServerSpec | null>(null)
  const [plan, setPlan] = useState<ConnectionPlan | null>(null)

  const servers = useMemo(() => {
    if (!state) return []
    const q = filter.toLowerCase()
    return state.catalog.filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.includes(q))
    )
  }, [state, filter])

  if (!state) return <Spinner />

  const installed = state.clients.filter((c) => c.installed)

  async function addTo(server: ServerSpec, clientIds: string[]): Promise<void> {
    const changes = clientIds.map((clientId) => ({
      clientId,
      serverId: server.id,
      action: 'connect' as const
    }))
    const p = await api.buildMatrixPlan(changes)
    p.title = `Add ${server.name}`
    setPicking(null)
    setPlan(p)
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Catalog</h1>
          <p className="text-muted text-sm">
            {state.catalog.length} servers from bundled registry, official registry, and discovery.
          </p>
        </div>
        <input
          placeholder="Search…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-ink border border-edge rounded-md px-3 py-1.5 text-sm w-64"
        />
      </header>

      <div className="grid grid-cols-2 gap-3">
        {servers.map((s) => (
          <Card key={s.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-gray-100">{s.name}</div>
                <div className="text-xs text-muted font-mono">{s.id}</div>
              </div>
              <Badge tone="muted">{s.source}</Badge>
            </div>
            <p className="text-sm text-gray-300 mt-2 flex-1">{s.description}</p>
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {s.tags.map((t) => (
                <Badge key={t} tone="muted">
                  {t}
                </Badge>
              ))}
              {s.requiredSecrets?.length ? <Badge tone="warn">needs secret</Badge> : null}
            </div>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" onClick={() => setPicking(s)} disabled={!installed.length}>
                Add to…
              </Button>
              {s.homepage && (
                <Button variant="ghost" onClick={() => window.open(s.homepage, '_blank')}>
                  Docs
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {picking && (
        <ClientPicker
          server={picking}
          clients={installed.map((c) => ({ id: c.id, name: c.name }))}
          onCancel={() => setPicking(null)}
          onConfirm={(ids) => addTo(picking, ids)}
        />
      )}

      {plan && <PlanReviewModal plan={plan} onClose={() => setPlan(null)} onApplied={reload} />}
    </div>
  )
}

function ClientPicker({
  server,
  clients,
  onCancel,
  onConfirm
}: {
  server: ServerSpec
  clients: { id: string; name: string }[]
  onCancel: () => void
  onConfirm: (ids: string[]) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(clients.map((c) => c.id))
  return (
    <Modal title={`Add ${server.name} to clients`} onClose={onCancel}>
      <div className="space-y-2">
        {clients.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                )
              }
            />
            {c.name}
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(selected)} disabled={!selected.length}>
          Review
        </Button>
      </div>
    </Modal>
  )
}
