import { ipcMain } from 'electron'
import { IPC } from '../shared/types'
import type { ConnectionPlan, Profile, Preferences, ServerIdentityConfig } from '../shared/types'
import type { Services } from './services'
import { getReadiness, runInstall } from './services/systemReadiness'

/** Register every IPC handler against the shared Services instance. */
export function registerIpc(services: Services): void {
  ipcMain.handle(IPC.getState, () => services.getState())

  ipcMain.handle(IPC.detectClients, () => services.refreshClients())

  ipcMain.handle(IPC.refreshCatalog, () => services.catalog.all())

  ipcMain.handle(
    IPC.buildMatrixPlan,
    (_e, changes: { clientId: string; serverId: string; action: 'connect' | 'disconnect' }[]) =>
      services.buildMatrixPlan(changes)
  )

  ipcMain.handle(IPC.previewPlan, (_e, plan: ConnectionPlan) => services.engine.preview(plan))

  ipcMain.handle(IPC.applyPlan, (_e, plan: ConnectionPlan) => {
    services.refreshClients() // ensure latest on-disk state before writing
    return services.engine.apply(plan)
  })

  ipcMain.handle(IPC.restore, (_e, clientId: string, backupId: string) =>
    services.engine.restore(clientId, backupId)
  )

  ipcMain.handle(IPC.scanSystem, () => services.runSystemScan())

  ipcMain.handle(IPC.advise, async (_e, request: string) => {
    const rec = await services.advisor.recommend(request, services.clients())
    const changes = rec.clientIds.flatMap((clientId) =>
      rec.serverIds.map((serverId) => ({ clientId, serverId, action: 'connect' as const }))
    )
    const plan = services.buildMatrixPlan(changes)
    plan.title = rec.title
    plan.rationale = rec.rationale
    return plan
  })

  ipcMain.handle(IPC.setSecret, (_e, key: string, value: string) => {
    services.secrets.set(key, value)
    return true
  })

  ipcMain.handle(IPC.hasSecret, (_e, key: string) => services.secrets.has(key))

  ipcMain.handle(IPC.setApiKey, (_e, key: string) => {
    services.secrets.setApiKey(key)
    services.store.savePreferences({ anthropicApiKeyConfigured: true })
    return true
  })

  ipcMain.handle(IPC.savePreferences, (_e, prefs: Partial<Preferences>) =>
    services.store.savePreferences(prefs)
  )

  ipcMain.handle(IPC.saveProfile, (_e, profile: Profile) => services.store.saveProfile(profile))

  ipcMain.handle(IPC.applyProfile, (_e, profileId: string, clientIds: string[]) => {
    services.refreshClients()
    const plan = services.buildProfilePlan(profileId, clientIds)
    return services.engine.apply(plan)
  })

  ipcMain.handle(
    IPC.saveIdentities,
    (_e, cfg: ServerIdentityConfig, secretValues?: Record<string, Record<string, string>>) =>
      services.identities.save(cfg, secretValues)
  )

  ipcMain.handle(IPC.switchIdentity, (_e, serverId: string, identityId: string) => {
    services.refreshClients() // ensure latest on-disk state before writing
    return services.identities.switch(serverId, identityId)
  })

  ipcMain.handle(IPC.testIdentity, (_e, serverId: string, identityId: string) =>
    services.identities.test(serverId, identityId)
  )

  ipcMain.handle(IPC.deleteIdentities, (_e, serverId: string) =>
    services.identities.delete(serverId)
  )

  ipcMain.handle(IPC.dismissSuggestion, (_e, id: string) => services.store.dismissSuggestion(id))

  ipcMain.handle(IPC.checkTrends, () => services.trends.check())

  ipcMain.handle(IPC.getReadiness, () => getReadiness())

  ipcMain.handle(IPC.installRuntime, (_e, runtimeId: string, command: string) =>
    runInstall(runtimeId, command)
  )

  ipcMain.handle(IPC.discoverSecrets, (_e, keys: string[]) => {
    services.refreshClients() // scan current client configs for matching keys
    return services.discoverSecrets(keys)
  })

  ipcMain.handle(IPC.useSecretCandidate, (_e, key: string, candidateId: string) =>
    services.useSecretCandidate(key, candidateId)
  )

  ipcMain.handle(
    IPC.deferKeys,
    (_e, plan: ConnectionPlan, keys: string[], remind: boolean) =>
      services.deferKeys(plan, keys, remind)
  )

  ipcMain.handle(IPC.getPendingKeys, () => services.store.getPendingKeys())

  ipcMain.handle(IPC.resolvePendingKey, (_e, id: string, value: string) =>
    services.resolvePendingKey(id, value)
  )

  ipcMain.handle(IPC.dismissPendingKey, (_e, id: string) => services.dismissPendingKey(id))
}
