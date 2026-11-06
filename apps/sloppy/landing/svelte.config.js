import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import ts from 'typescript';

/**
 * Svelte's own type stripping leaves `key?` behind in @xyflow/svelte's KeyHandler, and Vite's
 * drops imports only the markup uses, so that package's components are transpiled keeping them.
 */
const xyflowScripts = {
	script: ({ content, attributes, filename = '' }) => {
		if (attributes.lang !== 'ts' || !filename.includes('/@xyflow/svelte/')) return;
		const { outputText } = ts.transpileModule(content, {
			fileName: filename,
			compilerOptions: {
				target: ts.ScriptTarget.ESNext,
				module: ts.ModuleKind.ESNext,
				verbatimModuleSyntax: true
			}
		});
		return { code: outputText };
	}
};

/** @type {import('@sveltejs/kit').Config} */
export default {
	preprocess: [xyflowScripts, vitePreprocess()],
	compilerOptions: {
		// Runes everywhere except vendored library code. Removable in Svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// Every page is prerendered: the site is files, with nothing running behind them.
		adapter: adapter(),
		prerender: {
			// Every figure may be left out, when each names a private subject, and every long prompt,
			// when no run shown was sent one.
			handleUnseenRoutes: ({ routes, message }) => {
				const mayBeEmpty = ['/figures/[id].svg', '/runs/systems/[sha].txt'];
				if (routes.some((r) => !mayBeEmpty.includes(r))) throw new Error(message);
			}
		}
	}
};
