// A stand-in server for the store suites. The stores reach it through the real
// `SloppyClient`, so a test that passes has exercised the wire shapes too — and
// counting fetches here is what makes "one request" a measurement rather than a
// claim.

import {
	addressDepth,
	type LabelDimensionView,
	type NodeView,
	type OwnedRef,
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
		labels: {},
		links: [],
		published: false,
		...over
	};
}

export function dimension(
	seed: number,
	name: string,
	over: Partial<LabelDimensionView> = {}
): LabelDimensionView {
	return {
		ref: ref(seed),
		created_by: DID,
		created_at: AT,
		updated_at: AT,
		name,
		values: [],
		...over
	};
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
