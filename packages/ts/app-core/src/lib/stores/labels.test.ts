import { FACET_SLOT_COUNT, type OwnedRef } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { dimension, useFakeApi, type FakeApi } from './fake-api.test-support.js';
import { labels } from './labels.svelte.js';
import { prefs } from './prefs.svelte.js';

let api: FakeApi;

function serve(list: ReturnType<typeof dimension>[]) {
	api.on('GET /label-dimensions', () => list);
}

/** The path `SloppyClient` builds for one dimension. */
function route(ref: OwnedRef): string {
	return `/label-dimensions/${ref.split('/').map(encodeURIComponent).join('/')}`;
}

beforeEach(() => {
	labels.clear();
	prefs.set('lens', null);
	api = useFakeApi();
	serve([dimension(1, 'domain'), dimension(2, 'status'), dimension(3, 'type')]);
});

describe('the label dimensions', () => {
	it('issues one request when two surfaces ask at once', async () => {
		await Promise.all([labels.load(), labels.load()]);
		expect(api.countOf('GET /label-dimensions')).toBe(1);
	});

	it('assigns hue slots in declaration order', async () => {
		await labels.load();
		expect(labels.dimensions.map((d) => labels.slotFor(d.name))).toEqual([1, 2, 3]);
	});

	it('honours a pin before declaration order fills what is left', async () => {
		serve([
			dimension(1, 'domain'),
			dimension(2, 'status', { color_slot: 1 }),
			dimension(3, 'type')
		]);
		await labels.load();
		expect(labels.slotFor('status')).toBe(1);
		expect(labels.slotFor('domain')).toBe(2);
		expect(labels.slotFor('type')).toBe(3);
	});

	it('repeats slots past eight rather than inventing a ninth', async () => {
		serve(
			Array.from({ length: FACET_SLOT_COUNT + 2 }, (_, i) => dimension(i + 1, `dimension${i}`))
		);
		await labels.load();
		const assigned = labels.dimensions.map((d) => labels.slotFor(d.name));
		expect(assigned.slice(0, FACET_SLOT_COUNT)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(assigned.slice(FACET_SLOT_COUNT)).toEqual([1, 2]);
	});

	it('leaves nothing unassigned when every slot is pinned', async () => {
		serve([
			...Array.from({ length: FACET_SLOT_COUNT }, (_, i) =>
				dimension(i + 1, `pinned${i}`, { color_slot: i + 1 })
			),
			dimension(99, 'unpinned')
		]);
		await labels.load();
		expect(labels.slotFor('unpinned')).toBeGreaterThanOrEqual(1);
		expect(labels.slotFor('unpinned')).toBeLessThanOrEqual(FACET_SLOT_COUNT);
	});

	it('is not repopulated by a rename that lands after they were cleared', async () => {
		await labels.load();
		labels.setLens('status');
		const target = labels.byName('status')!.ref;
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on(`PATCH ${route(target)}`, async () => {
			await held;
			return dimension(2, 'state');
		});
		const renaming = labels.update(target, { name: 'state' });
		labels.clear();
		answer();
		await renaming;
		expect(labels.dimensions).toEqual([]);
		expect(prefs.current.lens).toBe('status');
	});

	it('is not repopulated by a dimension created just before it was cleared', async () => {
		let answer!: () => void;
		const held = new Promise<void>((resolve) => (answer = resolve));
		api.on('POST /label-dimensions', async () => {
			await held;
			return dimension(9, 'medium');
		});
		const creating = labels.create({ name: 'medium', values: [] });
		labels.clear();
		answer();
		await creating;
		expect(labels.byName('medium')).toBeUndefined();
	});
});

describe('the lens', () => {
	it('is none until the reader asks a question of the graph', async () => {
		await labels.load();
		expect(labels.lens).toBeNull();
	});

	it('resolves a saved lens to the dimension it names', async () => {
		await labels.load();
		labels.setLens('status');
		expect(labels.lens?.name).toBe('status');
	});

	it('reads as none when the saved dimension no longer exists', async () => {
		await labels.load();
		labels.setLens('status');
		serve([dimension(1, 'domain')]);
		await labels.reload();
		expect(labels.lens).toBeNull();
	});
});
