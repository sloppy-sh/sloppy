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
		// One SPA bundled into the Tauri binary: `fallback` is what lets a client
		// route resolve when the webview loads a path straight off the filesystem.
		adapter: adapter({ fallback: 'index.html' }),
		env: { dir: '../../..' }
	}
};
