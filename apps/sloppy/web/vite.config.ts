import { sveltekit } from '@sveltejs/kit/vite';
import { apiUrl } from '@sloppy/client';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

const WORKSPACE_ROOT = '../../..';

/** Where `@sloppy/client` mounts the API. `host.ts` owns the answer. */
const API_PREFIX = apiUrl('');

/**
 * The other half of the origin the API answers on: syr discovery sits at the
 * site ROOT, which is why `main.ts` holds it out of the `/api` prefix. Standing
 * in for that origin means forwarding both, and sign-in through this instance's
 * own provider is what reads it.
 */
const DISCOVERY_PREFIX = '/.well-known/syr';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, WORKSPACE_ROOT, '');
	// In a container the API is another host; on the host it is a second port.
	const api = env.SLOPPY_API_ORIGIN || `http://localhost:${env.SLOPPY_API_PORT || 8020}`;
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
			// Every interface, because the phone and the iPad this is designed for
			// are not the machine it runs on — and in a container nothing reaches a
			// server bound to loopback.
			host: true,
			// The app and the API share an origin wherever this is deployed. In
			// dev they are two processes, so the dev server stands in for it.
			proxy: {
				[API_PREFIX]: api,
				[DISCOVERY_PREFIX]: api
			}
		},
		preview: { port: 8030, strictPort: true }
	};
});
