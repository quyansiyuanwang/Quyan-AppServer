/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_BACKEND_URL: string
	readonly VITE_AI_PROXY_URL: string
	readonly VITE_RELAY_PUBLIC_BASE_URL?: string
	readonly VITE_RECAPTCHA_SITE_KEY?: string
	readonly VITE_TURNSTILE_SITE_KEY?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
