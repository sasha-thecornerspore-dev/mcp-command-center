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
  HealthCheckResult
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
}
