import type { W3id } from '@sloppy/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { faceSrc, resolveW3id, W3ID_HOP_MS, type W3idHttp } from './w3id.js';

const AUTHOR: W3id = 'w3id:@0f6b4a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const ENAME = '@0f6b4a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const REGISTRY = 'https://registry.example.org';
const STORE = 'http://203.0.113.7:4000';
const FACE = 'https://pictures.example.org/face.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface Asked {
	url: string;
	init: RequestInit;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const PUBLIC_PROFILE = {
	data: {
		metaEnvelopes: {
			edges: [
				{
					node: {
						parsed: {
							displayName: '  Ada Lovelace ',
							username: 'ada',
							bio: 'Notes on the engine.',
							avatarUrl: FACE
						}
					}
				}
			]
		}
	}
};

/** A registry and a store that answer as MetaState's do, with `store` swapped in. */
function fake(store: (asked: Asked) => Response | Promise<Response>): {
	http: W3idHttp;
	asked: Asked[];
} {
	const asked: Asked[] = [];
	const http: W3idHttp = async (url, init) => {
		asked.push({ url, init });
		if (url.startsWith(`${REGISTRY}/resolve`)) {
			return new URL(url).searchParams.get('w3id') === ENAME
				? json({ ename: ENAME, uri: `${STORE}/`, evault: 'evault-1' })
				: json({ error: 'not found' }, 404);
		}
		if (url === FACE) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
		return store({ url, init });
	};
	return { http, asked };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('who somebody named by a W3ID is', () => {
	it('reads the profile their store makes public, and carries their face as bytes', async () => {
		const { http, asked } = fake(() => json(PUBLIC_PROFILE));
		const answer = await resolveW3id(AUTHOR, REGISTRY, http);

		expect(answer).toEqual({
			name: 'Ada Lovelace',
			handle: 'ada',
			bio: 'Notes on the engine.',
			avatar: { bytes: PNG, mime: 'image/png' }
		});
		const store = asked.find((one) => one.url === `${STORE}/graphql`);
		expect(store?.init.method).toBe('POST');
		expect((store?.init.headers as Record<string, string>)['X-ENAME']).toBe(ENAME);
		expect(JSON.parse(String(store?.init.body)).variables.filter.ontologyId).toBe(
			'550e8400-e29b-41d4-a716-446655440000'
		);
	});

	it('sends nothing that says who is reading', async () => {
		const { http, asked } = fake(() => json(PUBLIC_PROFILE));
		await resolveW3id(AUTHOR, REGISTRY, http);
		for (const one of asked) {
			const headers = Object.keys((one.init.headers as Record<string, string>) ?? {});
			expect(headers.map((name) => name.toLowerCase())).not.toContain('authorization');
		}
	});

	it('answers not public where the store refuses an ask without a credential', async () => {
		const { http } = fake(() =>
			json({
				errors: [{ message: 'Authentication required' }],
				data: null
			})
		);
		expect(await resolveW3id(AUTHOR, REGISTRY, http)).toBe('not-public');
	});

	it('answers not public where the store shows no profile to anybody', async () => {
		const { http } = fake(() => json({ data: { metaEnvelopes: { edges: [] } } }));
		expect(await resolveW3id(AUTHOR, REGISTRY, http)).toBe('not-public');
	});

	it('answers not public on a refusal by status', async () => {
		const { http } = fake(() => json({ error: 'no' }, 401));
		expect(await resolveW3id(AUTHOR, REGISTRY, http)).toBe('not-public');
	});

	it('answers unreached where the store does not answer', async () => {
		const { http } = fake(() => Promise.reject(new TypeError('connection refused')));
		expect(await resolveW3id(AUTHOR, REGISTRY, http)).toBe('unreached');
	});

	it('answers unreached where the registry is dead', async () => {
		const http: W3idHttp = async () => new Response('', { status: 502 });
		expect(await resolveW3id(AUTHOR, REGISTRY, http)).toBe('unreached');
	});

	it('answers unreached where the registry knows nobody by that name', async () => {
		const { http } = fake(() => json(PUBLIC_PROFILE));
		const nobody: W3id = 'w3id:@11111111-2222-4333-8444-555555555555';
		expect(await resolveW3id(nobody, REGISTRY, http)).toBe('unreached');
	});

	it('gives up on a hop that takes longer than its bound', async () => {
		vi.useFakeTimers();
		const http: W3idHttp = (_url, init) =>
			new Promise((_done, fail) => {
				init.signal?.addEventListener('abort', () => fail(new DOMException('', 'AbortError')));
			});
		const answer = resolveW3id(AUTHOR, REGISTRY, http);
		await vi.advanceTimersByTimeAsync(W3ID_HOP_MS);
		expect(await answer).toBe('unreached');
	});

	it('names them without a face where the picture is not one', async () => {
		const asked: string[] = [];
		const http: W3idHttp = async (url) => {
			asked.push(url);
			if (url.startsWith(REGISTRY)) return json({ uri: STORE });
			if (url === FACE) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
			return json(PUBLIC_PROFILE);
		};
		const answer = await resolveW3id(AUTHOR, REGISTRY, http);
		expect(answer).toMatchObject({ name: 'Ada Lovelace' });
		expect(answer).not.toHaveProperty('avatar');
	});

	it('draws a face from its bytes without asking anybody', () => {
		expect(faceSrc({ bytes: PNG, mime: 'image/png' })).toBe(
			`data:image/png;base64,${btoa(String.fromCharCode(...PNG))}`
		);
	});
});
