// Shared types — the contract between the main process services and the renderer UI.
// Keep this file free of Node/Electron imports so it can be used from both sides.

/** Config file dialect a client uses to declare MCP servers. */
export type ClientFormat =
  | 'claude-desktop' // { mcpServers: { name: { command, args, env } } }
  | 'claude-code' // ~/.claude.json -> { mcpServers: {...} }
  | 'cursor' // ~/.cursor/mcp.json -> { mcpServers: {...} }
  | 'vscode' // .vscode/mcp.json or settings -> { servers: {...} } / { mcp: { servers } }
  | 'windsurf' // ~/.codeium/windsurf/mcp_config.json -> { mcpServers: {...} }
  | 'continue' // ~/.continue/config.json -> { mcpServers: [...] } (array dialect)
  | 'zed' // settings.json -> { context_servers: {...} }
  | 'generic-mcpServers'

/** Transport an MCP server speaks. */
export type Transport = 'stdio' | 'sse' | 'http'

/** Host runtime a stdio server needs in order to launch. */
export type Runtime = 'node' | 'python' | 'docker' | 'none'

/** A single server entry as it lives inside a client config. */
export interface ServerEntry {
  /** Key/name used in the client config. */
  id: string
  transport: Transport
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** For sse/http transports. */
  url?: string
  /** True if this entry was disabled rather than removed. */
  disabled?: boolean
}

/** An MCP-capable client detected on the system. */
export interface DetectedClient {
  id: string
  name: string
  format: ClientFormat
  /** Absolute path to the config file we read/write. */
  configPath: string
  /** Whether the app/config appears to be present on this machine. */
  installed: boolean
  /** Whether the config file currently exists. */
  configExists: boolean
  /** Servers currently wired into this client. */
  servers: ServerEntry[]
  /** Process name(s) we watch to know if a restart is needed. */
  processHints?: string[]
  /** Non-fatal problems (unreadable file, parse error, etc.). */
  warnings?: string[]
}

/** Where a catalog entry came from. */
export type CatalogSource = 'bundled' | 'remote' | 'official-registry' | 'web' | 'scanner'

/** A normalized, installable MCP server definition. */
export interface ServerSpec {
  id: string
  name: string
  description: string
  transport: Transport
  /** stdio launch spec. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** remote spec. */
  url?: string
  /** Host runtime this server's launch command needs (npx->node, uvx->python, etc.). */
  runtime?: Runtime
  /** Secret keys this server needs (mapped into env or url at apply time). */
  requiredSecrets?: SecretRequirement[]
  tags: string[]
  source: CatalogSource
  homepage?: string
  /** Popularity / freshness signal, 0..100, used for ranking. */
  trendScore?: number
  /** ISO date this entry was first seen by the catalog. */
  firstSeen?: string
}

export interface SecretRequirement {
  /** Logical key, e.g. "GITHUB_TOKEN". */
  key: string
  label: string
  /** Where the secret is injected. */
  target: 'env' | 'url'
  required: boolean
  help?: string
}

/** A proposed change to one client's config. */
export interface PlanItem {
  clientId: string
  server: ServerSpec
  action: 'connect' | 'disconnect'
}

/** A reviewable bundle of changes (from the matrix, a preset, or the AI advisor). */
export interface ConnectionPlan {
  id: string
  title: string
  rationale?: string
  items: PlanItem[]
  /** Secrets the user must supply before this plan can be applied. */
  missingSecrets: SecretRequirement[]
}

/** A unified-diff-ish preview of what applying a plan will do to a file. */
export interface PlanDiff {
  clientId: string
  configPath: string
  before: string
  after: string
}

export interface ApplyResult {
  clientId: string
  serverId: string
  action: 'connect' | 'disconnect'
  ok: boolean
  backupId?: string
  error?: string
  restartHint?: string
}

/** A reusable, named set of server ids appliable across clients. */
export interface Profile {
  id: string
  name: string
  description?: string
  serverIds: string[]
}

/** A named credential set for a server (e.g. "sasha", "root"). */
export interface ServerIdentity {
  id: string // slug, unique within the server
  label: string
  healthCheck?: IdentityHealthCheck
}

/** Optional pre-switch verification request. */
export interface IdentityHealthCheck {
  url: string
  method?: 'GET' | 'POST' // default GET
  /**
   * For 'basic': usernameSecretKey + passwordSecretKey build the header.
   * For 'bearer': passwordSecretKey holds the token; usernameSecretKey is ignored.
   * For 'none': both keys are ignored.
   */
  auth: 'basic' | 'bearer' | 'none'
  /** Secret keys (of this server) used to build the auth header. */
  usernameSecretKey?: string // basic: username side
  passwordSecretKey?: string // basic: password side; bearer: the token
  skipTlsVerify?: boolean // self-signed certs
}

/** Per-server identity state, persisted in the store (no secret values here). */
export interface ServerIdentityConfig {
  serverId: string
  identities: ServerIdentity[]
  /** Id of the active identity; must match one of identities[].id. */
  activeIdentityId: string
}

/** Result of a health-check HTTP probe. */
export interface HealthCheckResult {
  ok: boolean
  status?: number
  error?: string
}

/** Outcome of an identity switch. */
export interface SwitchResult {
  healthCheck?: HealthCheckResult
  blocked?: 'health-check' | 'missing-secrets' | 'not-found'
  missingKeys?: string[]
  applyResults: ApplyResult[]
}

/** A suggestion surfaced by the scanner / advisor / trend watcher. */
export interface Suggestion {
  id: string
  kind: 'default' | 'trend' | 'advisor'
  title: string
  reason: string
  server: ServerSpec
  /** Suggested target clients (by id). */
  suggestedClients: string[]
  createdAt: string
}

/** Which places the app may look in when auto-detecting a server's API key. */
export interface KeyDiscoverySources {
  /** The app's own process environment variables. */
  appEnv: boolean
  /** Values already present for the same key in other detected clients' configs. */
  otherClients: boolean
  /** Common .env files (home dir, current dir). More sensitive — off by default. */
  envFiles: boolean
}

export interface Preferences {
  anthropicApiKeyConfigured: boolean
  catalogRefreshHours: number
  sources: Record<CatalogSource, boolean>
  backupDir?: string
  dismissedSuggestionIds: string[]
  favoriteServerIds: string[]
  /** Chosen prerequisite footprint; drives which runtimes the app ensures. */
  baseBuild: BaseBuild
  /** Where "Detect from environment" is allowed to look (user-configurable). */
  keyDiscoverySources: KeyDiscoverySources
}

/** A possible value for a required secret, found by the discovery service. */
export interface SecretCandidate {
  /** Opaque id used to apply this candidate without sending the raw value to the UI. */
  candidateId: string
  /** Human label of where it came from, e.g. "app environment" or "Cursor config". */
  source: string
  /** Masked preview, e.g. "ghp_…a1b2". */
  preview: string
}

/** A required key the user chose to skip; surfaced as a reminder until resolved. */
export interface PendingKey {
  id: string
  serverId: string
  serverName: string
  key: string
  label: string
  /** Clients whose config got a placeholder for this key. */
  clientIds: string[]
  /** Whether to surface this on the dashboard at next launch. */
  remind: boolean
  createdAt: string
}

/** Result of a system scan: detected tools that have known MCP servers. */
export interface ScanFinding {
  toolId: string
  toolName: string
  evidence: string // why we think it's installed
  server: ServerSpec
}

/** Which "base build" of prerequisites the user wants to stand up. */
export type BaseBuild = 'minimal' | 'standard' | 'full'

/** A host runtime/tool the launched MCP servers depend on. */
export interface RuntimeStatus {
  id: string // 'node' | 'python' | 'uv' | 'docker' | 'git'
  name: string
  binary: string
  present: boolean
  version?: string
  purpose: string
  /** Which server runtime category this satisfies, if any. */
  satisfies?: Runtime
}

/** A way to install a missing runtime on this machine. */
export interface InstallRoute {
  runtimeId: string
  manager: string // 'winget' | 'brew' | 'apt' | 'manual' ...
  command: string
  manualUrl: string
  /** Safe to run from the app (no sudo / no heavy GUI installer). */
  canAutoRun: boolean
}

export interface SystemReadiness {
  os: 'win32' | 'darwin' | 'linux'
  packageManagers: string[]
  runtimes: RuntimeStatus[]
  /** Best install route per missing runtime (first = recommended). */
  routes: InstallRoute[]
  /** node present? python/uv present? docker present? — convenience rollup. */
  ready: { node: boolean; python: boolean; docker: boolean }
}

export interface InstallResult {
  runtimeId: string
  ok: boolean
  output: string
}

/** The full state the renderer renders from. */
export interface AppState {
  clients: DetectedClient[]
  catalog: ServerSpec[]
  suggestions: Suggestion[]
  preferences: Preferences
  profiles: Profile[]
  identityConfigs: ServerIdentityConfig[]
  /** "<serverId>:<identityId>" -> secret keys that have a stored value (names only). */
  identitySecretsPresent: Record<string, string[]>
  /** Required keys the user deferred; surfaced as launch reminders. */
  pendingKeys: PendingKey[]
}

/** Placeholder written into a client config for a deferred required key. */
export const KEY_PLACEHOLDER = (key: string): string => `<SET:${key}>`

// ---- IPC channel contract (typed names shared by preload + main) ----
export const IPC = {
  getState: 'app:getState',
  detectClients: 'clients:detect',
  refreshCatalog: 'catalog:refresh',
  previewPlan: 'plan:preview',
  applyPlan: 'plan:apply',
  buildMatrixPlan: 'plan:fromMatrix',
  restore: 'engine:restore',
  scanSystem: 'system:scan',
  advise: 'ai:advise',
  setSecret: 'secrets:set',
  hasSecret: 'secrets:has',
  setApiKey: 'secrets:setApiKey',
  savePreferences: 'prefs:save',
  saveProfile: 'profiles:save',
  applyProfile: 'profiles:apply',
  saveIdentities: 'identities:save',
  switchIdentity: 'identities:switch',
  testIdentity: 'identities:test',
  deleteIdentities: 'identities:delete',
  dismissSuggestion: 'suggestions:dismiss',
  checkTrends: 'trends:check',
  getReadiness: 'system:readiness',
  installRuntime: 'system:install',
  discoverSecrets: 'secrets:discover',
  useSecretCandidate: 'secrets:useCandidate',
  deferKeys: 'plan:defer',
  getPendingKeys: 'pending:get',
  resolvePendingKey: 'pending:resolve',
  dismissPendingKey: 'pending:dismiss'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
