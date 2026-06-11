import React, { useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Button, Badge, Spinner } from '../components/ui'
import type { CatalogSource } from '@shared/types'

const SOURCE_LABELS: Record<CatalogSource, string> = {
  bundled: 'Bundled curated registry',
  remote: 'Remote auto-refresh',
  'official-registry': 'Official MCP registry API',
  web: 'Live web search',
  scanner: 'Local system scan'
}

export function Settings(): React.JSX.Element {
  const { state, reload } = useAppState()
  const [apiKey, setApiKey] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)

  if (!state) return <Spinner />
  const prefs = state.preferences

  async function saveKey(): Promise<void> {
    if (!apiKey.trim()) return
    setSavingKey(true)
    try {
      await api.setApiKey(apiKey.trim())
      setApiKey('')
      setKeySaved(true)
      await reload()
    } finally {
      setSavingKey(false)
    }
  }

  async function toggleSource(src: CatalogSource, on: boolean): Promise<void> {
    await api.savePreferences({ sources: { ...prefs.sources, [src]: on } })
    await reload()
  }

  async function setRefresh(hours: number): Promise<void> {
    await api.savePreferences({ catalogRefreshHours: hours })
    await reload()
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h1 className="text-2xl font-semibold text-gray-100">Settings</h1>
      </header>

      <Card>
        <h2 className="font-medium text-gray-100 mb-1">Anthropic API key</h2>
        <p className="text-sm text-muted mb-3">
          Powers AI recommendations. Stored encrypted in your OS keychain.{' '}
          {prefs.anthropicApiKeyConfigured ? (
            <Badge tone="good">configured</Badge>
          ) : (
            <Badge tone="warn">not set</Badge>
          )}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="sk-ant-…"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setKeySaved(false)
            }}
            className="flex-1 bg-ink border border-edge rounded-md px-3 py-2 text-sm font-mono"
          />
          <Button variant="primary" onClick={saveKey} disabled={savingKey || !apiKey.trim()}>
            {savingKey ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {keySaved && <p className="text-xs text-good mt-2">Saved.</p>}
      </Card>

      <Card>
        <h2 className="font-medium text-gray-100 mb-3">Discovery sources</h2>
        <div className="space-y-2">
          {(Object.keys(SOURCE_LABELS) as CatalogSource[]).map((src) => (
            <label key={src} className="flex items-center justify-between text-sm">
              <span className="text-gray-300">{SOURCE_LABELS[src]}</span>
              <input
                type="checkbox"
                checked={prefs.sources[src] ?? false}
                onChange={(e) => toggleSource(src, e.target.checked)}
              />
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-medium text-gray-100 mb-3">Catalog auto-refresh</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300">Every</span>
          <select
            value={prefs.catalogRefreshHours}
            onChange={(e) => setRefresh(Number(e.target.value))}
            className="bg-ink border border-edge rounded-md px-3 py-1.5 text-sm"
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>weekly</option>
          </select>
        </div>
      </Card>
    </div>
  )
}
