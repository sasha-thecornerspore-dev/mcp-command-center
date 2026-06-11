// Browser fallback used only when window.mcc is absent (i.e. the renderer is opened
// outside Electron — for screenshots, demos, or contributor preview). In the packaged
// app window.mcc is always present, so this code path never runs there.
import type { McpApi } from '@shared/api'
import type {
  AppState,
  ConnectionPlan,
  DetectedClient,
  ServerSpec,
  Suggestion
} from '@shared/types'
import registry from '../../../resources/registry/servers.json'

const catalog = (registry as { servers: ServerSpec[] }).servers

function client(
  id: string,
  name: string,
  installed: boolean,
  serverIds: string[]
): DetectedClient {
  return {
    id,
    name,
    format: 'generic-mcpServers',
    configPath: `~/…/${id}/config.json`,
    installed,
    configExists: installed,
    servers: serverIds.map((sid) => ({ id: sid, transport: 'stdio', command: 'npx' })),
    processHints: []
  }
}

const clients: DetectedClient[] = [
  client('claude-desktop', 'Claude Desktop', true, ['filesystem', 'github', 'memory']),
  client('claude-code', 'Claude Code', true, ['git', 'context7']),
  client('cursor', 'Cursor', true, ['fetch']),
  client('vscode', 'VS Code', true, []),
  client('cline', 'Cline (VS Code)', true, ['sequential-thinking']),
  client('windsurf', 'Windsurf', false, []),
  client('continue', 'Continue', false, []),
  client('zed', 'Zed', false, [])
]

const suggestions: Suggestion[] = [
  {
    id: 'scan:git',
    kind: 'default',
    title: 'Connect Git',
    reason: 'git found on PATH',
    server: catalog.find((s) => s.id === 'git')!,
    suggestedClients: ['claude-desktop', 'cursor'],
    createdAt: '2026-06-11T00:00:00Z'
  },
  {
    id: 'trend:tavily',
    kind: 'trend',
    title: 'New: Tavily',
    reason: 'Search and extract web content via the Tavily API.',
    server: catalog.find((s) => s.id === 'tavily')!,
    suggestedClients: [],
    createdAt: '2026-06-11T00:00:00Z'
  }
]

const state: AppState = {
  clients,
  catalog,
  suggestions,
  preferences: {
    anthropicApiKeyConfigured: true,
    catalogRefreshHours: 24,
    sources: { bundled: true, remote: true, 'official-registry': true, web: true, scanner: true },
    dismissedSuggestionIds: [],
    favoriteServerIds: []
  },
  profiles: [
    {
      id: 'profile-dev',
      name: 'Dev stack',
      description: 'Everything for coding',
      serverIds: ['git', 'github', 'context7', 'filesystem']
    }
  ]
}

const plan = (
  changes: { clientId: string; serverId: string; action: 'connect' | 'disconnect' }[]
): ConnectionPlan => ({
  id: 'mock',
  title: 'Matrix changes',
  items: changes.map((c) => ({
    clientId: c.clientId,
    server: catalog.find((s) => s.id === c.serverId)!,
    action: c.action
  })),
  missingSecrets: []
})

export function createMockApi(): McpApi {
  const ok = async <T>(v: T): Promise<T> => v
  return {
    getState: () => ok(state),
    detectClients: () => ok(clients),
    refreshCatalog: () => ok(catalog),
    buildMatrixPlan: (changes) => ok(plan(changes)),
    previewPlan: (p) =>
      ok(
        p.items.map((it) => ({
          clientId: it.clientId,
          configPath: `~/…/${it.clientId}/config.json`,
          before: '{\n  "mcpServers": {}\n}\n',
          after: `{\n  "mcpServers": {\n    "${it.server.id}": { "command": "npx" }\n  }\n}\n`
        }))
      ),
    applyPlan: (p) =>
      ok(
        p.items.map((it) => ({
          clientId: it.clientId,
          serverId: it.server.id,
          action: it.action,
          ok: true
        }))
      ),
    restore: (clientId) => ok({ clientId, serverId: '*', action: 'disconnect', ok: true }),
    scanSystem: () => ok([]),
    advise: () => ok(plan([{ clientId: 'claude-desktop', serverId: 'github', action: 'connect' }])),
    setSecret: () => ok(true),
    hasSecret: () => ok(true),
    setApiKey: () => ok(true),
    savePreferences: () => ok(state.preferences),
    saveProfile: () => ok(state.profiles),
    applyProfile: () => ok([]),
    dismissSuggestion: () => ok(suggestions),
    checkTrends: () => ok(suggestions)
  }
}
