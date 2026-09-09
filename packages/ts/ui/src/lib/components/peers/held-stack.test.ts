// @vitest-environment jsdom
import type { BlockDocument, BlockView, DocumentNode, OwnedRef } from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver } from '../dom.test-support.js';
import HeldStack from './held-stack.svelte';

vi.mock('mermaid', () => ({
	default: {
		initialize: () => {},
		render: async (id: string) => ({ svg: `<svg data-drawn="${id}"><g></g></svg>` })
	}
}));

const ADA = 'did:syr:z6MkAdaAdaAdaAdaAdaAdaAdaAdaAdaAda';
const NOTE = `${ADA}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function section(...elements: DocumentNode[]): BlockDocument {
	return { type: 'doc', content: elements };
}

let ulid = 0;
function block(content: BlockDocument): BlockView {
	return {
		ref: `${ADA}/${(++ulid).toString(36).toUpperCase().padStart(26, '0')}` as OwnedRef,
		node: NOTE,
		created_by: ADA,
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		ord: `a${ulid}`,
		content
	} as BlockView;
}

async function settle(): Promise<void> {
	for (let at = 0; at < 4; at += 1) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

function show(blocks: BlockView[]): void {
	mounted = mount(HeldStack, {
		target,
		props: {
			author: ADA,
			blocks,
			pictures: { picture: async () => ({ src: '', release: () => {} }) },
			references: { read: async () => null, open: () => {} },
			emoji: async () => []
		}
	});
}

beforeEach(() => {
	stubResizeObserver();
	target = document.createElement('div');
	document.body.append(target);
});

afterEach(() => {
	if (mounted) unmount(mounted);
	mounted = undefined;
	document.body.innerHTML = '';
});

describe("somebody else's note", () => {
	it('draws the formula and the diagram they wrote', async () => {
		show([
			block(
				section(
					{ type: 'paragraph', content: [{ type: 'text', text: 'what it comes to' }] },
					{ type: 'mathBlock', attrs: { tex: 'a^2 + b^2 = c^2' } },
					{ type: 'diagram', attrs: { language: 'mermaid', source: 'graph TD; A-->B;' } }
				)
			)
		]);
		await settle();

		expect(target.textContent).toContain('what it comes to');
		expect(target.querySelector('.sloppy-math-drawn .katex')).not.toBeNull();
		expect(target.querySelector('.sloppy-diagram-drawn svg')).not.toBeNull();
	});

	it('offers nowhere to write over what they wrote', async () => {
		show([
			block(
				section(
					{ type: 'mathBlock', attrs: { tex: '\\pi' } },
					{ type: 'diagram', attrs: { language: 'mermaid', source: 'graph TD; A-->B;' } }
				)
			)
		]);
		await settle();

		expect(target.querySelector('.sloppy-math-source')).toBeNull();
		expect(target.querySelector('.sloppy-diagram-source')).toBeNull();
	});
});
