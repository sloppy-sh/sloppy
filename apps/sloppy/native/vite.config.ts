import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// TAURI_DEV_HOST is set by the Tauri CLI during mobile dev: the iPad, phone or
// emulator loads the frontend off this machine, so vite has to listen on the LAN
// address and point HMR's websocket at it rather than at localhost.
const host = process.env.TAURI_DEV_HOST;

/** Where the frontend is served while developing. */
const nativePort = Number(process.env.SLOPPY_NATIVE_PORT ?? 8040);

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// The monorepo root holds the one .env both shells and the API read.
	envDir: '../../..',
	// TAURI_ENV_ is what `src/lib/platform.ts` reads — docs/ARCHITECTURE.md
	// § "The two files that carry the platform seam".
	envPrefix: ['VITE_', 'PUBLIC_', 'TAURI_ENV_'],
	build: { target: 'esnext' },
	// A component mounted in a test is browser code, and the server build of
	// svelte has no `mount`.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	server: {
		// `scripts/tauri.sh` reads the same value and tells Tauri where to look, so
		// the two cannot drift. Somebody whose 8040 is spoken for sets
		// SLOPPY_NATIVE_PORT — apps/sloppy/native/README.md.
		port: nativePort,
		// Never fall back to another port: Tauri has already been told this one,
		// and a silent move would point it at nothing.
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: 'ws', host, port: 8041 } : undefined
	},
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts'],
		// The first test in a file that mounts the whole app pays for compiling it,
		// which is seconds rather than milliseconds and is not what the test is
		// measuring; the default would call that a hang under a loaded machine.
		testTimeout: 30_000
	}
});
