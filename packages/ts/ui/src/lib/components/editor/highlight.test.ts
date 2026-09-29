// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { colourLines, languageOf, languageOfPath } from './highlight.js';

describe('the language a file is written in', () => {
	it("reads it off the path, by the grammar's own names and by endings it has none for", async () => {
		expect(await languageOfPath('packages/ts/vault/src/history.rs')).toBe('rust');
		expect(await languageOfPath('src/lib/pages/graph.svelte')).toBe('svelte');
		expect(await languageOfPath('a/b/index.ts')).toBe('typescript');
		expect(await languageOfPath('README.md')).toBe('markdown');
		expect(await languageOfPath('Dockerfile')).toBe('docker');
		expect(await languageOfPath('include/parser.h')).toBe('c');
		expect(await languageOfPath('.gitignore')).toBeUndefined();
		expect(await languageOfPath('notes.txt')).toBeUndefined();
	});

	it("answers a code block's own name however it is spelled", async () => {
		expect(await languageOf('TypeScript')).toBe('typescript');
		expect(await languageOf(' ts ')).toBe('typescript');
		expect(await languageOf('')).toBeUndefined();
		expect(await languageOf('no-such-language')).toBeUndefined();
	});
});

describe('colour on code', () => {
	it('colours every run of every line, and reads back as the text it was given', async () => {
		const text = 'export const one = "1";\nlet two = 2;';
		const lines = await colourLines(text, 'ts');
		expect(lines).toHaveLength(2);
		expect(lines?.map((line) => line.map((run) => run.text).join(''))).toEqual(text.split('\n'));
		const styles = lines?.flat().map((run) => run.style) ?? [];
		expect(styles.some((style) => style.includes('--shiki-light'))).toBe(true);
		expect(styles.some((style) => style.includes('--shiki-dark'))).toBe(true);
	});

	it('colours nothing it has no grammar for', async () => {
		expect(await colourLines('plain words', undefined)).toBeUndefined();
		expect(await colourLines('plain words', 'no-such-language')).toBeUndefined();
	});
});
