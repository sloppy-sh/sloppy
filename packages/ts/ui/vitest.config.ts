import { defineConfig } from 'vitest/config';

// No Svelte plugin: the only suite here measures the design tokens, and it
// reads app.css as text rather than compiling anything.
export default defineConfig({
	test: { include: ['src/**/*.test.ts'] }
});
