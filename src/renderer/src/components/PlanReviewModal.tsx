import React, { useEffect, useState } from 'react'
import type { ConnectionPlan, PlanDiff, ApplyResult, SecretRequirement } from '@shared/types'
import { api } from '../api'
import { Button, Modal, Badge, Spinner } from './ui'

type Phase = 'secrets' | 'preview' | 'applying' | 'done'

export function PlanReviewModal({
  plan: initialPlan,
  onClose,
  onApplied
}: {
  plan: ConnectionPlan
  onClose: () => void
  onApplied: () => void
}): React.JSX.Element {
  const [plan, setPlan] = useState<ConnectionPlan>(initialPlan)
  const [phase, setPhase] = useState<Phase>(
    initialPlan.missingSecrets.length ? 'secrets' : 'preview'
  )
  const [secretValues, setSecretValues] = useState<Record<string, string>>({})
  const [diffs, setDiffs] = useState<PlanDiff[]>([])
  const [results, setResults] = useState<ApplyResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (phase === 'preview') void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  async function loadPreview(): Promise<void> {
    setBusy(true)
    try {
      setDiffs(await api.previewPlan(plan))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveSecretsAndContinue(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      for (const req of plan.missingSecrets) {
        const v = secretValues[req.key]
        if (req.required && !v) throw new Error(`${req.label} is required.`)
        if (v) await api.setSecret(req.key, v)
      }
      // Rebuild the plan so missingSecrets re-evaluates with the new secrets.
      const changes = plan.items.map((i) => ({
        clientId: i.clientId,
        serverId: i.server.id,
        action: i.action
      }))
      const rebuilt = await api.buildMatrixPlan(changes)
      rebuilt.title = plan.title
      setPlan(rebuilt)
      setPhase('preview')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    setPhase('applying')
    setBusy(true)
    try {
      const res = await api.applyPlan(plan)
      setResults(res)
      setPhase('done')
      onApplied()
    } catch (e) {
      setError((e as Error).message)
      setPhase('preview')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={plan.title} onClose={onClose} wide>
      {plan.rationale && <p className="text-sm text-muted mb-4">{plan.rationale}</p>}
      {error && (
        <div className="mb-4 text-sm text-bad bg-bad/10 border border-bad/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {phase === 'secrets' && (
        <SecretsForm
          requirements={plan.missingSecrets}
          values={secretValues}
          onChange={setSecretValues}
          busy={busy}
          onContinue={saveSecretsAndContinue}
        />
      )}

      {phase === 'preview' && (
        <>
          <PlanSummary plan={plan} />
          <div className="mt-4 space-y-4">
            {busy && <Spinner label="Computing changes…" />}
            {diffs.map((d) => (
              <DiffView key={d.clientId} diff={d} />
            ))}
            {!busy && diffs.length === 0 && (
              <p className="text-muted text-sm">No file changes computed.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={apply} disabled={busy || diffs.length === 0}>
              Apply {plan.items.length} change{plan.items.length === 1 ? '' : 's'}
            </Button>
          </div>
        </>
      )}

      {phase === 'applying' && <Spinner label="Writing configs (with backups)…" />}

      {phase === 'done' && (
        <>
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Badge tone={r.ok ? 'good' : 'bad'}>{r.ok ? 'OK' : 'FAIL'}</Badge>
                <span className="font-mono text-gray-300">
                  {r.clientId} · {r.action} · {r.serverId}
                </span>
                {r.error && <span className="text-bad">{r.error}</span>}
                {r.restartHint && <span className="text-warn text-xs">{r.restartHint}</span>}
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-6">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

function PlanSummary({ plan }: { plan: ConnectionPlan }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {plan.items.map((it, i) => (
        <Badge key={i} tone={it.action === 'connect' ? 'good' : 'bad'}>
          {it.action === 'connect' ? '+' : '−'} {it.server.name} → {it.clientId}
        </Badge>
      ))}
    </div>
  )
}

function SecretsForm({
  requirements,
  values,
  onChange,
  busy,
  onContinue
}: {
  requirements: SecretRequirement[]
  values: Record<string, string>
  onChange: (v: Record<string, string>) => void
  busy: boolean
  onContinue: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        These connections need credentials. They're stored encrypted in your OS keychain — never in
        plaintext configs.
      </p>
      {requirements.map((req) => (
        <label key={req.key} className="block">
          <span className="text-sm text-gray-300">
            {req.label} {req.required && <span className="text-bad">*</span>}
          </span>
          <input
            type="password"
            className="mt-1 w-full bg-ink border border-edge rounded-md px-3 py-2 text-sm font-mono"
            value={values[req.key] ?? ''}
            onChange={(e) => onChange({ ...values, [req.key]: e.target.value })}
            placeholder={req.key}
          />
          {req.help && <span className="text-xs text-muted">{req.help}</span>}
        </label>
      ))}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onContinue} disabled={busy}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function DiffView({ diff }: { diff: PlanDiff }): React.JSX.Element {
  return (
    <div className="border border-edge rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-panel2 text-xs font-mono text-muted truncate">
        {diff.configPath}
      </div>
      <div className="grid grid-cols-2 text-xs font-mono">
        <pre className="p-3 overflow-auto max-h-64 bg-bad/5 text-gray-400 whitespace-pre-wrap">
          {diff.before || '(empty / new file)'}
        </pre>
        <pre className="p-3 overflow-auto max-h-64 bg-good/5 text-gray-200 whitespace-pre-wrap border-l border-edge">
          {diff.after}
        </pre>
      </div>
    </div>
  )
}
