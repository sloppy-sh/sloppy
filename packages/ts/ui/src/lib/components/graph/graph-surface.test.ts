// @vitest-environment jsdom
import type { GraphHandle, GraphMountOptions } from '@sloppy/graph';
import type { NodeView, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mounts: { host: HTMLElement; options: GraphMountOptions }[] = [];
const updates: GraphMountOptions[] = [];
const brought: OwnedRef[] = [];
let destroys = 0;

vi.mock('@sloppy/graph/layout-worker?worker', () => ({ default: class {} }));

vi.mock('@sloppy/graph', () => ({
	mountGraph: (host: HTMLElement, options: GraphMountOptions): GraphHandle => {
		mounts.push({ host, options });
		return {
			update: (next: GraphMountOptions) => updates.push(next),
			bringTo: (ref: OwnedRef) => brought.push(ref),
			destroy: () => {
				destroys += 1;
			}
		} as unknown as GraphHandle;
	}
}));

const Harness = (await import('./graph-surface-harness.test.svelte')).default;

const node = (address: string): NodeView =>
	({ ref: `did:syr:z6Mk/${address}` as OwnedRef, address, depth: 1 }) as NodeView;

type Drive = (next: { nodes?: NodeView[] }) => void;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;
let drive: Drive;
let held: GraphHandle | undefined;

function render(nodes: NodeView[] = [node('1')]) {
	mounted = mount(Harness, {
		target,
		props: {
			nodes,
			drive: (set: Drive) => {
				drive = set;
			},
			held: (handle: GraphHandle | undefined) => {
				held = handle;
			}
		}
	});
	flushSync();
}

beforeEach(() => {
	mounts.length = 0;
	updates.length = 0;
	brought.length = 0;
	held = undefined;
	destroys = 0;
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
});

describe('the graph surface', () => {
	it('mounts the renderer into an element of its own', () => {
		render();
		expect(mounts).toHaveLength(1);
		expect(target.contains(mounts[0].host)).toBe(true);
		expect(mounts[0].options.nodes).toHaveLength(1);
	});

	it('hands a changed prop to update, and never mounts a second scene', () => {
		render();
		drive({ nodes: [node('1'), node('1a')] });
		flushSync();

		expect(mounts).toHaveLength(1);
		expect(updates.at(-1)?.nodes).toHaveLength(2);
	});

	it('gives the renderer a way to run the layout off the main thread', () => {
		render();
		expect(mounts[0].options.createLayoutWorker).toBeTypeOf('function');
	});

	// Moving the viewport is what a host cannot say in a prop: opening the same
	// note twice has to bring the canvas to it twice.
	it('hands the host the renderer it mounted', () => {
		render();
		const ref = 'did:syr:z6Mk/01' as OwnedRef;

		held?.bringTo(ref);
		held?.bringTo(ref);

		expect(brought).toEqual([ref, ref]);
	});

	it('destroys the scene when it goes away', () => {
		render();
		unmount(mounted!, { outro: false });
		mounted = undefined;
		expect(destroys).toBe(1);
	});
});
