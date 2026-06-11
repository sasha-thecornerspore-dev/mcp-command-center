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
  ServerSpec
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
  dismissSuggestion: (id: string): Promise<Suggestion[]> =>
    ipcRenderer.invoke(IPC.dismissSuggestion, id),
  checkTrends: (): Promise<Suggestion[]> => ipcRenderer.invoke(IPC.checkTrends),
  getReadiness: () => ipcRenderer.invoke(IPC.getReadiness),
  installRuntime: (runtimeId: string, command: string) =>
    ipcRenderer.invoke(IPC.installRuntime, runtimeId, command)
}

export type MccApi = typeof api

contextBridge.exposeInMainWorld('mcc', api)
