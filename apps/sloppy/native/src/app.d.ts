// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}

	interface ImportMetaEnv {
		/** The API's origin, shared with the web shell through the root `.env`. */
		readonly PUBLIC_SLOPPY_API_URL?: string;
		/** Written only by `scripts/tauri.sh` — `src/lib/local-mode.ts`. */
		readonly PUBLIC_ENABLE_LOCAL_MODE?: string;
		/** Set by the Tauri CLI for a platform build — `src/lib/platform.ts`. */
		readonly TAURI_ENV_PLATFORM?: string;
	}
}

export {};
