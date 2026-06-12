import React, { useState } from 'react'
import { api } from '../api'
import { Badge } from './ui'
import type { ServerIdentityConfig, SwitchResult } from '@shared/types'

/** Inline identity chip + dropdown for a server row. */
export function IdentitySwitcher({
  config,
  onManage,
  onSwitched,
  onError
}: {
  config: ServerIdentityConfig
  onManage: () => void
  onSwitched: (result: SwitchResult, identityLabel: string) => void
  onError?: (message: string) => void
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
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e))
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
