// Thin typed access to the preload bridge. Keeps views from touching window.mcc directly.
export const api = window.mcc
export type Api = typeof api
