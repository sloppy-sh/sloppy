// `author/read` — who somebody a note names as an author is, for a headset
// drawing the note's head: docs/ARCHITECTURE.md § "A headset beside the desk".

import { type ServeMethodTable, ServeRefused } from '@sloppy/local';
import {
	AUTHOR_FACE_LONGEST,
	AUTHOR_READ,
	type AuthorRead,
	NOT_PUBLIC_SAID,
	type Principal,
	PrincipalSchema,
	principalScheme,
	SERVE_REFUSALS,
	UNREACHED_SAID,
	UNRESOLVED_ENAME,
	type W3id
} from '@sloppy/types';
import { runtime } from '../runtime.js';
import { people } from '../stores/people.svelte.js';

export interface Face {
	bytes: Uint8Array;
	mime: string;
}

/** Who a principal is, as wherever they are named answers: absent `name` is
 *  somebody nobody here can put a name to. */
export type Who = { name?: string; handle?: string; avatar?: Face } | 'not-public' | 'unreached';

export interface AuthorSources {
	whoIs(principal: Principal): Promise<Who>;
	/** `face` as PNG no more than {@link AUTHOR_FACE_LONGEST} on its longer
	 *  side; undefined where it cannot be drawn. */
	scaled(face: Face): Promise<Uint8Array | undefined>;
}

function refused(who: 'not-public' | 'unreached'): ServeRefused {
	return who === 'not-public'
		? new ServeRefused(SERVE_REFUSALS.NOT_PUBLIC, NOT_PUBLIC_SAID)
		: new ServeRefused(SERVE_REFUSALS.UNREACHED, UNREACHED_SAID);
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (let at = 0; at < bytes.length; at += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	}
	return btoa(binary);
}

async function answered(who: Who, sources: AuthorSources): Promise<AuthorRead> {
	if (typeof who === 'string') return { name: UNRESOLVED_ENAME };
	const picture = who.avatar && (await sources.scaled(who.avatar).catch(() => undefined));
	return {
		...(who.name ? { name: who.name } : {}),
		...(who.handle ? { handle: who.handle } : {}),
		...(picture ? { picture: base64(picture) } : {})
	};
}

/** `author/read` over `sources`, which hold whoever they have named. */
export function authorMethods(sources: AuthorSources): ServeMethodTable {
	const read = async (params: Record<string, unknown>): Promise<AuthorRead> => {
		const principal = PrincipalSchema.safeParse(params.principal);
		if (!principal.success) throw refused('unreached');
		return answered(await sources.whoIs(principal.data), sources);
	};
	return { [AUTHOR_READ]: { queued: false, handle: read } };
}

async function picture(src: string | null): Promise<Face | undefined> {
	if (!src) return undefined;
	const answer = await runtime.fetchImpl()(src);
	if (!answer.ok) return undefined;
	const mime = answer.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
	return { bytes: new Uint8Array(await answer.arrayBuffer()), mime };
}

async function syrPerson(did: string): Promise<Who> {
	await people.resolved(did);
	const person = people.of(did);
	if (!person) return people.unplaced(did) ? {} : 'unreached';
	return {
		name: person.displayName?.trim() || undefined,
		handle: person.handle ?? undefined,
		avatar: await picture(person.avatar).catch(() => undefined)
	};
}

async function w3idPerson(principal: W3id): Promise<Who> {
	const answer = await people.w3id(principal);
	if (typeof answer === 'string') return answer;
	return {
		name: answer.name?.trim() || undefined,
		handle: answer.handle ?? undefined,
		avatar: answer.avatar
	};
}

/** Who `principal` is, as the people store names them: a mail address names
 *  nobody here. */
export function whoIs(principal: Principal): Promise<Who> {
	switch (principalScheme(principal)) {
		case 'did:syr':
			return syrPerson(principal);
		case 'w3id':
			return w3idPerson(principal as W3id);
		default:
			return Promise.resolve({});
	}
}

/** `face` drawn again as PNG within {@link AUTHOR_FACE_LONGEST}, by the page. */
export async function scaledFace(face: Face): Promise<Uint8Array | undefined> {
	const drawn = await createImageBitmap(
		new Blob([face.bytes.slice().buffer as ArrayBuffer], { type: face.mime })
	);
	const by = Math.min(1, AUTHOR_FACE_LONGEST / Math.max(drawn.width, drawn.height));
	const width = Math.max(1, Math.round(drawn.width * by));
	const height = Math.max(1, Math.round(drawn.height * by));
	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext('2d')?.drawImage(drawn, 0, 0, width, height);
	drawn.close();
	const png = await canvas.convertToBlob({ type: 'image/png' });
	return new Uint8Array(await png.arrayBuffer());
}

export const deskAuthors: AuthorSources = { whoIs, scaled: scaledFace };
