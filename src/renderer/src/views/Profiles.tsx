import React, { useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Button, Badge, Modal, Spinner } from '../components/ui'
import type { Profile, ApplyResult } from '@shared/types'

export function Profiles(): React.JSX.Element {
  const { state, reload } = useAppState()
  const [editing, setEditing] = useState<Profile | null>(null)
  const [applying, setApplying] = useState<Profile | null>(null)
  const [results, setResults] = useState<ApplyResult[] | null>(null)

  if (!state) return <Spinner />

  function newProfile(): void {
    setEditing({ id: `profile-${Date.now()}`, name: '', description: '', serverIds: [] })
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Profiles</h1>
          <p className="text-muted text-sm">
            Reusable bundles of servers you can apply across clients in one shot.
          </p>
        </div>
        <Button variant="primary" onClick={newProfile}>
          New profile
        </Button>
      </header>

      {state.profiles.length === 0 ? (
        <Card className="text-sm text-muted">
          No profiles yet. Create one (e.g. “Dev stack” = git + github + context7) and apply it to
          any set of clients.
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {state.profiles.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-gray-100">{p.name}</div>
                  {p.description && <div className="text-xs text-muted">{p.description}</div>}
                </div>
                <Badge tone="claw">{p.serverIds.length} servers</Badge>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {p.serverIds.map((id) => (
                  <Badge key={id} tone="muted">
                    {id}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <Button variant="primary" onClick={() => setApplying(p)}>
                  Apply
                </Button>
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <ProfileEditor
          profile={editing}
          allServers={state.catalog.map((s) => ({ id: s.id, name: s.name }))}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            await api.saveProfile(p)
            setEditing(null)
            await reload()
          }}
        />
      )}

      {applying && (
        <ApplyProfile
          profile={applying}
          clients={state.clients.filter((c) => c.installed).map((c) => ({ id: c.id, name: c.name }))}
          onClose={() => {
            setApplying(null)
            setResults(null)
          }}
          onApply={async (ids) => {
            const res = await api.applyProfile(applying.id, ids)
            setResults(res)
            await reload()
          }}
          results={results}
        />
      )}
    </div>
  )
}

function ProfileEditor({
  profile,
  allServers,
  onClose,
  onSave
}: {
  profile: Profile
  allServers: { id: string; name: string }[]
  onClose: () => void
  onSave: (p: Profile) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<Profile>(profile)
  const toggle = (id: string): void =>
    setDraft((d) => ({
      ...d,
      serverIds: d.serverIds.includes(id)
        ? d.serverIds.filter((x) => x !== id)
        : [...d.serverIds, id]
    }))

  return (
    <Modal title="Edit profile" onClose={onClose} wide>
      <div className="space-y-3">
        <input
          placeholder="Profile name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-full bg-ink border border-edge rounded-md px-3 py-2 text-sm"
        />
        <input
          placeholder="Description (optional)"
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="w-full bg-ink border border-edge rounded-md px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-3 gap-2 max-h-72 overflow-auto">
          {allServers.map((s) => (
            <label
              key={s.id}
              className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-md border cursor-pointer ${
                draft.serverIds.includes(s.id)
                  ? 'border-claw/50 bg-claw/10'
                  : 'border-edge hover:bg-panel2'
              }`}
            >
              <input
                type="checkbox"
                checked={draft.serverIds.includes(s.id)}
                onChange={() => toggle(s.id)}
              />
              {s.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => onSave(draft)}
          disabled={!draft.name.trim() || !draft.serverIds.length}
        >
          Save
        </Button>
      </div>
    </Modal>
  )
}

function ApplyProfile({
  profile,
  clients,
  onClose,
  onApply,
  results
}: {
  profile: Profile
  clients: { id: string; name: string }[]
  onClose: () => void
  onApply: (ids: string[]) => void
  results: ApplyResult[] | null
}): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(clients.map((c) => c.id))
  return (
    <Modal title={`Apply “${profile.name}”`} onClose={onClose}>
      {results ? (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Badge tone={r.ok ? 'good' : 'bad'}>{r.ok ? 'OK' : 'FAIL'}</Badge>
              <span className="font-mono text-gray-300">
                {r.clientId} · {r.serverId}
              </span>
              {r.error && <span className="text-bad">{r.error}</span>}
            </div>
          ))}
          <div className="flex justify-end mt-4">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted mb-3">Apply to which clients?</p>
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
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => onApply(selected)} disabled={!selected.length}>
              Apply
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
