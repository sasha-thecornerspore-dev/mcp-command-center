// Thin typed access to the preload bridge. Keeps views from touching window.mcc directly.
// Falls back to a mock when running outside Electron (screenshots / contributor preview).
import { createMockApi } from './mockApi'

export const api = window.mcc ?? createMockApi()
export type Api = typeof api
