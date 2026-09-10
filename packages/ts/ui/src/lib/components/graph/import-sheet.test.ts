// @vitest-environment jsdom
import type { ArchivePreview, ImportConflict, ImportSettlement } from '@sloppy/types';
import { flushSync, mount, unmount, type ComponentProps } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import ImportSheet from './import-sheet.svelte';

const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK' as const;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let acts: string[];
let settledWith: ImportSettlement | undefined;

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
		replacing: 0,
		merges: false,
		conflicts: [],
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
	settledWith = undefined;
	mounted = mount(ImportSheet, {
		target,
		props: {
			open: true,
			onimport: (settle) => {
				settledWith = settle;
				acts.push('import');
			},
			oncancel: () => acts.push('cancel'),
			...props
		}
	});
	await settle();
}

function buttons(reads: string): HTMLButtonElement[] {
	return [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes(reads));
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

	it('counts what a replace takes with it, rather than saying only that it replaces', async () => {
		await open({ preview: preview({ replaces: true, replacing: 12 }) });

		expect(screen()).toContain('You already keep this graph.');
		expect(screen()).toContain(
			'The 12 notes in it now, recently deleted ones included, make way for what is in the file.'
		);
		expect(screen()).not.toContain('beside the ones you keep');
	});

	it('counts a single note it takes without pluralising it', async () => {
		await open({ preview: preview({ replaces: true, replacing: 1 }) });

		expect(screen()).toContain('The 1 note in it now');
		expect(screen()).toContain('makes way for what is in the file.');
	});

	it('says a graph with nothing in it loses nothing', async () => {
		await open({ preview: preview({ replaces: true, replacing: 0 }) });

		expect(screen()).toContain('there is nothing in it now');
		expect(screen()).not.toContain('make way');
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
		await open({ preview: preview({ collisions: [`${DID}/01A`], replaces: true, replacing: 3 }) });

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
		await open({
			preview: preview({ notes: 0, pictures: 0, replaces: true, replacing: 5 }),
			yours: false
		});

		expect(screen()).not.toContain('make way for what is in the file');
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

// docs/ARCHITECTURE.md § "A graph on disk": an archive of a graph the reader
// already keeps is settled note by note, never written over.
describe('the two copies of one graph', () => {
	const NOTE = `${DID}/01JRZ0000000000000000000B1` as const;
	const OTHER = `${DID}/01JRZ0000000000000000000B2` as const;
	const FIRST = '01JRZ0000000000000000000S1';
	const SECOND = '01JRZ0000000000000000000S2';

	function merging(conflicts: ImportConflict[], over: Partial<ArchivePreview> = {}) {
		return preview({ replaces: true, replacing: 9, merges: true, conflicts, ...over });
	}

	function wrote(over: Partial<ImportConflict> = {}): ImportConflict {
		return {
			kind: 'note',
			ref: NOTE,
			sections: [],
			mine: 'Osmosis, as I left it',
			theirs: 'Osmosis, as the file has it',
			...over
		};
	}

	it('says the two become one, and never that anything makes way', async () => {
		await open({ preview: merging([]) });

		expect(screen()).toContain('You already keep this graph, so the two copies become one.');
		expect(screen()).toContain(
			'What is only in the file arrives, what is only here stays, and nothing here is thrown away.'
		);
		expect(screen()).toContain('The two copies agree about everything in them.');
		expect(screen()).not.toContain('make way for what is in the file');
	});

	it('brings a graph that agrees about everything in with nothing to settle', async () => {
		await open({ preview: merging([]) });

		expect(button('Import').disabled).toBe(false);
		button('Import').click();
		await settle();

		expect(acts).toEqual(['import']);
		expect(settledWith).toEqual({ resolutions: [] });
	});

	it('counts the notes that need settling and offers no import until they are', async () => {
		await open({ preview: merging([wrote(), wrote({ ref: OTHER })]) });

		expect(screen()).toContain('2 notes need settling before this comes in.');
		expect(button('Import').disabled).toBe(true);

		buttons('Keep what is here')[0].click();
		await settle();

		expect(button('Import').disabled).toBe(true);

		buttons("Take the file's")[1].click();
		await settle();

		expect(button('Import').disabled).toBe(false);
	});

	it('counts one note that needs settling without pluralising it', async () => {
		await open({ preview: merging([wrote()]) });

		expect(screen()).toContain('One note needs settling before this comes in.');
	});

	it('shows both copies of a note both sides wrote in, and carries the choice', async () => {
		await open({ preview: merging([wrote()]) });

		expect(screen()).toContain('Both copies of this note were written in.');
		expect(screen()).toContain('Osmosis, as I left it');
		expect(screen()).toContain('Osmosis, as the file has it');

		button("Take the file's").click();
		await settle();
		button('Import').click();
		await settle();

		expect(settledWith).toEqual({
			resolutions: [{ kind: 'note', ref: NOTE, keep: 'theirs', sections: [] }]
		});
	});

	it('says so where one of the two has nothing written in it', async () => {
		await open({ preview: merging([wrote({ mine: '' })]) });

		expect(screen()).toContain('Nothing written in it.');
	});

	// AI.md: the address is the label a person cites, and a ref never is.
	it('asks which note keeps a number the two copies have on different notes', async () => {
		await open({ preview: merging([wrote({ kind: 'address', other: OTHER, address: '1a1' })]) });

		expect(screen()).toContain('1a1');
		expect(screen()).toContain('Both copies carry this number, on a different note.');
		expect(screen()).not.toContain('01JRZ0000000000000000000B1');

		button("The file's note keeps it").click();
		await settle();
		button('Import').click();
		await settle();

		expect(settledWith).toEqual({
			resolutions: [{ kind: 'address', ref: NOTE, keep: 'theirs', sections: [] }]
		});
	});

	it('settles a note section by section, and offers no import until every one is chosen', async () => {
		await open({
			preview: merging([wrote({ kind: 'section', sections: [FIRST, SECOND] })])
		});

		expect(screen()).toContain('Both copies wrote into the same sections of this note.');
		button('Choose section by section').click();
		await settle();

		expect(screen()).toContain('Section 1');
		expect(screen()).toContain('Section 2');
		expect(button('Import').disabled).toBe(true);

		buttons('Keep this one')[0].click();
		await settle();

		expect(button('Import').disabled).toBe(true);

		buttons("Take the file's")[1].click();
		await settle();
		button('Import').click();
		await settle();

		expect(settledWith).toEqual({
			resolutions: [
				{
					kind: 'section',
					ref: NOTE,
					keep: 'mine',
					sections: [
						{ section: FIRST, keep: 'mine' },
						{ section: SECOND, keep: 'theirs' }
					]
				}
			]
		});
	});

	it('never names a section by the identifier it is stored under', async () => {
		await open({ preview: merging([wrote({ kind: 'section', sections: [FIRST] })]) });
		button('Choose section by section').click();
		await settle();

		expect(screen()).not.toContain(FIRST);
	});

	it('goes back to choosing for the whole note, and forgets the sections chosen', async () => {
		await open({ preview: merging([wrote({ kind: 'section', sections: [FIRST] })]) });
		button('Choose section by section').click();
		await settle();
		button('Keep this one').click();
		await settle();

		expect(button('Import').disabled).toBe(false);

		button('Choose for the whole note instead').click();
		await settle();

		expect(button('Import').disabled).toBe(true);
		button("Take the file's").click();
		await settle();
		button('Import').click();
		await settle();

		expect(settledWith).toEqual({
			resolutions: [{ kind: 'section', ref: NOTE, keep: 'theirs', sections: [] }]
		});
	});

	it('still stops an archive whose notes are kept in another graph', async () => {
		await open({ preview: merging([], { collisions: [`${DID}/01A`] }) });

		expect(button('Import').disabled).toBe(true);
	});

	it('repeats the words a settled import came back refused with', async () => {
		await open({ preview: merging([wrote()]), refused: 'That number is another note’s.' });

		expect(screen()).toContain('That number is another note’s.');
	});
});
