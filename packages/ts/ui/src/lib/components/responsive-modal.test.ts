// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver, type MediaQueryStub } from './dom.test-support.js';
import { overlay } from './overlay.svelte.js';
import ResponsiveModal from './responsive-modal.svelte';

const PHONE = () => true;
const WIDE = () => false;

const body = createRawSnippet(() => ({ render: () => '<p data-testid="body">a thought</p>' }));

let media: MediaQueryStub;
let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function open(at: () => boolean) {
	media = stubMediaQuery(at);
	mounted = mount(ResponsiveModal, {
		target,
		props: { open: true, title: 'Add a node', children: body }
	});
	flushSync();
	return mounted;
}

/** shadcn stamps `data-slot` on every part, so the branch names itself. */
const variant = () =>
	document.body.querySelector('[data-slot="sheet-content"]')
		? 'sheet'
		: document.body.querySelector('[data-slot="dialog-content"]')
			? 'dialog'
			: undefined;

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

describe('the one modal', () => {
	it('is a bottom sheet on a phone', () => {
		open(PHONE);
		expect(variant()).toBe('sheet');
		expect(document.body.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
	});

	it('is a centered dialog from 640px', () => {
		open(WIDE);
		expect(variant()).toBe('dialog');
		expect(document.body.querySelector('[data-slot="modal-grabber"]')).toBeNull();
	});

	it('renders its body either way', () => {
		open(PHONE);
		expect(document.body.querySelector('[data-testid="body"]')).not.toBeNull();
	});

	it('keeps the branch it latched when the viewport crosses the breakpoint', () => {
		open(PHONE);
		media.change(WIDE);
		flushSync();
		expect(variant()).toBe('sheet');
	});

	it('keeps it in the other direction too', () => {
		open(WIDE);
		media.change(PHONE);
		flushSync();
		expect(variant()).toBe('dialog');
	});

	it('declares an overlay while it is up, and takes it back when it goes', () => {
		open(PHONE);
		expect(overlay.open).toBe(true);
		unmount(mounted!, { outro: false });
		mounted = undefined;
		flushSync();
		expect(overlay.open).toBe(false);
	});

	// Android's back gesture reaches a sheet through the overlay stack alone.
	it('goes down when the overlay is asked to close the top one', () => {
		let closed: boolean | undefined;
		media = stubMediaQuery(PHONE);
		mounted = mount(ResponsiveModal, {
			target,
			props: {
				open: true,
				title: 'Add a node',
				onOpenChange: (v: boolean) => (closed = v),
				children: body
			}
		});
		flushSync();

		expect(overlay.closeTop()).toBe(true);
		flushSync();

		expect(closed).toBe(false);
		expect(overlay.open).toBe(false);
	});

	// DESIGN.md § Motion: chrome transitions degrade to static. The utility is
	// important because the `data-[state]` variant it cancels outweighs it.
	it.each([
		['sheet', PHONE],
		['dialog', WIDE]
	])('stops the %s flying in for somebody who asked the OS for no motion', (slot, at) => {
		open(at);
		const surface = document.body.querySelector(`[data-slot="${slot}-content"]`);
		const behind = document.body.querySelector(`[data-slot="${slot}-overlay"]`);
		expect(surface?.className).toContain('motion-reduce:animate-none!');
		expect(behind?.className).toContain('motion-reduce:animate-none!');
	});

	// The drag-to-dismiss snap-back rides the surface's `transition`, which the
	// guard above deliberately leaves alone.
	it('keeps the transition the sheet is dragged back by', () => {
		open(PHONE);
		const surface = document.body.querySelector('[data-slot="sheet-content"]');
		expect(surface?.className).not.toContain('motion-reduce:transition-none');
		expect(surface?.className).toContain('transition');
	});

	it('puts the caret where the body asks for it', () => {
		media = stubMediaQuery(PHONE);
		const claimed: Event[] = [];
		mounted = mount(ResponsiveModal, {
			target,
			props: {
				open: true,
				title: 'Find a note',
				children: body,
				onOpenAutoFocus: (event: Event) => {
					event.preventDefault();
					claimed.push(event);
				}
			}
		});
		flushSync();

		expect(claimed).toHaveLength(1);
	});

	it('names itself for a screen reader even with the visible header off', () => {
		media = stubMediaQuery(WIDE);
		mounted = mount(ResponsiveModal, {
			target,
			props: { open: true, title: 'Add a node', headed: false, children: body }
		});
		flushSync();
		expect(document.body.textContent).toContain('Add a node');
	});
});
