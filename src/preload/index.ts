import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
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
  ServerIdentityConfig,
  SwitchResult,
  HealthCheckResult,
  SecretCandidate,
  PendingKey
} from '../shared/types'
import type { McpApi } from '../shared/api'

/** Typed bridge exposed to the renderer as window.mcc. */
const api: McpApi = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.getState),
  detectClients: (): Promise<DetectedClient[]> => ipcRenderer.invoke(IPC.detectClients),
  refreshCatalog: (): Promise<ServerSpec[]> => ipcRenderer.invoke(IPC.refreshCatalog),
  buildMatrixPlan: (
    changes: { clientId: string; serverId: string; action: 'connect' | 'disconnect' }[]
  ): Promise<ConnectionPlan> => ipcRenderer.invoke(IPC.buildMatrixPlan, changes),
  previewPlan: (plan: ConnectionPlan): Promise<PlanDiff[]> =>
    ipcRenderer.invoke(IPC.previewPlan, plan),
  applyPlan: (plan: ConnectionPlan): Promise<ApplyResult[]> =>
    ipcRenderer.invoke(IPC.applyPlan, plan),
  restore: (clientId: string, backupId: string): Promise<ApplyResult> =>
    ipcRenderer.invoke(IPC.restore, clientId, backupId),
  scanSystem: (): Promise<ScanFinding[]> => ipcRenderer.invoke(IPC.scanSystem),
  advise: (request: string): Promise<ConnectionPlan> => ipcRenderer.invoke(IPC.advise, request),
  setSecret: (key: string, value: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setSecret, key, value),
  hasSecret: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.hasSecret, key),
  setApiKey: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.setApiKey, key),
  savePreferences: (prefs: Partial<Preferences>): Promise<Preferences> =>
    ipcRenderer.invoke(IPC.savePreferences, prefs),
  saveProfile: (profile: Profile): Promise<Profile[]> =>
    ipcRenderer.invoke(IPC.saveProfile, profile),
  applyProfile: (profileId: string, clientIds: string[]): Promise<ApplyResult[]> =>
    ipcRenderer.invoke(IPC.applyProfile, profileId, clientIds),
  saveIdentities: (
    cfg: ServerIdentityConfig,
    secretValues?: Record<string, Record<string, string>>
  ): Promise<ServerIdentityConfig[]> => ipcRenderer.invoke(IPC.saveIdentities, cfg, secretValues),
  switchIdentity: (serverId: string, identityId: string): Promise<SwitchResult> =>
    ipcRenderer.invoke(IPC.switchIdentity, serverId, identityId),
  testIdentity: (serverId: string, identityId: string): Promise<HealthCheckResult> =>
    ipcRenderer.invoke(IPC.testIdentity, serverId, identityId),
  deleteIdentities: (serverId: string): Promise<ServerIdentityConfig[]> =>
    ipcRenderer.invoke(IPC.deleteIdentities, serverId),
  dismissSuggestion: (id: string): Promise<Suggestion[]> =>
    ipcRenderer.invoke(IPC.dismissSuggestion, id),
  checkTrends: (): Promise<Suggestion[]> => ipcRenderer.invoke(IPC.checkTrends),
  getReadiness: () => ipcRenderer.invoke(IPC.getReadiness),
  installRuntime: (runtimeId: string, command: string) =>
    ipcRenderer.invoke(IPC.installRuntime, runtimeId, command),
  discoverSecrets: (keys: string[]): Promise<Record<string, SecretCandidate[]>> =>
    ipcRenderer.invoke(IPC.discoverSecrets, keys),
  useSecretCandidate: (key: string, candidateId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.useSecretCandidate, key, candidateId),
  deferKeys: (plan: ConnectionPlan, keys: string[], remind: boolean): Promise<ApplyResult[]> =>
    ipcRenderer.invoke(IPC.deferKeys, plan, keys, remind),
  getPendingKeys: (): Promise<PendingKey[]> => ipcRenderer.invoke(IPC.getPendingKeys),
  resolvePendingKey: (id: string, value: string): Promise<PendingKey[]> =>
    ipcRenderer.invoke(IPC.resolvePendingKey, id, value),
  dismissPendingKey: (id: string): Promise<PendingKey[]> =>
    ipcRenderer.invoke(IPC.dismissPendingKey, id)
}

export type MccApi = typeof api

contextBridge.exposeInMainWorld('mcc', api)
