import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: vitePreprocess(),
	compilerOptions: {
		// Runes everywhere except vendored library code. Removable in Svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// A static SPA: no SvelteKit server, every route served by one HTML file
		// that boots the client. docs/ARCHITECTURE.md § "Deployment modes".
		adapter: adapter({ fallback: 'index.html' }),
		env: { dir: '../../..' }
	}
};
