import React, { useState } from 'react'
import { useAppState } from '../state'
import { api } from '../api'
import { Card, Button, Badge, Spinner } from '../components/ui'
import type { BaseBuild, InstallRoute, RuntimeStatus } from '@shared/types'

const BUILDS: { id: BaseBuild; name: string; blurb: string; needs: string }[] = [
  { id: 'minimal', name: 'Minimal', blurb: 'Just the npx (Node) servers.', needs: 'Node.js' },
  {
    id: 'standard',
    name: 'Standard',
    blurb: 'Node + Python servers (git, fetch, time, sqlite).',
    needs: 'Node.js + uv'
  },
  { id: 'full', name: 'Full', blurb: 'Everything, including container servers.', needs: 'Node.js + uv + Docker' }
]

export function Setup(): React.JSX.Element {
  const { state, readiness, refreshReadiness, reload } = useAppState()

  if (!state || !readiness) return <Spinner label="Probing system…" />

  const build = state.preferences.baseBuild
  const needDocker = build === 'full'
  const blocking =
    !readiness.ready.node ||
    (build !== 'minimal' && !readiness.ready.python) ||
    (needDocker && !readiness.ready.docker)

  async function chooseBuild(b: BaseBuild): Promise<void> {
    await api.savePreferences({ baseBuild: b })
    await reload()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-100">Setup &amp; System Readiness</h1>
          <p className="text-muted text-sm">
            The app is self-contained, but the MCP servers it wires are launched by your AI clients
            and need a runtime on this machine. Here's what's present and how to fill the gaps.
          </p>
        </div>
        <Button onClick={refreshReadiness}>Re-scan</Button>
      </header>

      <Card className={blocking ? 'border-warn/50 bg-warn/5' : 'border-good/50 bg-good/5'}>
        <div className="flex items-center gap-2">
          <Badge tone={blocking ? 'warn' : 'good'}>{blocking ? 'Action needed' : 'Ready'}</Badge>
          <span className="text-sm text-gray-200">
            {blocking
              ? `Your "${build}" stack is missing a runtime below — install it so wired servers can actually launch.`
              : `Your "${build}" stack has every runtime it needs. Wired servers can launch.`}
          </span>
        </div>
      </Card>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Base build</h2>
        <div className="grid grid-cols-3 gap-3">
          {BUILDS.map((b) => (
            <button
              key={b.id}
              onClick={() => chooseBuild(b.id)}
              className={`text-left p-4 rounded-xl border transition-colors ${
                build === b.id
                  ? 'border-claw bg-claw/10'
                  : 'border-edge bg-panel hover:bg-panel2'
              }`}
            >
              <div className="font-medium text-gray-100">{b.name}</div>
              <div className="text-xs text-muted mt-1">{b.blurb}</div>
              <div className="text-xs text-accent mt-2">Needs: {b.needs}</div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Runtimes</h2>
        <div className="space-y-3">
          {readiness.runtimes.map((rt) => (
            <RuntimeRow
              key={rt.id}
              runtime={rt}
              routes={readiness.routes.filter((r) => r.runtimeId === rt.id)}
              onInstalled={refreshReadiness}
            />
          ))}
        </div>
        {readiness.packageManagers.length > 0 && (
          <p className="text-xs text-muted mt-3">
            Detected package managers: {readiness.packageManagers.join(', ')}
          </p>
        )}
      </section>
    </div>
  )
}

function RuntimeRow({
  runtime,
  routes,
  onInstalled
}: {
  runtime: RuntimeStatus
  routes: InstallRoute[]
  onInstalled: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const recommended = routes[0]

  async function install(route: InstallRoute): Promise<void> {
    setBusy(true)
    setLog(null)
    try {
      const res = await api.installRuntime(route.runtimeId, route.command)
      setLog(res.output.slice(-600))
      if (res.ok) onInstalled()
    } finally {
      setBusy(false)
    }
  }

  function copy(cmd: string): void {
    void navigator.clipboard.writeText(cmd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-100">{runtime.name}</span>
            {runtime.present ? (
              <Badge tone="good">{runtime.version ?? 'present'}</Badge>
            ) : (
              <Badge tone="bad">missing</Badge>
            )}
          </div>
          <div className="text-xs text-muted mt-1">{runtime.purpose}</div>
        </div>
      </div>

      {!runtime.present && recommended && (
        <div className="mt-3 space-y-2">
          {recommended.command ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-ink border border-edge rounded-md px-3 py-2 text-xs font-mono text-gray-300 overflow-auto">
                  {recommended.command}
                </code>
                <Button onClick={() => copy(recommended.command)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                {recommended.canAutoRun && (
                  <Button variant="primary" onClick={() => install(recommended)} disabled={busy}>
                    {busy ? 'Installing…' : `Install via ${recommended.manager}`}
                  </Button>
                )}
              </div>
              {!recommended.canAutoRun && (
                <p className="text-xs text-muted">
                  Run this in a terminal (needs elevated permissions), or{' '}
                  <a className="text-accent" href={recommended.manualUrl} target="_blank" rel="noreferrer">
                    download manually
                  </a>
                  .
                </p>
              )}
            </>
          ) : (
            <a className="text-accent text-sm" href={recommended.manualUrl} target="_blank" rel="noreferrer">
              Download {runtime.name} →
            </a>
          )}
          {log && (
            <pre className="bg-ink border border-edge rounded-md p-2 text-xs font-mono text-muted max-h-40 overflow-auto whitespace-pre-wrap">
              {log}
            </pre>
          )}
        </div>
      )}
    </Card>
  )
}
