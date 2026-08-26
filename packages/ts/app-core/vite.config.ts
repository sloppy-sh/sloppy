import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// `src` only: packaging copies the suite into `dist` and
	// `.svelte-kit/__package__`, and vitest would otherwise run all three.
	test: { include: ['src/**/*.test.ts'] }
});
