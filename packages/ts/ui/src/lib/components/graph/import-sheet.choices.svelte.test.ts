// @vitest-environment jsdom
import type { ArchivePreview, ImportConflict, ImportSettlement } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import ImportSheet from './import-sheet.svelte';

const DID = 'did:syr:z6MkTestTestTestTestTestTestTestTestTestTestTest';
const NOTE = `${DID}/01JRZ0000000000000000000AB`;

function preview(over: Partial<ArchivePreview> = {}): ArchivePreview {
	return {
		name: 'Cell biology',
		notes: 3,
		pictures: 0,
		missing_emoji: [],
		collisions: [],
		replaces: true,
		replacing: 9,
		merges: true,
		conflicts: [],
		...over
	} as ArchivePreview;
}

const wrote: ImportConflict = {
	kind: 'note',
	ref: NOTE,
	sections: [],
	mine: 'Osmosis, as I left it',
	theirs: 'Osmosis, as the file has it'
};

const settle = async (): Promise<void> => {
	flushSync();
	await new Promise((done) => setTimeout(done, 0));
	flushSync();
};

const button = (name: string): HTMLButtonElement => {
	const found = [...document.body.querySelectorAll('button')].find(
		(one) => one.textContent?.trim() === name
	);
	if (!found) throw new Error(`No button reads "${name}"`);
	return found;
};

describe('choices made against one file', () => {
	let mounted: ReturnType<typeof mount> | undefined;
	beforeEach(() => {
		stubMediaQuery((query) => query.includes('min-width'));
		stubResizeObserver();
	});
	afterEach(() => {
		if (mounted) unmount(mounted, { outro: false });
		mounted = undefined;
		document.body.innerHTML = '';
	});

	it('do not reach the next file, which has nothing to settle', async () => {
		const sent: ImportSettlement[] = [];
		const props = $state({
			open: true,
			preview: preview({ conflicts: [wrote] }) as ArchivePreview | null,
			onimport: (settlement?: ImportSettlement) => {
				sent.push(settlement ?? { resolutions: [] });
			},
			oncancel: () => {}
		});
		const target = document.createElement('div');
		document.body.appendChild(target);
		mounted = mount(ImportSheet, { target, props });
		await settle();

		button('Keep what is here').click();
		await settle();
		button('Import').click();
		await settle();
		expect(sent[0]?.resolutions).toHaveLength(1);

		props.preview = preview({ conflicts: [] });
		await settle();
		button('Import').click();
		await settle();
		expect(sent[1]?.resolutions ?? []).toEqual([]);
	});
});
