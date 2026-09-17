// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CopyButton from './copy-button.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function render(value: string, label?: string): HTMLButtonElement {
	mounted = mount(CopyButton, {
		target,
		props: { value, ...(label === undefined ? {} : { label }) }
	});
	flushSync();
	return target.querySelector('button') as HTMLButtonElement;
}

function clipboard(writeText: (value: string) => Promise<void>): void {
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		configurable: true,
		value: { writeText }
	});
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	vi.useRealTimers();
});

describe('handing somebody a line of text', () => {
	it('is called what the caller calls it', () => {
		clipboard(async () => {});

		expect(render('ssh-ed25519 AAAA', 'Copy the key').getAttribute('aria-label')).toBe(
			'Copy the key'
		);
	});

	it('copies the whole line and says so', async () => {
		const written: string[] = [];
		clipboard(async (value) => {
			written.push(value);
		});
		const button = render('ssh-ed25519 AAAA sloppy');

		button.click();
		await settle();

		expect(written).toEqual(['ssh-ed25519 AAAA sloppy']);
		expect(button.getAttribute('aria-label')).toBe('Copied');
	});

	it('says to select it where the clipboard is refused', async () => {
		clipboard(async () => {
			throw new Error('denied');
		});
		const button = render('ssh-ed25519 AAAA');

		button.click();
		await settle();

		expect(button.getAttribute('aria-label')).toBe('Select it to copy');
	});

	it('says to select it where there is no clipboard at all', async () => {
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			configurable: true,
			value: undefined
		});
		const button = render('ssh-ed25519 AAAA');

		button.click();
		await settle();

		expect(button.getAttribute('aria-label')).toBe('Select it to copy');
	});

	it('offers the copy again once the answer has stood a moment', async () => {
		vi.useFakeTimers();
		clipboard(async () => {});
		const button = render('ssh-ed25519 AAAA');

		button.click();
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(button.getAttribute('aria-label')).toBe('Copied');

		await vi.advanceTimersByTimeAsync(3000);
		flushSync();

		expect(button.getAttribute('aria-label')).toBe('Copy');
	});
});
