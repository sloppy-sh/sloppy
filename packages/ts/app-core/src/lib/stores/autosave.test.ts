import type { History } from '@sloppy/local';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initRuntime } from '../runtime.js';
import { seamSettledAgain } from '../seam.svelte.js';
import { savesWhileWriting, saveNow, WHILE_WRITING } from './autosave.svelte.js';
import { graphHistory } from './history.svelte.js';
import { prefs } from './prefs.svelte.js';
import { whatHappened } from './what-happened.svelte.js';

/** A history that answers, and remembers what it was asked to keep. Somebody
 *  has written into the folder, which is the case the clock is for. */
function aHistory(over: Partial<History> = {}): History & { kept: string[] } {
	const kept: string[] = [];
	const held = {
		kept,
		status: async () => ({
			branch: 'main',
			changed: ['notes/one.md'],
			untracked: [],
			ahead: 0,
			behind: 0
		}),
		log: async () => ({ versions: [] }),
		commit: async (message: string) => {
			kept.push(message);
			return 'a-commit-id';
		},
		branches: async () => [],
		branch: async () => {},
		switch: async () => {},
		merge: async () => ({ settled: true, inTwoVersions: [] }),
		resolve: async () => {},
		readAt: async () => ({ format: 1 as const, graph: {}, notes: [] }),
		currentCommit: async () => 'a-commit-id',
		...over
	};
	return held as unknown as History & { kept: string[] };
}

let history: ReturnType<typeof aHistory>;

function running(): void {
	initRuntime({ apiHost: () => 'http://api.test', history: () => history });
	seamSettledAgain();
}

beforeEach(async () => {
	vi.useFakeTimers();
	history = aHistory();
	prefs.set('autosave', true);
	prefs.set('autosaveMinutes', 5);
	running();
	await graphHistory.read();
});

afterEach(() => {
	vi.useRealTimers();
	prefs.set('autosave', false);
	graphHistory.clear?.();
	initRuntime({ apiHost: () => '', history: undefined });
	seamSettledAgain();
});

describe('keeping a version while somebody writes', () => {
	it('keeps nothing until somebody has asked for it', async () => {
		prefs.set('autosave', false);
		const stop = savesWhileWriting();

		await vi.advanceTimersByTimeAsync(30 * 60_000);

		expect(history.kept).toEqual([]);
		stop();
	});

	it('keeps one every period, under one name, and stops when told to', async () => {
		const stop = savesWhileWriting();

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(history.kept).toEqual([WHILE_WRITING]);

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(history.kept).toEqual([WHILE_WRITING, WHILE_WRITING]);

		stop();
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		expect(history.kept).toHaveLength(2);
	});

	it('reads the period again each time, so changing it needs no restart', async () => {
		const stop = savesWhileWriting();
		prefs.set('autosaveMinutes', 30);

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(history.kept).toEqual([WHILE_WRITING]);

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(history.kept).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(25 * 60_000);
		expect(history.kept).toHaveLength(2);
		stop();
	});

	// A folder in the middle of something the person began is their repository
	// being used correctly, and a refusal every few minutes is not a message.
	it('says nothing on screen where the folder refuses, and records it', async () => {
		history = aHistory({
			commit: async () => {
				throw new Error('This project is in the middle of something else.');
			}
		});
		running();
		whatHappened.record(true);

		await saveNow();

		expect(graphHistory.says ?? '').not.toContain('in the middle of something');
		expect(whatHappened.asText()).toContain('a version was not kept while writing');
		whatHappened.record(false);
	});

	it('keeps nothing while the folder is part-way through a merge', async () => {
		history = aHistory({
			status: async () => ({
				branch: 'main',
				changed: ['notes/one.md'],
				untracked: [],
				ahead: 0,
				behind: 0,
				merging: { taking: 'another-version', inTwoVersions: [] }
			})
		});
		running();
		await graphHistory.read();

		await saveNow();

		expect(history.kept).toEqual([]);
	});

	// A version kept where the folder is on no line is reachable from nothing,
	// so a folder that cannot be given one is left alone.
	it('keeps nothing where the folder stands on a version and no line can open', async () => {
		history = aHistory({
			status: async () => ({ changed: ['notes/one.md'], untracked: [], ahead: 0, behind: 0 })
		});
		running();
		await graphHistory.read();
		whatHappened.record(true);

		await saveNow();

		expect(history.kept).toEqual([]);
		expect(whatHappened.asText()).toContain('a version was not kept while writing');
		whatHappened.record(false);
	});

	// Standing on a version to read it leaves nothing behind — DESIGN.md § "The
	// history as a picture". A line is opened by writing, never by a clock.
	it('opens no line where the folder stands on a version and nobody wrote', async () => {
		const lines: string[] = [];
		history = aHistory({
			status: async () => ({ changed: [], untracked: [], ahead: 0, behind: 0 }),
			lineHere: async (name: string) => {
				lines.push(name);
				return { name, head: 'a-commit-id', current: true };
			}
		});
		running();
		await graphHistory.read();
		whatHappened.record(true);
		const before = whatHappened.kept.length;

		await saveNow();

		expect(lines).toEqual([]);
		expect(history.kept).toEqual([]);
		expect(graphHistory.openedLine).toBeNull();
		expect(whatHappened.kept.length).toBe(before);
		whatHappened.record(false);
	});

	it('takes nothing to keep as the ordinary answer', async () => {
		history = aHistory({ commit: async () => undefined });
		running();
		whatHappened.record(true);
		const before = whatHappened.kept.length;

		await expect(saveNow()).resolves.toBeUndefined();

		expect(whatHappened.kept.length).toBe(before);
		whatHappened.record(false);
	});
});
