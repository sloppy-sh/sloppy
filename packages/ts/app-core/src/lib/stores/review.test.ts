// What the code has left behind, asked of a graph in a project — DESIGN.md
// § "What the code left behind".

import 'fake-indexeddb/auto';
import { MemoryFiles, MemoryHistory } from '@sloppy/local';
import {
	type BlockDocument,
	compassNode,
	type BlockView,
	type CreateBlockRequest,
	type NodeView,
	type OwnedRef,
	type UpdateNodeRequest
} from '@sloppy/types';
import { NOTE_TEMPLATES, writeTemplate } from '@sloppy/ui';
import { digestOf } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initRuntime } from '../runtime.js';
import { nodes } from './nodes.svelte.js';
import { review } from './review.svelte.js';
import { session } from './session.svelte.js';
import {
	AT,
	DID,
	homeOf,
	node,
	ref,
	useFakeApi,
	VIEWER,
	type FakeApi
} from './fake-api.test-support.js';

const HOME = homeOf(DID);
const PROJECT = '/home/ada/garden';

const PARSER = ref(1);
const DECISION = ref(2);
const LOOSE = ref(3);

function refPath(of: OwnedRef): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}
const path = (of: OwnedRef) => `/nodes${refPath(of)}`;

let seeded = 100;
function section(of: OwnedRef, content: BlockDocument): BlockView {
	seeded += 1;
	return {
		ref: ref(seeded),
		node: of,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		ord: 'a0',
		content
	} as unknown as BlockView;
}

function anchor(of: OwnedRef, at: string): BlockView {
	return section(of, {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: [
					{ type: 'text', marks: [{ type: 'link', attrs: { href: `code:${at}` } }], text: at }
				]
			}
		]
	});
}

/** A note holding a compass with one slot filled, which is the Decision shape's
 *  half; `why` is what stands under its "Why". */
function decision(of: OwnedRef, why: string): BlockView[] {
	return [
		section(of, {
			type: 'doc',
			content: [compassNode({ north: [PARSER], south: [], east: [], west: [] })]
		}),
		section(of, {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why' }] },
				why === ''
					? { type: 'paragraph' }
					: { type: 'paragraph', content: [{ type: 'text', text: why }] }
			]
		})
	];
}

let api: FakeApi;
let files: MemoryFiles;
let kept: MemoryHistory;
let store: Map<string, Uint8Array>;
let written: UpdateNodeRequest[];
let blocks: CreateBlockRequest[];

const said = (text: string) => new TextEncoder().encode(text);

/** Puts a file in the project and keeps a version of the folder. */
async function keepFile(at: string, text: string): Promise<string> {
	await files.write(at, said(text));
	await kept.commit(`Wrote ${at}`);
	return (await kept.currentCommit()) as string;
}

/** The three notes of the fixture, with `PARSER` read against `checked`. */
function graphOf(checked?: string): NodeView[] {
	return [
		node(1, '1', { title: 'The parser', ...(checked === undefined ? {} : { checked }) }),
		node(2, '1a', { title: 'Two ways round it', origin: PARSER, parent: PARSER }),
		node(3, '2', { title: 'Loose ends' })
	];
}

/** Answers every route the question reads: the notes, and each one's sections. */
function stacks(held: Record<OwnedRef, BlockView[]>): void {
	for (const [note, stack] of Object.entries(held)) {
		api.on(`GET ${path(note as OwnedRef)}/blocks`, () => stack);
	}
}

beforeEach(async () => {
	nodes.clear();
	review.clear();
	written = [];
	blocks = [];
	store = new Map();
	files = new MemoryFiles({ root: PROJECT, store, data: '/data' });
	kept = new MemoryHistory(new MemoryFiles({ root: PROJECT, store, data: '/data' }), {
		author: 'Ada'
	});
	api = useFakeApi();
	session.adopt(VIEWER, 'a-session');
	initRuntime({
		apiHost: () => 'http://api.test',
		project: async () => files,
		history: () => kept
	});
	api.on('PATCH /nodes', () => undefined);
});

afterEach(() => {
	review.clear();
	nodes.clear();
	session.clear();
	initRuntime({ apiHost: () => '', project: undefined, history: () => undefined });
});

// The Decision shape and the two signals about it are written in different
// packages and meet only at the heading and the compass element. A note
// somebody has just started from that shape is where they have to agree.
describe('a note started from the Decision shape', () => {
	it('asks for its why and for every slot nobody has cited into', async () => {
		const shape = NOTE_TEMPLATES.find((one) => one.id === 'decision');
		if (!shape) throw new Error('No Decision shape to start from.');
		const stack: BlockView[] = [];
		await writeTemplate(shape, { node: DECISION }, async ({ content }) => {
			const block = section(DECISION, { type: 'doc', content: content?.content ?? [] });
			stack.push(block);
			return block;
		});

		const held = graphOf();
		api.on('GET /nodes', () => held.filter((one) => one.ref === one.origin));
		stacks({ [PARSER]: [], [DECISION]: stack, [LOOSE]: [] });
		await nodes.load({ graph: HOME });
		await review.ask(HOME, held, files);

		expect(review.under('compass-gap').map((one) => one.direction)).toEqual([
			'north',
			'south',
			'east',
			'west'
		]);
		expect(review.under('decision-without-why').map((one) => one.note)).toEqual([DECISION]);
	});
});

describe('asking what the code left behind', () => {
	async function ask(checked?: string): Promise<void> {
		const held = graphOf(checked);
		api.on('GET /nodes', () => held.filter((one) => one.ref === one.origin));
		stacks({
			[PARSER]: [anchor(PARSER, 'src/parser.ts')],
			[DECISION]: decision(DECISION, ''),
			[LOOSE]: []
		});
		await nodes.load({ graph: HOME });
		await review.ask(HOME, held, files);
	}

	beforeEach(async () => {
		await keepFile('src/parser.ts', 'export const one = 1;\n');
		await keepFile('docs/guide.md', '# Guide\n');
		await keepFile('packages/ui/package.json', '{}\n');
	});

	it('says which code moved under a note that was read at a version', async () => {
		const at = (await kept.currentCommit()) as string;
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		await ask(at);

		expect(review.signals).toContainEqual({
			kind: 'anchor-changed',
			note: PARSER,
			path: 'src/parser.ts'
		});
	});

	it('says nothing about a note nobody has read against a version', async () => {
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		await ask();

		expect(review.signals.some((one) => one.kind === 'anchor-changed')).toBe(false);
	});

	it('names the places in the code no note reaches, and not the ones it does', async () => {
		await ask();

		const left = review
			.under('code-without-note')
			.map((one) => one.path)
			.sort();
		expect(left).toEqual(['docs', 'packages', 'packages/ui']);
	});

	it('names the slots a note left empty and the why it has not written', async () => {
		await ask();

		expect(review.under('compass-gap').map((one) => one.direction)).toEqual([
			'south',
			'east',
			'west'
		]);
		expect(review.under('decision-without-why').map((one) => one.note)).toEqual([DECISION]);
	});

	it('asks the first of them straight away, and lights the notes it names', async () => {
		await ask();

		expect(review.chosen).toBe('code-without-note');
		// A signal about the project names no note, so nothing on the canvas is
		// asked about it.
		expect(review.lit).toBeUndefined();

		review.choose('compass-gap');
		expect([...(review.lit ?? [])]).toEqual([DECISION]);
	});

	it('stops asking when the chosen one is chosen again', async () => {
		await ask();
		review.choose('compass-gap');
		review.choose('compass-gap');

		expect(review.chosen).toBeNull();
		expect(review.lit).toBeUndefined();
	});

	it('reads only the notes of the graph it was asked about', async () => {
		const elsewhere = node(9, '1', { created_by: 'did:syr:z6MkBram' });
		const held = graphOf();
		api.on('GET /nodes', () => held.filter((one) => one.ref === one.origin));
		stacks({
			[PARSER]: [anchor(PARSER, 'src/parser.ts')],
			[DECISION]: decision(DECISION, ''),
			[LOOSE]: []
		});
		await review.ask(HOME, [...held, elsewhere], files);

		expect(api.countOf(`GET ${path(elsewhere.ref)}/blocks`)).toBe(0);
		expect(review.signals.some((one) => one.note === elsewhere.ref)).toBe(false);
	});

	it('answers nothing at all where a note could not be read', async () => {
		const held = graphOf();
		api.on('GET /nodes', () => held.filter((one) => one.ref === one.origin));
		stacks({ [PARSER]: [anchor(PARSER, 'src/parser.ts')], [LOOSE]: [] });
		api.on(`GET ${path(DECISION)}/blocks`, () => new Response('no', { status: 500 }));
		await review.ask(HOME, held, files);

		expect(review.signals).toEqual([]);
		expect(review.trouble).not.toBeNull();
	});

	it('has nothing to say about a graph whose notes hold the lot', async () => {
		const held = [node(1, '1', { title: 'The parser' })];
		api.on('GET /nodes', () => held);
		stacks({
			[PARSER]: [
				anchor(PARSER, 'src/parser.ts'),
				anchor(PARSER, 'docs/guide.md'),
				anchor(PARSER, 'packages/ui/package.json')
			]
		});
		await review.ask(HOME, held, files);

		expect(review.signals).toEqual([]);
		expect(review.kinds).toEqual([]);
		expect(review.chosen).toBeNull();
	});

	it('lets go of an answer about another graph', async () => {
		await ask();
		review.forget(homeOf('did:syr:z6MkBram'));

		expect(review.signals).toEqual([]);
		expect(review.graph).toBeNull();
	});
});

describe('acting on what was left behind', () => {
	async function asked(): Promise<void> {
		const at = (await kept.currentCommit()) as string;
		await keepFile('src/parser.ts', 'export const one = 2;\n');
		const held = graphOf(at);
		api.on('GET /nodes', () => held.filter((one) => one.ref === one.origin));
		api.on(`PATCH ${path(PARSER)}`, (_url, init) => {
			const request = JSON.parse(String(init?.body)) as UpdateNodeRequest;
			written.push(request);
			return { ...held[0], ...request };
		});
		stacks({
			[PARSER]: [anchor(PARSER, 'src/parser.ts')],
			[DECISION]: decision(DECISION, 'Because.'),
			[LOOSE]: []
		});
		await nodes.load({ graph: HOME });
		await review.ask(HOME, held, files);
	}

	beforeEach(async () => {
		await keepFile('src/parser.ts', 'export const one = 1;\n');
		await keepFile('docs/guide.md', '# Guide\n');
	});

	it('records what every file it points at says now, and the version too', async () => {
		await asked();
		expect(review.under('anchor-changed')).toHaveLength(1);

		await review.stillTrue(PARSER);

		expect(written).toEqual([
			{
				read_against: [
					{ path: 'src/parser.ts', digest: await digestOf(said('export const one = 2;\n')) }
				],
				checked: await kept.currentCommit()
			}
		]);
		expect(review.under('anchor-changed')).toEqual([]);
		expect(review.acting).toBeNull();
		// The last of its kind settled, so the question moves on rather than
		// leaving somebody looking at a list that is not there.
		expect(review.chosen).toBe('code-without-note');
	});

	it('says what to do where the reading could not be recorded', async () => {
		await asked();
		api.on(`PATCH ${path(PARSER)}`, () => new Response('no', { status: 500 }));

		await review.stillTrue(PARSER);

		expect(review.trouble).not.toBeNull();
		expect(review.under('anchor-changed')).toHaveLength(1);
	});

	it('starts a walkthrough under the graph’s own first branch, anchored at the path', async () => {
		await asked();
		const fresh = node(7, '1a1', { title: 'docs', origin: PARSER, parent: PARSER });
		api.on('POST /nodes', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as { title: string; from?: unknown };
			expect(request.title).toBe('docs');
			expect(request.from).toEqual({ relation: 'under', note: PARSER });
			return fresh;
		});
		api.on('POST /blocks', (_url, init) => {
			const request = JSON.parse(String(init?.body)) as CreateBlockRequest;
			blocks.push(request);
			return section(fresh.ref, asWritten(request));
		});

		const started = await review.writeAbout('docs');

		expect(started).toBe(fresh.ref);
		expect(JSON.stringify(blocks[0].content)).toContain('code:docs');
		expect(blocks.slice(1).map((one) => headingOf(asWritten(one)))).toEqual([
			'Start here',
			'The path it takes',
			'Where it can go wrong'
		]);
		expect(review.under('code-without-note').map((one) => one.path)).not.toContain('docs');
	});

	it('says what to do where the note could not be started', async () => {
		await asked();
		api.on('POST /nodes', () => new Response('no', { status: 500 }));

		expect(await review.writeAbout('docs')).toBeNull();
		expect(review.trouble).not.toBeNull();
		expect(review.under('code-without-note').map((one) => one.path)).toContain('docs');
	});
});

/** What a write asked to be written, which a section always carries. */
function asWritten(request: CreateBlockRequest): BlockDocument {
	return (request.content ?? { type: 'doc', content: [] }) as BlockDocument;
}

function headingOf(content: BlockDocument): string {
	const opener = (content.content ?? [])[0];
	return (opener?.content ?? []).map((held) => held.text ?? '').join('');
}
