// @vitest-environment jsdom
import type {
	BlockDocument,
	CreateBlockRequest,
	DocumentNode,
	NodeView,
	OwnedRef
} from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import type { NoteReferences } from './contract.js';
import { docBlocks, openBlocks } from './document.js';
import {
	NOTE,
	OWNER,
	block,
	makeEditor,
	noDrafts,
	noEmoji,
	noMedia,
	ref,
	section,
	stubCanvas
} from './editor.test-support.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let created: CreateBlockRequest[];

function note(address: string, title: string): NodeView {
	return { ...NOTE, ref: ref(), address, depth: address.length, title };
}

const carries = (one: NodeView, query: string) =>
	!query ||
	one.address.startsWith(query.toLowerCase()) ||
	one.title.toLowerCase().includes(query.toLowerCase());

/** The notes a graph holds, and what happens when one more is written.
 *  `away` are the notes of another graph of the same person. */
function graph(
	held: NodeView[],
	writing: (title: string, relation: 'under' | 'after') => Promise<NodeView> = async () => {
		throw new Error('That note could not be added. Try again in a moment.');
	},
	opened: OwnedRef[] = [],
	away: NodeView[] = []
): NoteReferences {
	return {
		find: (query) => held.filter((one) => carries(one, query)),
		elsewhere: (query) =>
			away.filter((one) => carries(one, query)).map((note) => ({ note, graph: 'Garden' })),
		read: async (target) => [...held, ...away].find((one) => one.ref === target) ?? null,
		write: writing,
		open: (target) => void opened.push(target)
	};
}

function open(references: NoteReferences, blocks = [block({ content: section() })]) {
	mounted = mount(BlockStack, {
		target,
		props: {
			media: noMedia(),
			emoji: noEmoji(),
			drafts: noDrafts(),
			references,
			node: NOTE,
			blocks,
			onCreate: async (request: CreateBlockRequest) => {
				created.push(request);
				return block({ content: request.content as BlockDocument, ref: ref() });
			},
			onUpdate: async () => block(),
			onRemove: async () => {},
			onReorder: async () => block()
		}
	});
	flushSync();
}

/** TipTap hangs the editor off the element it writes into. */
const writingIn = (): Editor =>
	(target.querySelector('.sloppy-prose') as unknown as { editor: Editor }).editor;

const menu = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

/** The address on each row the menu shows; `undefined` where the row writes a
 *  note rather than naming one. */
const addresses = (): (string | undefined)[] =>
	menu().map((row) => row.querySelector('.address')?.textContent ?? undefined);

/** Types into the note the way a person does, and lets the menu answer. */
async function type(words: string): Promise<void> {
	writingIn().commands.insertContent(words);
	flushSync();
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
}

function tap(element: HTMLElement): void {
	element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	flushSync();
}

function press(key: string): void {
	writingIn().view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
}

/** Every reference in the note, as it would be written down. */
function referencesIn(of: Editor): { note: string; label: string }[] {
	const found: { note: string; label: string }[] = [];
	of.state.doc.descendants((child) => {
		if (child.type.name === 'reference') {
			found.push({ note: child.attrs.note as string, label: child.attrs.label as string });
		}
	});
	return found;
}

beforeEach(() => {
	created = [];
	stubResizeObserver();
	stubMediaQuery(() => false);
	stubCanvas();
	Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect;
	// jsdom lays nothing out, and scrolling the caret into view asks where it is.
	const noRects = (() => []) as unknown as Element['getClientRects'];
	Element.prototype.getClientRects = noRects;
	Range.prototype.getClientRects = noRects as unknown as Range['getClientRects'];
	Range.prototype.getBoundingClientRect = Element.prototype.getBoundingClientRect;
	target = document.createElement('div');
	document.body.appendChild(target);
	vi.useFakeTimers();
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	target.remove();
	document.body.innerHTML = '';
});

describe('finding a note from inside the writing', () => {
	it('lists what matches the words typed after [[', async () => {
		open(graph([note('1b', 'Photosynthesis'), note('1c', 'Seed banks')]));
		await type('as in [[photo');
		const rows = menu().map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim());
		expect(rows).toHaveLength(3);
		expect(rows[0]).toContain('Photosynthesis');
		expect(rows[1]).toBe('Write “photo” under this note');
		expect(rows[2]).toBe('Write “photo” after this note');
	});

	it('leads with the note already under that name, wherever its address sorts it', async () => {
		open(
			graph([
				note('1a', 'guard cells overview'),
				note('1b', 'guard cells notes'),
				note('1c', 'guard cells and stomata'),
				note('1d', 'guard cells in ferns'),
				note('1e', 'guard cells at night'),
				note('1f', 'guard cells, water'),
				note('1g', 'Guard cells')
			])
		);
		await type('[[Guard cells');
		expect(addresses()).toEqual(['1g', '1a', '1b', '1c', '1d', '1e']);
	});

	it('lists what matches the address, which is what a person cites', async () => {
		open(graph([note('1b', 'Photosynthesis'), note('1c', 'Seed banks')]));
		await type('[[1c');
		expect(menu()[0].textContent).toContain('Seed banks');
	});

	it('names the note picked, and takes the typing that found it', async () => {
		const found = note('1b', 'Photosynthesis');
		open(graph([found]));
		await type('as in [[photo');
		tap(menu()[0]);

		expect(referencesIn(writingIn())).toEqual([{ note: found.ref, label: 'Photosynthesis' }]);
		expect(writingIn().state.doc.textContent.trimEnd()).toBe('as in');
		expect(document.querySelector('.sloppy-reference')?.textContent).toBe('Photosynthesis');
	});

	it('takes the whole of what was typed when the name has a bracket in it', async () => {
		const found = note('1b', 'Photo [draft]');
		open(graph([found]));
		await type('as in [[Photo [dr');
		tap(menu()[0]);

		expect(referencesIn(writingIn())).toEqual([{ note: found.ref, label: 'Photo [draft]' }]);
		expect(writingIn().state.doc.textContent.trimEnd()).toBe('as in');
	});

	it('starts again at the second [[ on the line, and leaves the first alone', async () => {
		const found = note('1b', 'Photosynthesis');
		open(graph([found, note('1c', 'Seed banks')]));
		await type('[[seed [[photo');
		tap(menu()[0]);

		expect(referencesIn(writingIn())).toEqual([{ note: found.ref, label: 'Photosynthesis' }]);
		expect(writingIn().state.doc.textContent.trimEnd()).toBe('[[seed');
	});

	it('holds a note with no title by its address', async () => {
		const found = note('1b', '');
		open(graph([found]));
		await type('[[1b');
		tap(menu()[0]);
		expect(referencesIn(writingIn())).toEqual([{ note: found.ref, label: '1b' }]);
	});

	it('writes down what it named, so the note reads the same when it is opened again', async () => {
		const found = note('1b', 'Photosynthesis');
		open(graph([found]), []);
		await type('[[photo');
		tap(menu()[0]);
		await vi.advanceTimersByTimeAsync(1000);

		const stored = created.at(-1)?.content as BlockDocument;
		const element = (stored.content?.[0]?.content ?? [])[0] as DocumentNode;
		expect(element).toEqual({
			type: 'reference',
			attrs: { note: found.ref, label: 'Photosynthesis' }
		});
	});

	it('opens the note a reference names when it is tapped', async () => {
		const found = note('1b', 'Photosynthesis');
		const opened: OwnedRef[] = [];
		open(graph([found], undefined, opened), [
			block({
				content: section({
					type: 'paragraph',
					content: [{ type: 'reference', attrs: { note: found.ref, label: 'Photosynthesis' } }]
				})
			})
		]);
		await vi.advanceTimersByTimeAsync(0);
		document
			.querySelector('.sloppy-reference')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(opened).toEqual([found.ref]);
	});

	it('says a note it names is gone, and does not pretend to reach it', async () => {
		const opened: OwnedRef[] = [];
		open(graph([], undefined, opened), [
			block({
				content: section({
					type: 'paragraph',
					content: [{ type: 'reference', attrs: { note: ref(), label: 'What was written there' } }]
				})
			})
		]);
		await vi.advanceTimersByTimeAsync(0);
		const drawn = document.querySelector('.sloppy-reference');
		expect(drawn?.classList.contains('is-gone')).toBe(true);
		expect(drawn?.getAttribute('aria-label')).toBe(
			'What was written there — this note is no longer here'
		);
		drawn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(opened).toEqual([]);
	});

	it('shows the title the note carries now, not the words it was cited under', async () => {
		const found = note('1b', 'Photosynthesis, again');
		open(graph([found]), [
			block({
				content: section({
					type: 'paragraph',
					content: [{ type: 'reference', attrs: { note: found.ref, label: 'Photosynthesis' } }]
				})
			})
		]);
		await vi.advanceTimersByTimeAsync(0);
		expect(document.querySelector('.sloppy-reference')?.textContent).toBe('Photosynthesis, again');
	});
});

describe('writing a note that is not there yet', () => {
	it('offers both ways a note is written, and takes the one chosen', async () => {
		const written: { title: string; relation: string }[] = [];
		const made = note('1a1', 'Guard cells');
		open(
			graph([], async (title, relation) => {
				written.push({ title, relation });
				return made;
			})
		);
		await type('see [[Guard cells');
		tap(menu()[0]);
		await vi.advanceTimersByTimeAsync(0);

		expect(written).toEqual([{ title: 'Guard cells', relation: 'under' }]);
		expect(referencesIn(writingIn())).toEqual([{ note: made.ref, label: 'Guard cells' }]);
		expect(writingIn().state.doc.textContent.trimEnd()).toBe('see');
	});

	it('writes the note after this one when that is the row chosen', async () => {
		const written: { title: string; relation: string }[] = [];
		const made = note('1b', 'Guard cells');
		open(
			graph([], async (title, relation) => {
				written.push({ title, relation });
				return made;
			})
		);
		await type('[[Guard cells');
		tap(menu()[1]);
		await vi.advanceTimersByTimeAsync(0);

		expect(written).toEqual([{ title: 'Guard cells', relation: 'after' }]);
		expect(referencesIn(writingIn())).toEqual([{ note: made.ref, label: 'Guard cells' }]);
	});

	it('keeps what was typed while the note was being written', async () => {
		let answer: ((note: NodeView) => void) | null = null;
		const made = note('1a1', 'Guard cells');
		open(graph([], () => new Promise<NodeView>((resolve) => (answer = resolve))));
		await type('[[Guard cells');
		tap(menu()[0]);
		await type(' and more');
		answer!(made);
		await vi.advanceTimersByTimeAsync(0);

		expect(writingIn().state.doc.textContent).not.toContain('[[');
		expect(writingIn().state.doc.textContent).toContain('and more');
		expect(referencesIn(writingIn())).toEqual([{ note: made.ref, label: 'Guard cells' }]);
	});

	it('offers nothing to write where a note already carries that name', async () => {
		open(graph([note('1b', 'Guard cells')]));
		await type('[[Guard cells');
		expect(menu()).toHaveLength(1);
		expect(menu()[0].textContent).toContain('Guard cells');
	});

	it('says so when a note could not be written, and leaves the words alone', async () => {
		open(graph([]));
		await type('[[Guard cells');
		tap(menu()[0]);
		await vi.advanceTimersByTimeAsync(0);

		expect(document.querySelector('[role="alert"]')?.textContent).toBe(
			'That note could not be added. Try again in a moment.'
		);
		expect(referencesIn(writingIn())).toEqual([]);
		expect(writingIn().state.doc.textContent).toBe('[[Guard cells');
	});
});

describe('the menu never writes a note by itself', () => {
	it('leaves the words as they were typed when it is dismissed', async () => {
		const written: string[] = [];
		open(
			graph([], async (title) => {
				written.push(title);
				return note('1a1', title);
			})
		);
		await type('[[Guard cells');
		expect(menu()).not.toHaveLength(0);

		press('Escape');
		expect(menu()).toHaveLength(0);
		expect(written).toEqual([]);
		expect(writingIn().state.doc.textContent).toBe('[[Guard cells');
	});

	// The sheet the note is written in closes on Escape too, and it listens on the
	// document: one key must not cost the writer the note along with the menu.
	it('takes the Escape that dismissed it, and lets nothing else have it', async () => {
		const heard: KeyboardEvent[] = [];
		const listen = (event: Event) => heard.push(event as KeyboardEvent);
		document.addEventListener('keydown', listen);
		try {
			open(graph([]));
			await type('[[Guard cells');
			expect(menu()).not.toHaveLength(0);

			press('Escape');

			expect(menu()).toHaveLength(0);
			expect(heard).toHaveLength(0);
		} finally {
			document.removeEventListener('keydown', listen);
		}
	});

	it('stays gone for the rest of the line once it has been dismissed', async () => {
		open(graph([]));
		await type('[[Guard cells');
		press('Escape');
		await type(' and the rest of the sentence');
		expect(menu()).toHaveLength(0);
	});

	it('lets go once what follows [[ is a sentence rather than a name', async () => {
		open(graph([]));
		await type(`[[${'a name that runs on and on '.repeat(4)}`);
		expect(menu()).toHaveLength(0);
	});
});

// The developer's ruling: writing here stays the primary act, and reaching a
// note in another graph is offered beside it rather than instead of it.
describe('a note in another of the same person’s graphs', () => {
	const away = (address: string, title: string) => note(address, title);

	it('is offered under the rows this graph answers with, and after both ways of writing one', async () => {
		open(
			graph([note('1b', 'Photosynthesis')], undefined, [], [away('1a', 'Photosynthesis in ferns')])
		);
		await type('as in [[photo');
		const rows = menu().map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim());
		expect(rows).toHaveLength(4);
		expect(rows[0]).toContain('Photosynthesis');
		expect(rows[1]).toBe('Write “photo” under this note');
		expect(rows[2]).toBe('Write “photo” after this note');
		expect(rows[3]).toContain('Photosynthesis in ferns');
	});

	// An address means one thing inside one graph, so the row says which one it
	// came from — and the row for a note in this graph says nothing.
	it('says which graph it is read in', async () => {
		open(graph([note('1b', 'Photosynthesis')], undefined, [], [away('1a', 'Beds')]));
		await type('[[');
		const rows = menu();
		expect(rows[0].textContent).not.toContain('Garden');
		expect(rows.at(-1)?.textContent).toContain('Garden');
		expect(rows.at(-1)?.getAttribute('aria-label')).toBe('1a Beds, in Garden');
	});

	it('writes the reference to it, exactly as one to a note here', async () => {
		const there = away('1a', 'Beds');
		open(graph([], undefined, [], [there]));
		await type('[[Beds');
		tap(menu().at(-1) as HTMLElement);
		await vi.advanceTimersByTimeAsync(0);
		expect(referencesIn(writingIn())).toEqual([{ note: there.ref, label: 'Beds' }]);
	});

	it('offers nothing extra where the person keeps one graph', async () => {
		open(graph([note('1b', 'Photosynthesis')]));
		await type('[[photo');
		expect(menu()).toHaveLength(3);
	});
});

describe('a reference already written down', () => {
	it('opens as itself and is written back unchanged', () => {
		const named = `${OWNER}/${'1'.repeat(26)}` as OwnedRef;
		const stored = section({
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'as in ' },
				{ type: 'reference', attrs: { note: named, label: 'Photosynthesis' } }
			]
		});
		const { editor } = makeEditor([block({ content: stored })]);
		const opened = openBlocks([block({ content: stored })], editor.schema);
		expect(opened.doc.content).toHaveLength(1);
		expect(docBlocks(editor.state.doc)[0].content).toEqual(stored);
	});
});
