import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { AppState, SystemReadiness } from '@shared/types'
import { api } from './api'

interface StateCtx {
  state: AppState | null
  readiness: SystemReadiness | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  refreshReadiness: () => Promise<void>
}

const Ctx = createContext<StateCtx>({
  state: null,
  readiness: null,
  loading: true,
  error: null,
  reload: async () => {},
  refreshReadiness: async () => {}
})

export function AppStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setError(null)
      setState(await api.getState())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshReadiness = useCallback(async () => {
    try {
      setReadiness(await api.getReadiness())
    } catch {
      /* readiness is best-effort */
    }
  }, [])

  useEffect(() => {
    void reload()
    void refreshReadiness()
  }, [reload, refreshReadiness])

  return (
    <Ctx.Provider value={{ state, readiness, loading, error, reload, refreshReadiness }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAppState(): StateCtx {
  return useContext(Ctx)
}
