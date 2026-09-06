import type { NoteComment, NoteReaction, OwnedRef, RefusedVoiceView } from '@sloppy/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { conversation } from './conversation.svelte.js';
import { DID, ref, useFakeApi, type FakeApi } from './fake-api.test-support.js';

const NOTE = ref(1);
const PEER = 'did:syr:z6MkPeerPeerPeerPeerPeerPeerPeerPeerPeer';

function refPath(of: string): string {
	const cut = of.lastIndexOf('/');
	return `/${encodeURIComponent(of.slice(0, cut))}/${encodeURIComponent(of.slice(cut + 1))}`;
}

function mark(author: string, localId: string, character: string): NoteReaction {
	return {
		kind: 'character',
		reaction_id: `${author}:${localId}`,
		author,
		node: NOTE,
		character
	};
}

const cheer = (author: string, localId: string) => mark(author, localId, '🎉');

/** A reaction made with somebody's own picture. `src` arrives as the API mints
 *  one: an address under the API with no host on it. */
function drawn(author: string, localId: string): NoteReaction {
	return {
		kind: 'emoji',
		reaction_id: `${author}:${localId}`,
		author,
		node: NOTE,
		emoji: {
			emoji_id: `${author}/e1`,
			did: author,
			shortcode: 'party',
			kind: 'emoji',
			src: '/proxy?ref=an-upload'
		}
	};
}

function pictureOf(reaction: NoteReaction | undefined): string {
	if (reaction?.kind !== 'emoji') throw new Error('expected a reaction with a picture');
	return reaction.emoji.src;
}

function answered(author: string, localId: string): NoteComment {
	return {
		comment_id: `${author}:${localId}`,
		author,
		node: NOTE,
		content: 'A thought back.',
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z'
	};
}

const refusalOf = (voice: string, note?: OwnedRef): RefusedVoiceView => ({
	ref: ref(9),
	created_by: DID,
	voice,
	...(note === undefined ? {} : { note }),
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z'
});

let api: FakeApi;

beforeEach(() => {
	conversation.clear();
	api = useFakeApi();
	api.on(`GET /nodes${refPath(NOTE)}/comments`, () => []);
	api.on(`GET /nodes${refPath(NOTE)}/reactions`, () => [cheer(DID, 'r1')]);
});

afterEach(() => conversation.clear());

describe('reacting to a note', () => {
	// An identity store keys a reaction by who made it and what it is, so asking
	// for one already there takes the old row off and issues a new id.
	it('shows one mark per person, however many ids the store spent on it', async () => {
		await conversation.load(NOTE);
		api.on('POST /reactions', () => cheer(DID, 'r2'));

		await conversation.react({ node: NOTE, kind: 'character', character: '🎉' });

		expect(conversation.reactions(NOTE)).toEqual([cheer(DID, 'r2')]);
	});

	it('leaves the same mark from somebody else standing', async () => {
		api.on(`GET /nodes${refPath(NOTE)}/reactions`, () => [cheer(PEER, 'r1')]);
		await conversation.load(NOTE);
		api.on('POST /reactions', () => cheer(DID, 'r2'));

		await conversation.react({ node: NOTE, kind: 'character', character: '🎉' });

		expect(conversation.reactions(NOTE)).toEqual([cheer(PEER, 'r1'), cheer(DID, 'r2')]);
	});

	// The page is not served from the API, and on the native shell it is not even
	// the same host, so an address with no host on it would draw nothing at all.
	it('hands a picture back on the host this shell reaches its instance at', async () => {
		api.on(`GET /nodes${refPath(NOTE)}/reactions`, () => [drawn(PEER, 'r1')]);
		await conversation.load(NOTE);

		expect(pictureOf(conversation.reactions(NOTE)[0])).toBe(
			'http://api.test/api/proxy?ref=an-upload'
		);
	});

	it('does the same for one the reader has just made', async () => {
		await conversation.load(NOTE);
		api.on('POST /reactions', () => drawn(DID, 'r2'));

		const made = await conversation.react({ node: NOTE, kind: 'emoji', emoji_id: `${DID}/e1` });

		expect(pictureOf(made)).toBe('http://api.test/api/proxy?ref=an-upload');
		expect(pictureOf(conversation.reactions(NOTE).at(-1))).toBe(
			'http://api.test/api/proxy?ref=an-upload'
		);
	});

	it('keeps a different mark from the same person', async () => {
		await conversation.load(NOTE);
		const clap = mark(DID, 'r2', '👏');
		api.on('POST /reactions', () => clap);

		await conversation.react({ node: NOTE, kind: 'character', character: '👏' });

		expect(conversation.reactions(NOTE)).toEqual([cheer(DID, 'r1'), clap]);
	});
});

describe('a voice the reader refuses', () => {
	beforeEach(() => {
		api.on(`GET /nodes${refPath(NOTE)}/comments`, () => [
			answered(PEER, 'c1'),
			answered(DID, 'c2')
		]);
		api.on(`GET /nodes${refPath(NOTE)}/reactions`, () => [cheer(PEER, 'r1'), cheer(DID, 'r2')]);
	});

	it('is not shown on a note the reader opens', async () => {
		api.on('GET /refused-voices', () => [refusalOf(PEER)]);
		await conversation.load(NOTE);

		expect(conversation.comments(NOTE).map((one) => one.author)).toEqual([DID]);
		expect(conversation.reactions(NOTE).map((one) => one.author)).toEqual([DID]);
	});

	it('goes the moment they are refused, and comes back when that is undone', async () => {
		api.on('GET /refused-voices', () => []);
		api.on('POST /refused-voices', () => refusalOf(PEER, NOTE));
		api.on('DELETE /refused-voices', () => undefined);
		await conversation.load(NOTE);
		expect(conversation.comments(NOTE)).toHaveLength(2);

		await conversation.refuse(PEER, NOTE);
		expect(conversation.comments(NOTE).map((one) => one.author)).toEqual([DID]);

		await conversation.allow(PEER, NOTE);
		expect(conversation.comments(NOTE)).toHaveLength(2);
	});

	it('is refused on one note without going quiet on another', async () => {
		const elsewhere = ref(2);
		api.on(`GET /nodes${refPath(elsewhere)}/comments`, () => [
			{ ...answered(PEER, 'c3'), node: elsewhere }
		]);
		api.on(`GET /nodes${refPath(elsewhere)}/reactions`, () => []);
		api.on('GET /refused-voices', () => [refusalOf(PEER, NOTE)]);
		await conversation.load(NOTE);
		await conversation.load(elsewhere);

		expect(conversation.comments(NOTE).map((one) => one.author)).toEqual([DID]);
		expect(conversation.comments(elsewhere).map((one) => one.author)).toEqual([PEER]);
	});

	it('is asked for once, however many notes are read', async () => {
		api.on('GET /refused-voices', () => []);
		api.on(`GET /nodes${refPath(ref(2))}/comments`, () => []);
		api.on(`GET /nodes${refPath(ref(2))}/reactions`, () => []);
		await conversation.load(NOTE);
		await conversation.load(ref(2));

		expect(api.countOf('GET /refused-voices')).toBe(1);
	});

	// The list is the reader's own, and what it hides is nothing anybody else
	// asked for: a read that did not land hides nothing.
	it('shows the conversation whole when that list could not be read', async () => {
		await conversation.load(NOTE);

		expect(conversation.comments(NOTE)).toHaveLength(2);
		expect(conversation.status(NOTE).failed).toBe(false);
	});

	it('holds nothing of the last reader for the next', async () => {
		api.on('GET /refused-voices', () => [refusalOf(PEER)]);
		await conversation.load(NOTE);
		expect(conversation.comments(NOTE)).toHaveLength(1);

		conversation.clear();
		api.on('GET /refused-voices', () => []);
		await conversation.load(NOTE);

		expect(conversation.comments(NOTE)).toHaveLength(2);
	});
});
