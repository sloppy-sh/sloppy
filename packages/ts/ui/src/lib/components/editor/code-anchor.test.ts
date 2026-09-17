// @vitest-environment jsdom
import { type CodeAnchor, parseCodeAnchor } from '@sloppy/types';
import type { Editor } from '@tiptap/core';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import BlockStack from './block-stack.svelte';
import { anchorLabel, codeHref } from './code-anchor.js';
import type { NoteCode } from './contract.js';
import {
	NOTE,
	block,
	noCode,
	noDrafts,
	noEmoji,
	noMedia,
	noNotes,
	ref,
	section,
	stubCanvas
} from './editor.test-support.js';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

/** Every shape of anchor there is, so what is written down and read back is
 *  held to the whole set rather than to one of them. */
const EVERY_ANCHOR: CodeAnchor[] = [
	{ path: 'parser.ts' },
	{ path: 'src/history.rs' },
	{ path: 'src/deep/down/where.tsx' },
	{ path: 'parser.ts', fragment: { kind: 'lines', from: 12, to: 12 } },
	{ path: 'src/parser.ts', fragment: { kind: 'lines', from: 12, to: 20 } },
	{ path: 'src/parser.ts', fragment: { kind: 'lines', from: 1, to: 9999 } },
	{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'discover' } },
	{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'Lifecycle' } },
	{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'L0' } },
	{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'L20-L12' } }
];

function open(code: NoteCode | undefined, blocks = [block({ content: section() })]) {
	mounted = mount(BlockStack, {
		target,
		props: {
			media: noMedia(),
			emoji: noEmoji(),
			references: noNotes(),
			drafts: noDrafts(),
			code,
			node: NOTE,
			blocks,
			onCreate: async () => block({ ref: ref() }),
			onUpdate: async () => block(),
			onRemove: async () => {},
			onReorder: async () => block()
		}
	});
	flushSync();
}

const writingIn = (): Editor =>
	(target.querySelector('.sloppy-prose') as unknown as { editor: Editor }).editor;

const surface = (): HTMLElement => target.querySelector('.sloppy-prose') as HTMLElement;

function focusWriting(): void {
	surface().dispatchEvent(new FocusEvent('focus', { bubbles: true }));
	flushSync();
}

const control = (label: string) =>
	target.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

/** A section holding one anchor, written as the link it is. */
const anchored = (href: string, label = 'the parser') =>
	block({
		content: section({
			type: 'paragraph',
			content: [{ type: 'text', marks: [{ type: 'link', attrs: { href } }], text: label }]
		})
	});

beforeEach(() => {
	stubResizeObserver();
	stubMediaQuery(() => false);
	stubCanvas();
	Element.prototype.getBoundingClientRect = () =>
		({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect;
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

describe('what an anchor is written down as', () => {
	it('reads back as the anchor it was written from, whatever it names', () => {
		for (const anchor of EVERY_ANCHOR) {
			expect(parseCodeAnchor(codeHref(anchor)), codeHref(anchor)).toEqual(anchor);
		}
	});

	it('writes a different address for every anchor, so no two run together', () => {
		expect(new Set(EVERY_ANCHOR.map(codeHref)).size).toBe(EVERY_ANCHOR.length);
	});

	it('reads as the file with the lines or the name after it', () => {
		expect(anchorLabel({ path: 'src/parser.ts' })).toBe('parser.ts');
		expect(
			anchorLabel({ path: 'src/parser.ts', fragment: { kind: 'lines', from: 12, to: 20 } })
		).toBe('parser.ts · L12-20');
		expect(
			anchorLabel({ path: 'src/parser.ts', fragment: { kind: 'lines', from: 12, to: 12 } })
		).toBe('parser.ts · L12');
		expect(
			anchorLabel({ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'discover' } })
		).toBe('history.rs · discover');
	});
});

describe('pointing a note at code', () => {
	it('is one tap from the writing bar, out of the rail that scrolls', () => {
		open(noCode());
		focusWriting();

		const bar = target.querySelector('[role="toolbar"]') as HTMLElement;
		const rail = bar.querySelector('.overflow-x-auto') as HTMLElement;
		expect(control('Cite code')).not.toBeNull();
		expect(rail.contains(control('Cite code'))).toBe(false);
	});

	it('puts the place named into the writing as an ordinary link', async () => {
		const anchor: CodeAnchor = {
			path: 'src/parser.ts',
			fragment: { kind: 'lines', from: 12, to: 20 }
		};
		open(noCode({ cite: async () => anchor }));
		focusWriting();

		control('Cite code')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		const link = surface().querySelector('a') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('code:src/parser.ts#L12-L20');
		expect(link.textContent).toBe('parser.ts · L12-20');
		// The caret carries on beside the chip rather than inside it.
		expect(writingIn().state.doc.textContent).toBe('parser.ts · L12-20 ');
		expect(writingIn().isActive('link')).toBe(false);
	});

	it('writes nothing where the writer named nowhere', async () => {
		open(noCode());
		focusWriting();

		control('Cite code')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(0);
		flushSync();

		expect(surface().querySelector('a')).toBeNull();
	});

	// A graph that is nobody's project has no code to point at.
	it('is not offered where there is no code beside the graph', () => {
		open(undefined);
		focusWriting();

		expect(control('Cite code')).toBeNull();
	});
});

describe('an anchor in the writing', () => {
	it('opens the code it names rather than sending the reader anywhere', () => {
		const shown: CodeAnchor[] = [];
		open(noCode({ show: (anchor) => void shown.push(anchor) }), [
			anchored('code:src/history.rs#discover')
		]);

		const chip = surface().querySelector('a') as HTMLAnchorElement;
		chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		flushSync();

		expect(shown).toEqual([
			{ path: 'src/history.rs', fragment: { kind: 'symbol', name: 'discover' } }
		]);
		expect(surface().querySelector('a')?.textContent).toBe('the parser');
	});

	it('keeps its address, which the link extension would otherwise drop', () => {
		open(noCode(), [anchored('code:src/parser.ts#L12-L20')]);

		expect(surface().querySelector('a')?.getAttribute('href')).toBe('code:src/parser.ts#L12-L20');
	});

	it('is drawn as a chip only where there is code beside the graph', () => {
		open(noCode(), [anchored('code:src/parser.ts')]);
		expect(target.querySelector('[data-code-anchors]')).not.toBeNull();

		unmount(mounted!, { outro: false });
		mounted = undefined;
		open(undefined, [anchored('code:src/parser.ts')]);
		expect(target.querySelector('[data-code-anchors]')).toBeNull();
	});

	it('leaves a link to a page alone', () => {
		const shown: CodeAnchor[] = [];
		open(noCode({ show: (anchor) => void shown.push(anchor) }), [
			anchored('https://example.com/', 'example.com')
		]);

		const link = surface().querySelector('a') as HTMLAnchorElement;
		link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		flushSync();

		expect(shown).toEqual([]);
	});
});
