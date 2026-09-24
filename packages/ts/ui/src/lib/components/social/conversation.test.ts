// @vitest-environment jsdom
import type { CopyEmojiRequest, NoteComment, NoteReaction, OwnedRef } from '@sloppy/types';
import type { ComponentProps } from 'svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Refusal } from '$lib/refusal.js';
import { stubMediaQuery, stubResizeObserver } from '../dom.test-support.js';
import type { Person } from '../identity/person.js';
import Conversation from './conversation.svelte';

const ME = 'did:syr:z6MkAda';
const THEM = 'did:syr:z6MkfZ3Uc1nUxUeaKvcVjNbBidsWv5tvfAv1TFuxNvcbXeaC';
const ALSO = 'did:syr:z6MkqQ7Yb2mVwXeaKvcVjNbBidsWv5tvfAv1TFuxNvcbZzzz';

const MY_NOTE = `${ME}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;
const THEIR_NOTE = `${THEM}/01ARZ3NDEKTSV4RRFFQ69G5FAV` as OwnedRef;
const AT = '2026-01-01T00:00:00.000Z';

const CHARLES: Person = {
	identity: 'did:syr:z6MkCharlesCharlesCharlesCharlesChar',
	displayName: 'Charles Babbage',
	handle: 'charles',
	bio: null,
	avatar: null,
	banner: null
};

const said = (over: Partial<NoteComment> = {}): NoteComment => ({
	comment_id: `${THEM}:1`,
	author: THEM,
	node: MY_NOTE,
	content: 'A thought back.',
	created_at: AT,
	updated_at: AT,
	...over
});

const reacted = (over: Partial<Extract<NoteReaction, { kind: 'emoji' }>> = {}): NoteReaction => ({
	kind: 'emoji',
	reaction_id: `${THEM}:2`,
	author: THEM,
	node: MY_NOTE,
	emoji: {
		emoji_id: 'e1',
		did: THEM,
		shortcode: 'engine',
		kind: 'emoji',
		src: '/api/proxy?ref=engine'
	},
	...over
});

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		flushSync();
		await new Promise((done) => setTimeout(done, 0));
	}
	flushSync();
}

function show(over: Partial<ComponentProps<typeof Conversation>> = {}): void {
	mounted = mount(Conversation, {
		target,
		props: {
			comments: [],
			reactions: [],
			mine: ME,
			people: { of: () => null, unplaced: () => true, resolve: () => {} },
			emoji: {
				mine: ME,
				catalog: () => Promise.resolve([]),
				add: () => Promise.resolve(),
				remove: () => Promise.resolve()
			},
			onsay: () => Promise.resolve(),
			onunsay: () => Promise.resolve(),
			onreact: () => Promise.resolve(),
			onunreact: () => Promise.resolve(),
			...over
		}
	});
	flushSync();
}

const labelled = (label: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`);

function shortcodeField(): HTMLInputElement {
	const field = document.querySelector<HTMLInputElement>('[aria-label="What to call it"]');
	if (!field) throw new Error('No name field on screen');
	return field;
}

function typeInto(field: HTMLInputElement, words: string): void {
	field.value = words;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

const named = (words: string): HTMLElement | undefined =>
	[...document.querySelectorAll<HTMLElement>('button')].find((one) =>
		one.textContent?.includes(words)
	);

beforeEach(() => {
	stubMediaQuery((query) => query.includes('min-width'));
	stubResizeObserver();
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	document.body.innerHTML = '';
});

describe('whose a comment is', () => {
	it('says so where nobody could be shown to have written one', () => {
		show({ comments: [said({ attribution: 'unattributed' })] });
		const text = document.body.textContent ?? '';
		expect(text).toContain('A thought back.');
		expect(text).toContain('Nobody could be shown to have written this');
	});

	// An unsigned comment is the ordinary state of one and says nothing either
	// way, so a reader must not be handed a doubt nobody raised.
	it('says nothing where nothing was weighed', () => {
		show({ comments: [said()] });
		expect(document.body.textContent ?? '').not.toContain('Nobody could be shown');
	});

	it("says nothing where the signature is its writer's own", () => {
		show({ comments: [said({ attribution: 'theirs' })] });
		expect(document.body.textContent ?? '').not.toContain('Nobody could be shown');
	});
});

describe('a voice nobody could place', () => {
	it('is called Somebody, with the identity beneath it rather than in its name', () => {
		show({ comments: [said()] });
		const text = document.body.textContent ?? '';
		expect(text).toContain('Somebody');
		expect(text).toContain(THEM);
		expect(document.querySelector('.font-mono')?.textContent?.trim()).toBe(THEM);
	});

	it('tells two of them apart', () => {
		show({ comments: [said(), said({ comment_id: `${ALSO}:1`, author: ALSO })] });
		const text = document.body.textContent ?? '';
		expect(text).toContain(THEM);
		expect(text).toContain(ALSO);
	});

	it('draws a settled picture rather than one that will never arrive', () => {
		show({ comments: [said()] });
		expect(document.querySelector('.animate-pulse')).toBeNull();
	});

	it('gives way to the name as soon as one is there', () => {
		show({
			comments: [said()],
			people: { of: () => CHARLES, unplaced: () => false, resolve: () => {} }
		});
		expect(document.body.textContent).toContain('Charles Babbage');
	});

	it('names nobody while the ask is still out', () => {
		show({
			comments: [said()],
			people: { of: () => null, unplaced: () => false, resolve: () => {} }
		});
		const text = document.body.textContent ?? '';
		expect(text).not.toContain(THEM);
		expect(text).toContain('A thought back.');
	});
});

describe('meeting whoever spoke', () => {
	it('opens the person a name names', () => {
		const met: string[] = [];
		show({ comments: [said()], onperson: (did) => met.push(did) });
		named('Somebody')?.click();
		flushSync();
		expect(met).toEqual([THEM]);
	});

	it('leaves the name as plain text where the surface offers nobody to meet', () => {
		show({ comments: [said()] });
		expect(named('Somebody')).toBeUndefined();
	});

	it('leaves the reader’s own voice as plain text', () => {
		show({
			comments: [said({ comment_id: `${ME}:1`, author: ME })],
			onperson: () => {}
		});
		expect(document.body.textContent).toContain('z6MkAda');
		expect(named('z6MkAda')).toBeUndefined();
	});
});

describe('refusing one voice', () => {
	it('is offered on the reader’s own note, and says what it did', async () => {
		const gone: string[] = [];
		show({
			comments: [said()],
			refusing: {
				scope: 'note',
				refuse: (voice) => {
					gone.push(voice);
					return Promise.resolve();
				},
				allow: () => Promise.resolve()
			}
		});
		named('Do not show me their answers here')?.click();
		await settle();
		expect(gone).toEqual([THEM]);
		expect(document.body.textContent).toContain(
			'You will not be shown their answers on this note.'
		);
	});

	it('has a way back before the words leave the screen', async () => {
		const back: string[] = [];
		show({
			comments: [said()],
			refusing: {
				scope: 'note',
				refuse: () => Promise.resolve(),
				allow: (voice) => {
					back.push(voice);
					return Promise.resolve();
				}
			}
		});
		named('Do not show me their answers here')?.click();
		await settle();
		named('Undo')?.click();
		await settle();
		expect(back).toEqual([THEM]);
	});

	it('says what it covers when the surface refuses a voice everywhere', async () => {
		show({
			comments: [said()],
			refusing: {
				scope: 'everywhere',
				refuse: () => Promise.resolve(),
				allow: () => Promise.resolve()
			}
		});
		named('Do not show me their answers')?.click();
		await settle();
		const text = document.body.textContent ?? '';
		expect(text).toContain('You will not be shown their answers.');
		expect(text).not.toContain('on this note');
	});

	it('is not offered on somebody else’s note', () => {
		show({
			comments: [said({ node: THEIR_NOTE })],
			refusing: { scope: 'note', refuse: () => Promise.resolve(), allow: () => Promise.resolve() }
		});
		expect(named('Do not show me their answers here')).toBeUndefined();
	});

	it('is not offered on the reader’s own words', () => {
		show({
			comments: [said({ comment_id: `${ME}:1`, author: ME })],
			refusing: { scope: 'note', refuse: () => Promise.resolve(), allow: () => Promise.resolve() }
		});
		expect(named('Do not show me their answers here')).toBeUndefined();
	});
});

describe('keeping an emoji met on a note', () => {
	it('offers the shortcode it arrived under, and sends what was chosen', async () => {
		const kept: CopyEmojiRequest[] = [];
		show({
			reactions: [reacted()],
			onkeep: (ask) => {
				kept.push(ask);
				return Promise.resolve();
			}
		});
		labelled('Keep engine in your set')?.click();
		await settle();

		const field = shortcodeField();
		expect(field.value).toBe('engine');
		typeInto(field, 'the_engine');
		await settle();
		named('Keep it')?.click();
		await settle();

		expect(kept).toEqual([{ shortcode: 'the_engine', kind: 'emoji', source_emoji_id: 'e1' }]);
	});

	it('says what to do instead when the name will not do', async () => {
		show({ reactions: [reacted()], onkeep: () => Promise.resolve() });
		labelled('Keep engine in your set')?.click();
		await settle();

		typeInto(shortcodeField(), 'no spaces allowed');
		await settle();

		expect(document.body.textContent).toContain('Two to thirty-two letters');
		expect((named('Keep it') as HTMLButtonElement | undefined)?.disabled).toBe(true);
	});

	it('says what happened when the emoji could not be kept', async () => {
		show({
			reactions: [reacted()],
			onkeep: () => Promise.reject(new Refusal('That is already in your set.'))
		});
		labelled('Keep engine in your set')?.click();
		await settle();
		named('Keep it')?.click();
		await settle();
		expect(document.body.textContent).toContain('That is already in your set.');
	});

	// A bug on the way to the store says nothing anybody can act on, so the
	// surface says what to try instead of what broke.
	it('says what to try when what came back was never written for a person', async () => {
		show({
			reactions: [reacted()],
			onkeep: () =>
				Promise.reject(new Error("Cannot read properties of undefined (reading 'invoke')"))
		});
		labelled('Keep engine in your set')?.click();
		await settle();
		named('Keep it')?.click();
		await settle();

		const shown = document.body.textContent ?? '';
		expect(shown).toContain('That could not be kept. Try again in a moment.');
		expect(shown).not.toContain('invoke');
	});

	it('offers nothing to keep where the surface cannot take one', () => {
		show({ reactions: [reacted()] });
		expect(labelled('Keep engine in your set')).toBeNull();
	});
});
