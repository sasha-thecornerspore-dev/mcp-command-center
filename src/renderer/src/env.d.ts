/// <reference types="vite/client" />
import type { MccApi } from '../../preload'

declare global {
  interface Window {
    mcc: MccApi
  }
}

export {}
