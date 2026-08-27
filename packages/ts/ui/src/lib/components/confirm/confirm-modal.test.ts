// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import { overlay } from '../overlay.svelte.js';
import ConfirmModal from './confirm-modal.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function open(props: Record<string, unknown> = {}) {
	stubMediaQuery(() => false);
	mounted = mount(ConfirmModal, {
		target,
		props: {
			open: true,
			title: 'Delete this note?',
			description: 'Its children are deleted with it.',
			confirmLabel: 'Delete',
			onconfirm: () => {},
			...props
		}
	});
	flushSync();
}

const button = (label: string) =>
	[...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

/** The surface declares an overlay for as long as it is up, and takes it back
 *  when it closes — a closed dialog's markup lingers while it animates out. */
const isUp = () => overlay.open;

/** The answer runs in a promise; let its continuation and the render after it
 *  both land before reading the surface. */
async function settle() {
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

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

describe('the confirmation surface', () => {
	it('asks in the words it was given', () => {
		open();
		expect(document.body.textContent).toContain('Delete this note?');
		expect(document.body.textContent).toContain('Its children are deleted with it.');
	});

	it('does nothing but close when the answer is no', () => {
		let asked = 0;
		open({ onconfirm: () => asked++ });
		button('Cancel')?.click();
		flushSync();
		expect(asked).toBe(0);
		expect(isUp()).toBe(false);
	});

	it('acts once and closes when the answer is yes', async () => {
		let asked = 0;
		open({ onconfirm: () => asked++ });
		button('Delete')?.click();
		await settle();
		expect(asked).toBe(1);
		expect(isUp()).toBe(false);
	});

	it('stays up when the act fails, so the same button tries again', async () => {
		let asked = 0;
		open({
			onconfirm: () => {
				asked++;
				return Promise.reject(new Error('nope'));
			}
		});
		button('Delete')?.click();
		await settle();
		expect(asked).toBe(1);
		expect(isUp()).toBe(true);
		expect(button('Delete')?.disabled).toBe(false);
	});

	it('says why it failed inside the question, not behind it', async () => {
		open({
			refused: 'Sloppy could not remove that dimension. Try again in a moment.',
			onconfirm: () => Promise.reject(new Error('nope'))
		});
		button('Delete')?.click();
		await settle();
		const dialog = document.body.querySelector('[role="dialog"]');
		expect(dialog?.textContent).toContain('Sloppy could not remove that dimension');
	});

	it('refuses a second answer while the first is still running', async () => {
		let asked = 0;
		let finish = () => {};
		open({
			onconfirm: () => {
				asked++;
				return new Promise<void>((done) => {
					finish = done;
				});
			}
		});
		button('Delete')?.click();
		flushSync();
		expect(button('Delete')?.disabled).toBe(true);
		expect(button('Cancel')?.disabled).toBe(true);
		finish();
		await settle();
		expect(asked).toBe(1);
		expect(isUp()).toBe(false);
	});
});
