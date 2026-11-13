import { MemoryFiles, namedProjects, servingProjects } from '@sloppy/local';
import { LOOK_LIST, type LooksListed } from '@sloppy/types';
import { dressed, schemes } from '@sloppy/ui';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_LOOKS, LOOK_LABELS } from '../stores/prefs.svelte.js';
import { looksListed } from './look.js';
import { servedMethods } from './methods.js';
import './served.js';

const FACETS = Array.from({ length: 8 }, (_, slot) => `--facet-${slot + 1}`);

async function askedOver(): Promise<Record<string, unknown>> {
	const files = new MemoryFiles({ root: '/work/garden', data: '/work/garden-data' });
	const loop = servingProjects(
		namedProjects([{ name: 'garden', server: { version: '1', files } }]),
		{ methods: servedMethods }
	);
	const answers: Record<string, unknown>[] = [];
	loop.take(
		JSON.stringify({ jsonrpc: '2.0', id: 1, method: LOOK_LIST }),
		(line) => answers.push(JSON.parse(line)),
		'quest'
	);
	await loop.settled();
	expect(answers).toHaveLength(1);
	return answers[0];
}

describe('the looks a desk lists for a headset', () => {
	it('stands Sloppy’s own five first, in the order the desk offers them', async () => {
		const { looks } = await looksListed();

		expect(looks.slice(0, BUILT_IN_LOOKS.length).map(({ id, name }) => [id, name])).toEqual(
			BUILT_IN_LOOKS.map((look) => [look, LOOK_LABELS[look]])
		);
		const own = Object.fromEntries(looks.slice(0, 5).map((look) => [look.id, look]));
		expect(own.paper.variant).toBe('light');
		expect(own.graphite.variant).toBe('dark');
		expect(own.dark.variant).toBe('dark');
		expect(own.contrast.variant).toBe('light');
		expect(own.paper.palette['--background']).toBe('oklch(0.972 0.006 85)');
		expect(own.graphite.palette['--facet-1']).toBe('oklch(0.54 0.13 25)');
		expect(own.light.palette['--facet-8']).toBe('oklch(0.61 0.13 340)');
		expect(own.paper.author).toBeUndefined();
	});

	it('follows them with every legible scheme, light before dark, each by name', async () => {
		const { looks } = await looksListed();
		const collection = looks.slice(BUILT_IN_LOOKS.length);
		const legible = (await schemes()).filter((scheme) => dressed(scheme) !== null);

		expect(collection.map(({ id }) => id).sort()).toEqual(legible.map(({ slug }) => slug).sort());
		const firstDark = collection.findIndex(({ variant }) => variant === 'dark');
		expect(firstDark).toBeGreaterThan(0);
		expect(collection.slice(firstDark).every(({ variant }) => variant === 'dark')).toBe(true);
		for (const run of [collection.slice(0, firstDark), collection.slice(firstDark)]) {
			const names = run.map(({ name }) => name);
			expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
		}
		const nord = collection.find(({ id }) => id === 'base16-nord');
		expect(nord).toMatchObject({ name: 'Nord', author: 'arcticicestudio', variant: 'dark' });
		expect(nord?.palette).toEqual(
			dressed(legible.find(({ slug }) => slug === 'base16-nord')!)?.tokens
		);
	});

	it('paints every look with the eight facet tokens', async () => {
		const { looks } = await looksListed();

		for (const look of looks) {
			for (const facet of FACETS) expect(look.palette[facet], `${look.id} ${facet}`).toBeTruthy();
		}
	});

	it('answers the same looks every time it is asked', async () => {
		const first: LooksListed = await looksListed();
		const again: LooksListed = await looksListed();

		expect(again).toBe(first);
	});

	it('is answered over the serving loop through the method table', async () => {
		const answer = await askedOver();

		expect(answer).toEqual({ jsonrpc: '2.0', id: 1, result: await looksListed() });
		expect(servedMethods[LOOK_LIST]?.queued).toBe(false);
	});
});
