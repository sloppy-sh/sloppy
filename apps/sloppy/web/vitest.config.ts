import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// The Svelte plugin, but not SvelteKit: the only suite here is the prefs store,
// whose runes need compiling and whose subject is `<html>` and `localStorage`.
export default defineConfig({
	plugins: [svelte()],
	resolve: { conditions: ['browser'] },
	test: { include: ['src/**/*.test.ts'], environment: 'happy-dom' }
});
