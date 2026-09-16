// A stand-in server for the store suites. The stores reach it through the real
// `SloppyClient`, so a test that passes has exercised the wire shapes too — and
// counting fetches here is what makes "one request" a measurement rather than a
// claim.

import {
	addressDepth,
	type AmendmentView,
	type AnsweredNote,
	type ArchivePreview,
	type ImportConflict,
	type BlockView,
	type Converses,
	type CreateNodeRequest,
	type GraphView,
	graphOf,
	type MoveNoteRequest,
	type NodeView,
	type NoteDestination,
	type OwnedRef,
	type ProposeAmendmentRequest,
	type PulledNoteHit,
	type RefusedVoiceView,
	type RefuseVoiceRequest,
	type SearchHit,
	type SetAddressRequest,
	UpdateBlockRequestSchema,
	type Viewer
} from '@sloppy/types';
import { resetApi } from '../api.js';
import { graphs } from './graphs.svelte.js';
import { initRuntime } from '../runtime.js';

export const DID = 'did:syr:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(seed: number): string {
	let n = seed;
	let out = '';
	do {
		out = CROCKFORD[n % 32] + out;
		n = Math.floor(n / 32);
	} while (n > 0);
	return out.padStart(26, '0');
}

export function ref(seed: number, did = DID): OwnedRef {
	return `${did}/${ulid(seed)}`;
}

export const AT = '2026-01-01T00:00:00.000Z';

/** The graph an identity started with, in these fixtures. Every home graph's
 *  ulid is its own, so a suite spells one rather than deriving it. */
export const HOME_ULID = '01ARZ3NDEKTSV4RRFFQ69G5HMM';
export const homeOf = (did: string): OwnedRef => `${did}/${HOME_ULID}`;
export const HOME: OwnedRef = homeOf(DID);

/** The listing every suite gets unless it answers `GET /graphs` itself: one
 *  graph, the one they started with. */
export function homeListing(): GraphView[] {
	return [
		{ ref: HOME, created_by: DID, title: 'My graph', home: true, created_at: AT, updated_at: AT }
	];
}

export function node(seed: number, address: string, over: Partial<NodeView> = {}): NodeView {
	const self = ref(seed);
	return {
		ref: self,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		graph: homeOf(over.created_by ?? DID),
		address,
		depth: addressDepth(address),
		origin: self,
		title: '',
		tags: [],
		links: [],
		published: false,
		...over
	};
}

/** A note its author gave no address — one like any other, read by its title. */
export function unnumbered(seed: number, over: Partial<NodeView> = {}): NodeView {
	const written = node(seed, '1', { depth: 1, ...over });
	delete written.address;
	return written;
}

/** One note as a search answers with it. An empty `snippet` is a note whose
 *  title carried the words rather than its writing. */
export function hit(note: NodeView, over: Partial<SearchHit> = {}): SearchHit {
	return {
		note: note.ref,
		...(note.address === undefined ? {} : { address: note.address }),
		graph: graphOf(note),
		title: note.title,
		snippet: '',
		held: false,
		...over
	};
}

/** Answer the two routes a find surface asks: what carries a word, and what was
 *  written into last. */
export function finding(
	api: FakeApi,
	held: { hits?: readonly SearchHit[]; recent?: readonly NodeView[] } = {}
): void {
	api.on('GET /nodes/search', () => held.hits ?? []);
	api.on('GET /nodes/recent', () => held.recent ?? []);
}

/** Answer the routes the conversation surfaces ask about the signed-in person:
 *  whether their own store can hold one, whose answers they refuse, and which of
 *  their notes have been answered. */
export function conversing(
	api: FakeApi,
	held: {
		converses?: Converses;
		refused?: readonly RefusedVoiceView[];
		answered?: readonly AnsweredNote[];
	} = {}
): void {
	let written = 0;
	api.on('GET /converses', () => held.converses ?? { comments: true, reactions: true });
	api.on('GET /refused-voices', () => held.refused ?? []);
	api.on('GET /answered-notes', () => held.answered ?? []);
	api.on('POST /refused-voices', (_url, init) => {
		const asked = JSON.parse(String(init?.body ?? '{}')) as RefuseVoiceRequest;
		written += 1;
		return {
			ref: ref(9_000 + written),
			created_by: DID,
			voice: asked.voice,
			...(asked.note === undefined ? {} : { note: asked.note }),
			created_at: AT,
			updated_at: AT
		} satisfies RefusedVoiceView;
	});
	api.on('DELETE /refused-voices', () => undefined);
}

/** A note's `<did>/<ulid>` as a route's two path segments. */
function refPath(ref: OwnedRef): string {
	const cut = ref.lastIndexOf('/');
	return `/${encodeURIComponent(ref.slice(0, cut))}/${encodeURIComponent(ref.slice(cut + 1))}`;
}

/** Answer the citation route for each note the reader holds a copy of. */
export function holding(api: FakeApi, hits: readonly PulledNoteHit[] = []): void {
	for (const hit of hits) {
		api.on(`GET /pulls/nodes${refPath(hit.note.ref)}`, () => hit);
	}
}

/**
 * Answer a move of `note` with the subtree as it stands afterwards — the note
 * and everything under it, at the addresses the move gave them. `address` is
 * the one the person named for it, absent where they left it to the rule.
 */
export function moving(
	api: FakeApi,
	note: OwnedRef,
	subtree: (to: NoteDestination, address?: string) => readonly NodeView[]
): void {
	api.on(`POST /nodes${refPath(note)}/move`, (_url, init) => {
		const asked = JSON.parse(String(init?.body ?? '{}')) as MoveNoteRequest;
		return subtree(asked.to, asked.address);
	});
}

/**
 * Answer a write of `note`'s address with the note as it stands afterwards. A
 * `null` address takes it off, which is what the store sends when somebody
 * clears the field.
 */
export function numbering(
	api: FakeApi,
	note: OwnedRef,
	answer: (address: string | null) => NodeView
): void {
	api.on(`PUT /nodes${refPath(note)}/address`, (_url, init) => {
		const asked = JSON.parse(String(init?.body ?? '{}')) as SetAddressRequest;
		return answer(asked.address);
	});
}

/** Answer a creation with the note it wrote, the placement it was asked for in
 *  hand — `free` among them, which writes a note with no address. */
export function writing(api: FakeApi, answer: (request: CreateNodeRequest) => NodeView): void {
	api.on('POST /nodes', (_url, init) =>
		answer(JSON.parse(String(init?.body ?? '{}')) as CreateNodeRequest)
	);
}

/**
 * Answer how a note's sections are read and arranged, over stacks held here: a
 * listing, a section moved within its note, and one carried into another note.
 * The stacks are handed back, so a suite reads what the writes left rather than
 * what they said. Every note a write can reach needs a stack, empty or not.
 *
 * A stack a write touches is renumbered end to end instead of the moved row
 * being placed between its neighbours — nothing here reads an `ord` but the
 * order it puts a stack in.
 */
export function arranging(
	api: FakeApi,
	stacks: Record<OwnedRef, readonly BlockView[]>
): Map<OwnedRef, BlockView[]> {
	const held = new Map<OwnedRef, BlockView[]>(
		Object.entries(stacks).map(([note, stack]) => [note as OwnedRef, [...stack]])
	);
	let writes = 0;

	const write = (section: OwnedRef, body: string): unknown => {
		const asked = UpdateBlockRequestSchema.safeParse(JSON.parse(body));
		if (!asked.success) return refuses('That is not a write of a section.', 400);
		const was = [...held].find(([, stack]) => stack.some((one) => one.ref === section))?.[0];
		const stack = was === undefined ? undefined : held.get(was);
		const row = stack?.find((one) => one.ref === section);
		if (was === undefined || !stack || !row) return refuses('That section is not here.', 404);
		if (asked.data.expects !== undefined && asked.data.expects !== row.updated_at) {
			return refuses('This section was written somewhere else.', 409);
		}
		const note = asked.data.node ?? was;
		if (!held.has(note)) return refuses('That note is not here.', 404);

		const rest = (held.get(note) as BlockView[]).filter((one) => one.ref !== section);
		let at: number;
		if (asked.data.after === undefined && note === was) at = stack.indexOf(row);
		else if (!asked.data.after) at = 0;
		else {
			at = rest.findIndex((one) => one.ref === asked.data.after) + 1;
			if (at === 0) return refuses('That section is not in this note.', 400);
		}

		writes += 1;
		const written: BlockView = {
			...row,
			node: note,
			...(asked.data.content === undefined ? {} : { content: asked.data.content }),
			updated_at: new Date(Date.parse(AT) + writes * 1000).toISOString()
		};
		held.set(
			was,
			(held.get(was) as BlockView[]).filter((one) => one.ref !== section)
		);
		const landed = [...rest.slice(0, at), written, ...rest.slice(at)].map((one, i) => ({
			...one,
			ord: String(i).padStart(3, '0')
		}));
		held.set(note, landed);
		return landed[at];
	};

	for (const note of held.keys()) {
		api.on(`GET /nodes${refPath(note)}/blocks`, () => held.get(note));
	}
	for (const stack of Object.values(stacks)) {
		for (const one of stack) {
			api.on(`PATCH /blocks${refPath(one.ref)}`, (_url, init) =>
				write(one.ref, String(init?.body ?? '{}'))
			);
		}
	}
	return held;
}

/** One offered change, as the routes below answer it. */
export function amendment(
	seed: number,
	note: OwnedRef,
	by: string,
	over: Partial<AmendmentView> = {}
): AmendmentView {
	return {
		ref: ref(seed),
		created_by: DID,
		note,
		by,
		at: AT,
		title: '',
		tags: [],
		blocks: [],
		created_at: AT,
		updated_at: AT,
		...over
	};
}

/**
 * Answer the routes an offered change is read and settled through, over the
 * offers held here. The offers are handed back, so a suite reads what the
 * writes left rather than what they said.
 */
export function amending(
	api: FakeApi,
	offers: Record<OwnedRef, readonly AmendmentView[]>,
	approved: (offer: AmendmentView) => NodeView | Response
): Map<OwnedRef, AmendmentView[]> {
	const held = new Map<OwnedRef, AmendmentView[]>(
		Object.entries(offers).map(([note, standing]) => [note as OwnedRef, [...standing]])
	);
	const find = (self: OwnedRef): AmendmentView | undefined =>
		[...held.values()].flat().find((one) => one.ref === self);
	const drop = (self: OwnedRef): void => {
		for (const [note, standing] of held) {
			held.set(
				note,
				standing.filter((one) => one.ref !== self)
			);
		}
	};

	for (const note of held.keys()) {
		api.on(`GET /nodes${refPath(note)}/amendments`, () => held.get(note));
	}
	api.on('POST /amendments', (_url, init) => {
		const asked = JSON.parse(String(init?.body ?? '{}')) as ProposeAmendmentRequest;
		const standing = held.get(asked.note as OwnedRef);
		if (!standing) return refuses('That note is not here.', 404);
		const written = amendment(9_500 + standing.length, asked.note as OwnedRef, DID, {
			title: asked.title ?? '',
			tags: [...(asked.tags ?? [])],
			...(asked.message === undefined ? {} : { message: asked.message })
		});
		standing.push(written);
		return written;
	});
	for (const offer of [...held.values()].flat()) {
		api.on(`DELETE /amendments${refPath(offer.ref)}`, () => {
			drop(offer.ref);
			return undefined;
		});
		api.on(`POST /amendments${refPath(offer.ref)}/approve`, () => {
			const standing = find(offer.ref);
			if (!standing) return refuses('That offer is not here.', 404);
			const note = approved(standing);
			if (!(note instanceof Response)) drop(offer.ref);
			return note;
		});
		api.on(`POST /amendments${refPath(offer.ref)}/decline`, () => {
			drop(offer.ref);
			return undefined;
		});
	}
	return held;
}

export const VIEWER: Viewer = {
	did: DID,
	syr_instance_url: 'https://syr.test',
	delegate_public_key: 'z6MkTestDelegateKey'
};

/** Async so a suite can hold an answer open and let something else happen. */
export type Route = (url: URL, init: RequestInit | undefined) => unknown;

export class FakeApi {
	/** Every request, as `"<METHOD> <path><query>"`, in order. */
	readonly calls: string[] = [];
	#routes = new Map<string, Route>();

	/** `key` is `"<METHOD> <path>"`; a query string is the caller's business. */
	on(key: string, route: Route): this {
		this.#routes.set(key, route);
		return this;
	}

	countOf(key: string): number {
		return this.calls.filter((c) => c === key || c.startsWith(`${key}?`)).length;
	}

	readonly fetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input), 'http://api.test');
		const method = (init?.method ?? 'GET').toUpperCase();
		const path = url.pathname.replace(/^\/api/, '');
		this.calls.push(`${method} ${path}${url.search}`);
		const route = this.#routes.get(`${method} ${path}`);
		if (!route)
			return new Response('{"message":"Nothing lives at that address."}', { status: 404 });
		const body = await route(url, init);
		// A route that answers with a Response is refusing in the server's own
		// words, which is the only way a suite can exercise what a person is told.
		if (body instanceof Response) return body;
		return new Response(body === undefined ? '' : JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	};
}

/** Point the app at a fresh fake and hand it back. A seam a suite borrowed —
 *  the way it saves a file — goes back to its default. */
export function useFakeApi(): FakeApi {
	const fake = new FakeApi();
	initRuntime({
		apiHost: () => 'http://api.test',
		fetchImpl: () => fake.fetch,
		saveFile: undefined
	});
	fake.on('GET /graphs', () => homeListing());
	// A fresh fake is a fresh session, and which graphs somebody keeps is one of
	// the things a session holds.
	graphs.clear();
	resetApi();
	return fake;
}

/**
 * A preview of an archive that is a copy of a graph the reader already keeps:
 * the two are settled note by note, and `conflicts` is what a person is asked
 * about first — docs/ARCHITECTURE.md § "A graph on disk".
 */
export function mergePreview(
	graph: string,
	conflicts: ImportConflict[],
	over: Partial<ArchivePreview> = {}
): ArchivePreview {
	return {
		format: 1,
		graph,
		name: 'Thesis',
		owner: 'did:syr:z6MkAda' as ArchivePreview['owner'],
		notes: 1,
		pictures: 0,
		missing_emoji: [],
		collisions: [],
		replaces: true,
		replacing: 1,
		merges: true,
		conflicts,
		...over
	};
}

/** A refusal in the server's own words, which is the only way a suite can
 *  exercise what a person is told. */
export function refuses(says: string, status = 400): Response {
	return new Response(JSON.stringify({ message: says }), { status });
}

/** How a suite answers for a graph as a file: the archive each graph is taken
 *  out as, and what an arriving one holds. */
export interface FakeArchive {
	exported?: Record<OwnedRef, () => { body: BodyInit; filename: string } | Response>;
	preview?: () => ArchivePreview | Response;
	imported?: () => GraphView | Response;
}

/**
 * Answer the routes a graph goes out and comes back through. Which of the two
 * an arriving archive asks for is the client's own dispatch on the query, so a
 * suite that passes has exercised the one the surface meant.
 */
export function archiving(api: FakeApi, answers: FakeArchive): void {
	for (const [graph, taken] of Object.entries(answers.exported ?? {})) {
		api.on(`GET /graphs${refPath(graph as OwnedRef)}/archive`, () => {
			const answer = taken();
			return answer instanceof Response
				? answer
				: new Response(answer.body, {
						status: 200,
						headers: {
							'content-type': 'application/zip',
							'content-disposition': `attachment; filename="${answer.filename}"`
						}
					});
		});
	}
	api.on('POST /graphs/import', (url) =>
		url.searchParams.has('preview')
			? (answers.preview?.() ?? refuses('No suite answers for a preview.', 500))
			: (answers.imported?.() ?? refuses('No suite answers for an import.', 500))
	);
}
