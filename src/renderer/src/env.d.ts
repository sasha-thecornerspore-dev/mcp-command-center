/// <reference types="vite/client" />
import type { McpApi } from '@shared/api'

declare global {
  interface Window {
    mcc: McpApi
  }
}

export {}
