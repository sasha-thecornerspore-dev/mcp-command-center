import React, { useEffect, useState } from 'react'
import type {
  ConnectionPlan,
  PlanDiff,
  ApplyResult,
  SecretCandidate,
  SecretRequirement
} from '@shared/types'
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
  const [candidates, setCandidates] = useState<Record<string, SecretCandidate[]>>({})
  const [deferredKeys, setDeferredKeys] = useState<Set<string>>(new Set())
  const [remind, setRemind] = useState(true)
  const [discovering, setDiscovering] = useState(false)
  const [diffs, setDiffs] = useState<PlanDiff[]>([])
  const [results, setResults] = useState<ApplyResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (phase === 'preview') void loadPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Auto-detect on mount when there are missing secrets
  useEffect(() => {
    if (initialPlan.missingSecrets.length) void runDiscover(initialPlan.missingSecrets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runDiscover(reqs: SecretRequirement[]): Promise<void> {
    setDiscovering(true)
    try {
      const found = await api.discoverSecrets(reqs.map((r) => r.key))
      setCandidates(found)
    } catch {
      /* discovery is best-effort */
    } finally {
      setDiscovering(false)
    }
  }

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

  async function useCandidate(key: string, candidateId: string): Promise<void> {
    await api.useSecretCandidate(key, candidateId)
    setSecretValues((prev) => ({ ...prev, [key]: '__from_candidate__' }))
    setDeferredKeys((prev) => { const n = new Set(prev); n.delete(key); return n })
  }

  function toggleDefer(key: string, defer: boolean): void {
    setDeferredKeys((prev) => {
      const n = new Set(prev)
      if (defer) n.add(key)
      else n.delete(key)
      return n
    })
  }

  async function saveSecretsAndContinue(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      for (const req of plan.missingSecrets) {
        if (deferredKeys.has(req.key)) continue
        const v = secretValues[req.key]
        if (v && v !== '__from_candidate__') await api.setSecret(req.key, v)
      }

      const explicitDefer = plan.missingSecrets.filter((r) => deferredKeys.has(r.key))

      if (explicitDefer.length > 0) {
        const deferred = await api.deferKeys(plan, explicitDefer.map((r) => r.key), remind)
        setResults(deferred)
        setPhase('done')
        onApplied()
        return
      }

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
          candidates={candidates}
          deferredKeys={deferredKeys}
          remind={remind}
          discovering={discovering}
          busy={busy}
          onChange={setSecretValues}
          onToggleDefer={toggleDefer}
          onSetRemind={setRemind}
          onUseCandidate={useCandidate}
          onReDiscover={() => runDiscover(plan.missingSecrets)}
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
  candidates,
  deferredKeys,
  remind,
  discovering,
  busy,
  onChange,
  onToggleDefer,
  onSetRemind,
  onUseCandidate,
  onReDiscover,
  onContinue
}: {
  requirements: SecretRequirement[]
  values: Record<string, string>
  candidates: Record<string, SecretCandidate[]>
  deferredKeys: Set<string>
  remind: boolean
  discovering: boolean
  busy: boolean
  onChange: (v: Record<string, string>) => void
  onToggleDefer: (key: string, defer: boolean) => void
  onSetRemind: (v: boolean) => void
  onUseCandidate: (key: string, candidateId: string) => void
  onReDiscover: () => void
  onContinue: () => void
}): React.JSX.Element {
  const anyDeferred = deferredKeys.size > 0

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted">
          These connections need credentials. Stored encrypted in your OS keychain — never in
          plaintext configs.
        </p>
        <Button variant="ghost" onClick={onReDiscover} disabled={discovering}>
          {discovering ? 'Detecting…' : '⟳ Re-detect'}
        </Button>
      </div>

      {requirements.map((req) => {
        const deferred = deferredKeys.has(req.key)
        const usedCandidate = values[req.key] === '__from_candidate__'
        const filled = usedCandidate || !!values[req.key]
        const keyCandidates = candidates[req.key] ?? []

        return (
          <div key={req.key} className="border border-edge rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-200">
                {req.label}
                {req.required && !deferred && <span className="text-bad ml-1">*</span>}
              </span>
              <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deferred}
                  onChange={(e) => onToggleDefer(req.key, e.target.checked)}
                  className="accent-warn"
                />
                Skip for now
              </label>
            </div>

            {deferred ? (
              <div className="text-xs text-warn bg-warn/10 border border-warn/30 rounded-md px-3 py-2">
                A placeholder <code className="font-mono">&lt;SET:{req.key}&gt;</code> will be
                written into the config. The server will not function until the real value is set.
              </div>
            ) : (
              <>
                {keyCandidates.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted">
                      {discovering ? 'Detecting…' : 'Found on this system:'}
                    </p>
                    {keyCandidates.map((c) => (
                      <div
                        key={c.candidateId}
                        className="flex items-center justify-between bg-panel2 rounded-md px-3 py-1.5"
                      >
                        <span className="text-xs text-gray-300">
                          <span className="text-muted">{c.source}</span>
                          {' · '}
                          <code className="font-mono">{c.preview}</code>
                        </span>
                        {usedCandidate ? (
                          <Badge tone="good">Using this</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => onUseCandidate(req.key, c.candidateId)}
                          >
                            Use
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!usedCandidate && (
                  <input
                    type="password"
                    className="w-full bg-ink border border-edge rounded-md px-3 py-2 text-sm font-mono"
                    value={values[req.key] ?? ''}
                    onChange={(e) => onChange({ ...values, [req.key]: e.target.value })}
                    placeholder={keyCandidates.length > 0 ? 'Or enter manually…' : req.key}
                  />
                )}

                {usedCandidate && (
                  <Button variant="ghost" onClick={() => onChange({ ...values, [req.key]: '' })}>
                    Enter manually instead
                  </Button>
                )}

                {req.help && <p className="text-xs text-muted">{req.help}</p>}
                {filled && !deferred && <Badge tone="good">Ready</Badge>}
              </>
            )}
          </div>
        )
      })}

      {anyDeferred && (
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remind}
            onChange={(e) => onSetRemind(e.target.checked)}
            className="accent-claw"
          />
          Remind me on next launch to fill in the missing key{deferredKeys.size > 1 ? 's' : ''}
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="primary" onClick={onContinue} disabled={busy}>
          {anyDeferred ? 'Install with placeholder' : 'Continue'}
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
