import type { NoteReaction } from '@sloppy/types';
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
