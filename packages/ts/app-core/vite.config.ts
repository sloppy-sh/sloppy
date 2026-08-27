import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	// The stores are browser code: they read localStorage and write the theme
	// attributes onto <html>.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
	// `src` only: packaging copies the suite into `dist` and
	// `.svelte-kit/__package__`, and vitest would otherwise run all three.
	test: { environment: 'jsdom', include: ['src/**/*.test.ts'] }
});
