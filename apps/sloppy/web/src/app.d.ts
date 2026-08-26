// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}

	interface ImportMetaEnv {
		/** Where the API answers. Absent — the ordinary case — means this app's
		 *  own origin. */
		readonly PUBLIC_SLOPPY_API_URL?: string;
	}
}

export {};
