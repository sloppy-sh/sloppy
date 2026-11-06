// Draws the root README's benchmark charts from bench/results/summary.json through the site's own
// readings, so the README and sloppy.sh say the same numbers. Run with `pnpm readme-figures`.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const lib = fileURLToPath(new URL('../src/lib', import.meta.url));
await runnerImport('/scripts/readme-figures.ts', {
	configFile: false,
	root: fileURLToPath(new URL('..', import.meta.url)),
	resolve: { alias: { $lib: lib } },
	logLevel: 'warn'
});
