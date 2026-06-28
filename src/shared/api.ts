// Single source of truth for the renderer-facing API surface. Both the real preload
// bridge and the browser mock implement this, and the renderer types against it — so
// neither side has to import across TS project boundaries.
import type {
  AppState,
  ConnectionPlan,
  PlanDiff,
  ApplyResult,
  Suggestion,
  Profile,
  Preferences,
  ScanFinding,
  DetectedClient,
  ServerSpec,
  SystemReadiness,
  InstallResult,
  ServerIdentityConfig,
  SwitchResult,
  HealthCheckResult,
  SecretCandidate,
  PendingKey,
  UpdateStatus
} from './types'

export interface McpApi {
  getState(): Promise<AppState>
  detectClients(): Promise<DetectedClient[]>
  refreshCatalog(): Promise<ServerSpec[]>
  buildMatrixPlan(
    changes: { clientId: string; serverId: string; action: 'connect' | 'disconnect' }[]
  ): Promise<ConnectionPlan>
  previewPlan(plan: ConnectionPlan): Promise<PlanDiff[]>
  applyPlan(plan: ConnectionPlan): Promise<ApplyResult[]>
  restore(clientId: string, backupId: string): Promise<ApplyResult>
  scanSystem(): Promise<ScanFinding[]>
  advise(request: string): Promise<ConnectionPlan>
  setSecret(key: string, value: string): Promise<boolean>
  hasSecret(key: string): Promise<boolean>
  setApiKey(key: string): Promise<boolean>
  savePreferences(prefs: Partial<Preferences>): Promise<Preferences>
  saveProfile(profile: Profile): Promise<Profile[]>
  applyProfile(profileId: string, clientIds: string[]): Promise<ApplyResult[]>
  saveIdentities(
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): Promise<ServerIdentityConfig[]>
  switchIdentity(serverId: string, identityId: string): Promise<SwitchResult>
  testIdentity(serverId: string, identityId: string): Promise<HealthCheckResult>
  deleteIdentities(serverId: string): Promise<ServerIdentityConfig[]>
  dismissSuggestion(id: string): Promise<Suggestion[]>
  checkTrends(): Promise<Suggestion[]>
  getReadiness(): Promise<SystemReadiness>
  installRuntime(runtimeId: string, command: string): Promise<InstallResult>
  /** Scan permitted sources for candidate values for the given secret keys. */
  discoverSecrets(keys: string[]): Promise<Record<string, SecretCandidate[]>>
  /** Promote a discovered candidate to a saved secret (raw value never leaves main). */
  useSecretCandidate(key: string, candidateId: string): Promise<boolean>
  /** Apply a plan with placeholder values for deferred keys and record reminders. */
  deferKeys(plan: ConnectionPlan, keys: string[], remind: boolean): Promise<ApplyResult[]>
  getPendingKeys(): Promise<PendingKey[]>
  /** Set the real value for a pending key and re-apply the server config. */
  resolvePendingKey(id: string, value: string): Promise<PendingKey[]>
  dismissPendingKey(id: string): Promise<PendingKey[]>
  getUpdateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  /** Subscribe to updater phase-change push events. Returns an unsubscribe fn. */
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
}
