/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_SELVREN_API_ORIGIN?: string;
  readonly VITE_SELVREN_AGENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
