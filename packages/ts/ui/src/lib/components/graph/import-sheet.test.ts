// @vitest-environment jsdom
import type { ArchivePreview } from '@sloppy/types';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import ImportSheet from './import-sheet.svelte';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' as const;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let acts: string[];

function preview(over: Partial<ArchivePreview> = {}): ArchivePreview {
	return {
		format: 1,
		graph: '01JRZ0000000000000000000AA',
		name: 'Osmosis',
		owner: DID,
		notes: 42,
		pictures: 7,
		missing_emoji: [],
		collisions: [],
		replaces: false,
		...over
	};
}

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at++) {
		flushSync();
		await new Promise(requestAnimationFrame);
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

async function open(props: Partial<ComponentProps<typeof ImportSheet>> = {}): Promise<void> {
	if (mounted) unmount(mounted, { outro: false });
	document.body.innerHTML = '';
	target = document.createElement('div');
	document.body.appendChild(target);
	acts = [];
	mounted = mount(ImportSheet, {
		target,
		props: {
			open: true,
			onimport: () => acts.push('import'),
			oncancel: () => acts.push('cancel'),
			...props
		}
	});
	await settle();
}

function button(reads: string): HTMLButtonElement {
	const found = [...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes(reads)
	);
	if (!found) throw new Error(`No button on screen reads "${reads}"`);
	return found;
}

/** What is on screen, as one line: the sheet's paragraphs wrap in the source. */
const screen = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

// docs/ARCHITECTURE.md § "A graph on disk": an archive says what it holds
// before it is opened, so nobody imports one to find out.
describe('the preview a graph in a file opens', () => {
	it('names the graph, what arrives with it, and where it lands', async () => {
		await open({ preview: preview() });

		expect(screen()).toContain('Import “Osmosis”?');
		expect(screen()).toContain('42 notes and 7 pictures arrive.');
		expect(screen()).toContain('It arrives as a graph of its own, beside the ones you keep.');
		button('Import').click();
		await settle();

		expect(acts).toEqual(['import']);
	});

	it('says a graph already kept is replaced rather than stood beside', async () => {
		await open({ preview: preview({ replaces: true }) });

		expect(screen()).toContain('You already keep this graph.');
		expect(screen()).toContain('What is in the file replaces what is here.');
		expect(screen()).not.toContain('beside the ones you keep');
	});

	it('counts one note without pluralising it', async () => {
		await open({ preview: preview({ notes: 1, pictures: 0 }) });

		expect(screen()).toContain('1 note arrives.');
	});

	// AI.md § "The Genealogy Is the Protocol": the ref is identity and the
	// address is a label, so what is said is whose the notes become.
	it('says the notes become yours where somebody else wrote them', async () => {
		await open({ preview: preview(), yours: false });

		expect(screen()).toContain('It was written under another identity.');
		expect(screen()).toContain('The notes become yours here, and keep the numbers they carry.');
	});

	it('says nothing about another identity where the graph is your own', async () => {
		await open({ preview: preview(), yours: true });

		expect(screen()).not.toContain('another identity');
	});

	it('names the emoji that cannot come along, and what the notes keep', async () => {
		await open({ preview: preview({ missing_emoji: ['seedling', 'ink'] }) });

		expect(screen()).toContain(
			'2 emoji it was written with cannot come along: :seedling: and :ink:.'
		);
		expect(screen()).toContain('The notes keep the words they were typed as.');
	});

	it('names three of them and counts the rest', async () => {
		await open({ preview: preview({ missing_emoji: ['a', 'b', 'c', 'd', 'e'] }) });

		expect(screen()).toContain('cannot come along: :a:, :b:, :c: and 2 more.');
	});

	it('says which one where a single emoji is missing', async () => {
		await open({ preview: preview({ missing_emoji: ['seedling'] }) });

		expect(screen()).toContain('One emoji it was written with cannot come along: :seedling:.');
	});

	// A note keeps its ulid through an import, so one this person already keeps
	// in some other graph is what an arriving archive cannot land beside.
	it('does not offer an import of notes kept in another graph', async () => {
		await open({ preview: preview({ collisions: [`${DID}/01A`, `${DID}/01B`] }) });

		expect(screen()).toContain('2 of these notes are already in another of your graphs.');
		expect(screen()).toContain('this graph cannot come in');
		expect(button('Import').disabled).toBe(true);
	});

	it('never says an internal identifier of the notes kept elsewhere', async () => {
		await open({ preview: preview({ collisions: [`${DID}/01JRZ0000000000000000000AB`] }) });

		expect(screen()).toContain('One of these notes is already in another of your graphs.');
		expect(screen()).not.toContain('01JRZ0000000000000000000AB');
	});

	// Replacing a graph writes over its own notes, and one of them living in
	// another graph now still stops the whole archive.
	it('does not offer a replace either while a note of it is kept elsewhere', async () => {
		await open({ preview: preview({ collisions: [`${DID}/01A`], replaces: true }) });

		expect(screen()).toContain('One of these notes is already in another of your graphs.');
		expect(button('Import').disabled).toBe(true);
	});

	it('offers nothing to import out of a graph with no notes in it', async () => {
		await open({ preview: preview({ notes: 0, pictures: 0 }) });

		expect(screen()).toContain('There is nothing in it to bring in.');
		expect(screen()).not.toContain('beside the ones you keep');
		expect(screen()).not.toContain('another identity');
		expect(button('Import').disabled).toBe(true);
	});

	it('says nothing about where an empty graph would land, on a replace either', async () => {
		await open({ preview: preview({ notes: 0, pictures: 0, replaces: true }), yours: false });

		expect(screen()).not.toContain('replaces what is here');
	});

	it('says the file is being read before it says what is in it', async () => {
		await open({ preview: null, reading: true });

		expect(screen()).toContain('Reading what is in the file…');
		expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Import')).toBe(
			false
		);
		button('Cancel').click();
		await settle();

		expect(acts).toEqual(['cancel']);
	});

	it('repeats the words a refusal came back with', async () => {
		await open({ preview: null, refused: "This file isn't a Sloppy graph." });

		expect(screen()).toContain("This file isn't a Sloppy graph.");
		expect(screen()).not.toContain('Reading what is in the file');
	});

	it('stops taking taps while the import is with the server', async () => {
		await open({ preview: preview(), busy: true });

		expect(button('Import').disabled).toBe(true);
		expect(button('Cancel').disabled).toBe(true);
	});
});
