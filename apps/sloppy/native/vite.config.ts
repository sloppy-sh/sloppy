import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// TAURI_DEV_HOST is set by the Tauri CLI during mobile dev: the iPad, phone or
// emulator loads the frontend off this machine, so vite has to listen on the LAN
// address and point HMR's websocket at it rather than at localhost.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// The monorepo root holds the one .env both shells and the API read.
	envDir: '../../..',
	// TAURI_ENV_ is what makes `src/lib/platform.ts`'s constants compile-time:
	// with the prefix exposed, the target platform is a literal at build time and
	// the branches for every other platform are eliminated.
	envPrefix: ['VITE_', 'PUBLIC_', 'TAURI_ENV_'],
	build: { target: 'esnext' },
	server: {
		port: 5174,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: 'ws', host, port: 5175 } : undefined
	}
});
