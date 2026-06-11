import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { AppState } from '@shared/types'
import { api } from './api'

interface StateCtx {
  state: AppState | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const Ctx = createContext<StateCtx>({
  state: null,
  loading: true,
  error: null,
  reload: async () => {}
})

export function AppStateProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setError(null)
      const s = await api.getState()
      setState(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return <Ctx.Provider value={{ state, loading, error, reload }}>{children}</Ctx.Provider>
}

export function useAppState(): StateCtx {
  return useContext(Ctx)
}
