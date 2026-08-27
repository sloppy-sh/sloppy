import { sveltekit } from '@sveltejs/kit/vite';
import { apiUrl } from '@sloppy/client';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const WORKSPACE_ROOT = '../../..';

/** Where `@sloppy/client` mounts the API. `host.ts` owns the answer. */
const API_PREFIX = apiUrl('');

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, WORKSPACE_ROOT, '');
	return {
		plugins: [tailwindcss(), sveltekit()],
		envDir: WORKSPACE_ROOT,
		// Also on `import.meta.env`, and not only through `$env/static/public`,
		// which fails the build for a variable nobody set — and the one this
		// shell reads is meant to be unset in the ordinary deployment.
		envPrefix: ['VITE_', 'PUBLIC_'],
		server: {
			// Sloppy's own block: 8010 the database, 8020 the API.
			port: 8030,
			strictPort: true,
			// The app and the API share an origin wherever this is deployed. In
			// dev they are two processes, so the dev server stands in for it.
			proxy: {
				[API_PREFIX]: `http://localhost:${env.SLOPPY_API_PORT || 8020}`
			}
		},
		preview: { port: 8030, strictPort: true }
	};
});
