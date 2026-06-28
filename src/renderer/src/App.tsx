import React, { useState } from 'react'
import { AppStateProvider, useAppState } from './state'
import { Spinner } from './components/ui'
import { Dashboard } from './views/Dashboard'
import { Matrix } from './views/Matrix'
import { CatalogView } from './views/Catalog'
import { Assistant } from './views/Assistant'
import { Profiles } from './views/Profiles'
import { Settings } from './views/Settings'
import { Setup } from './views/Setup'

type Tab = 'dashboard' | 'matrix' | 'catalog' | 'assistant' | 'profiles' | 'setup' | 'settings'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '◉' },
  { id: 'matrix', label: 'Connection Matrix', icon: '▦' },
  { id: 'catalog', label: 'Catalog', icon: '⬡' },
  { id: 'assistant', label: 'AI Assistant', icon: '✦' },
  { id: 'profiles', label: 'Profiles', icon: '❏' },
  { id: 'setup', label: 'Setup', icon: '⚑' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]

function Shell(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard')
  const { loading, error } = useAppState()

  return (
    <div className="flex h-full">
      <aside className="w-60 shrink-0 bg-panel border-r border-edge flex flex-col">
        <div className="px-5 py-4 border-b border-edge">
          <div className="flex items-center gap-2">
            <span className="text-claw text-xl">🦀</span>
            <div>
              <div className="font-semibold text-gray-100 leading-tight">MCP Command</div>
              <div className="text-xs text-muted leading-tight">Center</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === t.id
                  ? 'bg-claw/15 text-claw'
                  : 'text-gray-300 hover:bg-panel2 hover:text-gray-100'
              }`}
            >
              <span className="w-4 text-center">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="p-4 text-xs text-muted border-t border-edge">v0.2.0 · local control plane</div>
      </aside>

      <main className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8">
            <Spinner label="Detecting clients & loading catalog…" />
          </div>
        ) : error ? (
          <div className="p-8 text-bad">Failed to load: {error}</div>
        ) : (
          <div className="p-8 max-w-6xl">
            {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
            {tab === 'matrix' && <Matrix />}
            {tab === 'catalog' && <CatalogView />}
            {tab === 'assistant' && <Assistant />}
            {tab === 'profiles' && <Profiles />}
            {tab === 'setup' && <Setup />}
            {tab === 'settings' && <Settings />}
          </div>
        )}
      </main>
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  )
}
