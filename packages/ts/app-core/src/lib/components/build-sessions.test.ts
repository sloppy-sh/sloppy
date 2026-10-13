// What the build's sessions said, grouped by the session they said it in —
// DESIGN.md § "A build".

import 'fake-indexeddb/auto';
import {
	buildLine,
	ulid,
	type Build,
	type ChatTurn,
	type ContextUsage,
	type Ulid
} from '@sloppy/types';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DID, homeOf, ref } from '../stores/fake-api.test-support.js';

vi.mock('./context-chart.svelte', async () => ({
	default: (await import('./context-chart.test-support.svelte')).default
}));

const BuildSessions = (await import('./build-sessions.svelte')).default;

const HOME = homeOf(DID);
const PARSER = ref(1);
const READING = ulid();
const WRITING = ulid();

const USAGE: ContextUsage = {
	total: 12_000,
	limit: 200_000,
	parts: [],
	at: new Date().toISOString()
};

function said(words: string, conversation: Ulid): ChatTurn {
	return {
		from: 'agent',
		blocks: [{ kind: 'said', said: words }],
		at: new Date().toISOString(),
		conversation
	};
}

const build: Build = {
	id: ulid(),
	graph: HOME,
	project: '/home/ada/garden',
	about: [PARSER],
	name: 'the-reader',
	line: buildLine('the-reader'),
	from: 'c0',
	state: 'building',
	plan: {
		tasks: [
			{
				id: 'reader',
				title: 'Read the notes first',
				effect: 'It reads the note saying what the thing is for.',
				paths: ['src/reader.ts'],
				notes: [PARSER]
			}
		],
		needs: [],
		disputes: [],
		checks: []
	},
	answers: {},
	tasks: { reader: { state: 'building', handoffs: [], needs: [], rounds: 0 } },
	sessions: [
		{ conversation: READING, role: 'planner' },
		{ conversation: WRITING, role: 'implementer', task: 'reader' }
	],
	merges: [],
	created: new Date().toISOString()
};

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | undefined;

function show(): void {
	mounted = mount(BuildSessions, {
		target,
		props: {
			build,
			turns: [said('The notes say the reader waits.', READING), said('Written.', WRITING)],
			contextOf: () => USAGE,
			onOpen: () => undefined
		}
	});
	flushSync();
}

const of = (conversation: Ulid): HTMLElement | null =>
	target.querySelector(`[data-build-session="${conversation}"]`);

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	if (mounted) unmount(mounted, { outro: false });
	mounted = undefined;
	target.remove();
	document.body.innerHTML = '';
});

it('says what each session is for, and draws only what was said in it', () => {
	show();

	expect(of(READING)?.textContent).toContain('Reading your notes');
	expect(of(READING)?.textContent).toContain('The notes say the reader waits.');
	expect(of(READING)?.textContent).not.toContain('Written.');

	expect(of(WRITING)?.textContent).toContain('Building Read the notes first');
	expect(of(WRITING)?.textContent).toContain('Written.');
});

// The bar for a session working on a task stands on that task's row, where a
// reader watches it; one for a session no task row carries stands here.
it('draws a bar for a session no task stands for, and none for one a task does', () => {
	show();

	expect(of(READING)?.querySelector('[data-slot="context-chart"]')).not.toBeNull();
	expect(of(WRITING)?.querySelector('[data-slot="context-chart"]')).toBeNull();
});

it('offers nothing to keep as a note, which is the chat’s act and not a build’s', () => {
	show();

	expect(
		[...target.querySelectorAll('button')].map((one) => one.textContent?.trim())
	).not.toContain('Keep as a note');
});
