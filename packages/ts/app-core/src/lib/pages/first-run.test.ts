import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime, type VaultAccess } from '../runtime.js';
import FirstRun from './first-run.svelte';

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let opened: string[];

async function settle(): Promise<void> {
	for (let turn = 0; turn < 6; turn += 1) await new Promise((done) => setTimeout(done, 0));
	flushSync();
}

function show(): void {
	mounted = mount(FirstRun, { target, props: { onopened: (folder) => opened.push(folder) } });
	flushSync();
}

function button(): HTMLButtonElement {
	const one = target.querySelector('button');
	if (!one) throw new Error('No offer on the page');
	return one;
}

/** A shell that keeps graphs in folders, answering `open` with `folder`. */
function shell(vault: Partial<VaultAccess>): void {
	initRuntime({
		apiHost: () => '',
		mode: () => 'local',
		vault: { folder: () => undefined, asks: true, open: async () => undefined, ...vault }
	});
}

beforeEach(() => {
	opened = [];
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	target.remove();
	initRuntime({ apiHost: () => '', mode: () => 'hosted', vault: undefined });
});

describe('the first run of a graph on this device', () => {
	it('puts nothing in the way but the offer of a folder', () => {
		shell({});
		show();

		expect(button().textContent?.trim()).toBe('Choose a folder');
		// Nothing to fill in and nowhere else to go: one offer, and it is this.
		expect(target.querySelectorAll('button')).toHaveLength(1);
		expect(target.querySelector('input')).toBeNull();
	});

	it('says where the graph will be on a device that keeps them in one place', () => {
		shell({ asks: false });
		show();

		expect(button().textContent?.trim()).toBe('Start writing');
		// The folder is this app's own there: nobody can move it or back it up
		// beside their other folders, so nothing says they can.
		expect(target.textContent).not.toContain('move it');
		expect(target.textContent).toContain('Nothing here leaves the device');
	});

	it('says the folder is theirs where they chose it', () => {
		shell({ asks: true });
		show();

		expect(target.textContent).toContain('move it or back it up');
	});

	it('hands the folder somebody names to the shell', async () => {
		const open = vi.fn(async () => '/Users/me/garden');
		shell({ open });
		show();

		button().click();
		await settle();

		expect(open).toHaveBeenCalledOnce();
		expect(opened).toEqual(['/Users/me/garden']);
	});

	it('stays where it is for somebody who names none', async () => {
		shell({ open: async () => undefined });
		show();

		button().click();
		await settle();

		expect(opened).toEqual([]);
		expect(button().disabled).toBe(false);
	});

	it('says what to do next when a folder cannot be written in', async () => {
		shell({
			open: async () => {
				throw new Error('EACCES');
			}
		});
		show();

		button().click();
		await settle();

		const said = target.querySelector('[role="alert"]');
		expect(said?.textContent).toContain('Try another one');
		expect(said?.textContent).not.toContain('EACCES');
		expect(opened).toEqual([]);
	});
});
