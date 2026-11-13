/**
 * Who somebody named by a W3ID is, as their own store says: the registry names
 * the store, the store hands over the profile anybody may read, and the face it
 * points at is carried back as bytes. docs/ARCHITECTURE.md § "Who a person is".
 */

import type { W3id } from '@sloppy/types';

/** A fetch made by the device itself — {@link AppRuntime.reachOut}. */
export type W3idHttp = (url: string, init: RequestInit) => Promise<Response>;

export interface W3idProfile {
	name: string | null;
	handle: string | null;
	bio: string | null;
	avatar?: { bytes: Uint8Array; mime: string };
}

/** `not-public`: their store answered and shows nobody without a credential.
 *  `unreached`: no answer came, or none that could be read. */
export type W3idAnswer = W3idProfile | 'not-public' | 'unreached';

/** How long any one ask may take. */
export const W3ID_HOP_MS = 10_000;

/** The User profile's ontology, which MetaState's own clients look a profile up by. */
const USER_ONTOLOGY = '550e8400-e29b-41d4-a716-446655440000';

const PROFILE_QUERY = `query Profile($filter: MetaEnvelopeFilterInput, $first: Int) {
  metaEnvelopes(filter: $filter, first: $first) { edges { node { parsed } } }
}`;

const FACE_MOST_BYTES = 4 * 1024 * 1024;
const NAME_LONGEST = 200;
const BIO_LONGEST = 2000;

class Unreached extends Error {}

export async function resolveW3id(
	principal: W3id,
	registry: string,
	http: W3idHttp
): Promise<W3idAnswer> {
	const ename = principal.slice('w3id:'.length);
	try {
		const store = await storeOf(ename, registry, http);
		const profile = await profileIn(store, ename, http);
		if (profile === 'not-public') return profile;
		const avatar = await faceAt(profile.avatarUrl, http);
		return {
			name: text(profile.displayName, NAME_LONGEST),
			handle: text(profile.username, NAME_LONGEST),
			bio: text(profile.bio, BIO_LONGEST),
			...(avatar ? { avatar } : {})
		};
	} catch {
		return 'unreached';
	}
}

async function storeOf(ename: string, registry: string, http: W3idHttp): Promise<string> {
	const asked = new URL('/resolve', registry);
	asked.searchParams.set('w3id', ename);
	const answer = await within(http, asked.toString(), { method: 'GET' });
	if (!answer.ok) throw new Unreached();
	const uri = field(await answer.json(), 'uri');
	if (typeof uri !== 'string' || !isWebAddress(uri)) throw new Unreached();
	return uri.replace(/\/+$/, '');
}

async function profileIn(
	store: string,
	ename: string,
	http: W3idHttp
): Promise<Record<string, unknown> | 'not-public'> {
	const answer = await within(http, `${store}/graphql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'X-ENAME': ename },
		body: JSON.stringify({
			query: PROFILE_QUERY,
			variables: { filter: { ontologyId: USER_ONTOLOGY }, first: 5 }
		})
	});
	if (answer.status === 401 || answer.status === 403) return 'not-public';
	if (!answer.ok) throw new Unreached();
	const said = await answer.json();
	const edges = field(field(field(said, 'data'), 'metaEnvelopes'), 'edges');
	if (!Array.isArray(edges)) {
		// The store's access guard refuses an ask without a credential in words,
		// with no data beside them.
		if (Array.isArray(field(said, 'errors'))) return 'not-public';
		throw new Unreached();
	}
	for (const edge of edges) {
		const parsed = field(field(edge, 'node'), 'parsed');
		if (isRecord(parsed)) return parsed;
	}
	return 'not-public';
}

async function faceAt(
	url: unknown,
	http: W3idHttp
): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
	if (typeof url !== 'string' || !isWebAddress(url)) return undefined;
	try {
		const answer = await within(http, url, { method: 'GET' });
		const mime = (answer.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (!answer.ok || !mime.startsWith('image/')) return undefined;
		const bytes = new Uint8Array(await answer.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > FACE_MOST_BYTES) return undefined;
		return { bytes, mime };
	} catch {
		return undefined;
	}
}

async function within(http: W3idHttp, url: string, init: RequestInit): Promise<Response> {
	const stop = new AbortController();
	const timer = setTimeout(() => stop.abort(), W3ID_HOP_MS);
	try {
		return await http(url, { ...init, signal: stop.signal });
	} finally {
		clearTimeout(timer);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
	return isRecord(value) ? value[key] : undefined;
}

function text(value: unknown, longest: number): string | null {
	if (typeof value !== 'string') return null;
	const held = value.trim();
	return held === '' ? null : held.slice(0, longest);
}

function isWebAddress(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'https:' || protocol === 'http:';
	} catch {
		return false;
	}
}

/** The bytes as an address an `<img>` loads without asking anybody. */
export function faceSrc(avatar: { bytes: Uint8Array; mime: string }): string {
	let binary = '';
	for (let at = 0; at < avatar.bytes.length; at += 0x8000) {
		binary += String.fromCharCode(...avatar.bytes.subarray(at, at + 0x8000));
	}
	return `data:${avatar.mime};base64,${btoa(binary)}`;
}
