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

	it('keeps a different mark from the same person', async () => {
		await conversation.load(NOTE);
		const clap = mark(DID, 'r2', '👏');
		api.on('POST /reactions', () => clap);

		await conversation.react({ node: NOTE, kind: 'character', character: '👏' });

		expect(conversation.reactions(NOTE)).toEqual([cheer(DID, 'r1'), clap]);
	});
});
