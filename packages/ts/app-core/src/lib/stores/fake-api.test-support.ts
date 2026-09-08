// A stand-in server for the store suites. The stores reach it through the real
// `SloppyClient`, so a test that passes has exercised the wire shapes too — and
// counting fetches here is what makes "one request" a measurement rather than a
// claim.

import {
	addressDepth,
	type AnsweredNote,
	type Converses,
	type CreateNodeRequest,
	graphOf,
	type MoveNoteRequest,
	type NodeView,
	type NoteDestination,
	type OwnedRef,
	type PulledNoteHit,
	type RefusedVoiceView,
	type RefuseVoiceRequest,
	type SearchHit,
	type SetAddressRequest,
	type Viewer
} from '@sloppy/types';
import { resetApi } from '../api.js';
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

export function node(seed: number, address: string, over: Partial<NodeView> = {}): NodeView {
	const self = ref(seed);
	return {
		ref: self,
		created_by: DID,
		created_at: AT,
		updated_at: AT,
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

/** Point the app at a fresh fake and hand it back. */
export function useFakeApi(): FakeApi {
	const fake = new FakeApi();
	initRuntime({ apiHost: () => 'http://api.test', fetchImpl: () => fake.fetch });
	resetApi();
	return fake;
}
