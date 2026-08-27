import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// `svelte()` rather than `sveltekit()`: the components are library code with no
// routes, and the only thing they want from SvelteKit is the `$lib` alias.
//
// The default environment stays node and the component suites opt into jsdom
// with a `@vitest-environment` docblock. A jsdom default would put every file
// through vite's browser transforms, and `token-contrast.test.ts` reads app.css
// off disk through `import.meta.url` — which that pass rewrites into an http URL.
export default defineConfig({
	plugins: [svelte()],
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) },
		conditions: ['browser']
	},
	test: { include: ['src/**/*.test.ts'] }
});
