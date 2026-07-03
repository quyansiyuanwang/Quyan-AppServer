/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BASE_URL?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_APP_DOCS_BASE_URL?: string;
  readonly VITE_SWAGGER_DOCS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "marked" {
  export const marked: {
    parse(markdown: string): string;
  };
}
