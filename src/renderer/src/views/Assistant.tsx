import React, { useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Button, Spinner, Badge } from '../components/ui'
import { PlanReviewModal } from '../components/PlanReviewModal'
import type { ConnectionPlan } from '@shared/types'

const EXAMPLES = [
  'Automate my email and calendar',
  'Set up a coding workspace with git, github, and docs lookup',
  'I want to research the web and save findings',
  'Connect databases for analytics'
]

export function Assistant(): React.JSX.Element {
  const { state, reload } = useAppState()
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<ConnectionPlan | null>(null)

  if (!state) return <Spinner />

  const hasKey = state.preferences.anthropicApiKeyConfigured

  async function advise(): Promise<void> {
    if (!request.trim()) return
    setBusy(true)
    setError(null)
    try {
      const p = await api.advise(request.trim())
      if (!p.items.length) {
        setError('The advisor did not find matching servers/clients. Try rephrasing.')
      } else {
        setPlan(p)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold text-gray-100">AI Assistant</h1>
        <p className="text-muted text-sm">
          Describe what you want to do. Claude recommends a connection bundle; you review the diff
          before anything is written.
        </p>
      </header>

      {!hasKey && (
        <Card className="text-sm text-warn border-warn/40 bg-warn/5">
          No Anthropic API key set. Add one in <b>Settings</b> to enable AI recommendations.
        </Card>
      )}

      <Card>
        <textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="e.g. Set up everything I need to manage my GitHub projects and search docs"
          rows={3}
          className="w-full bg-ink border border-edge rounded-md px-3 py-2 text-sm resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setRequest(ex)}
                className="text-xs text-muted hover:text-claw"
              >
                <Badge tone="muted">{ex}</Badge>
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={advise} disabled={busy || !hasKey || !request.trim()}>
            {busy ? 'Thinking…' : 'Recommend'}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="text-sm text-bad bg-bad/10 border border-bad/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {plan && <PlanReviewModal plan={plan} onClose={() => setPlan(null)} onApplied={reload} />}
    </div>
  )
}
