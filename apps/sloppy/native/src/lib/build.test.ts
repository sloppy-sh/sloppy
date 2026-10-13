import { HistoryError } from '@sloppy/local';
import { buildLine } from '@sloppy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { tauriBuilds, type BuildAccess } from './build';
import { tauriFiles } from './files';

const PROJECT = '/work/compiler';
const NOTES = `${PROJECT}/.sloppy`;
const ID = '01JAPART000000000000000000';
const NAME = 'the-reader';
const FROM = 'f0f0f0';

/** Where this app keeps a build's copies, as `build_start` answers them. */
const COPIES = `/data/builds/${ID}`;

/** Every act that reached the bridge, with what it was asked for. */
let asked: { command: string; args: Record<string, unknown> }[];
/** What the folder in front of the person is, as the shell holds it. */
let notes: string | undefined;
/** What the next act answers with, where the test says. */
let answers: Map<string, unknown>;
let refuses: string | undefined;

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
	asked.push({ command, args: args ?? {} });
	if (refuses !== undefined) throw refuses;
	if (answers.has(command)) return answers.get(command) as T;
	switch (command) {
		case 'build_start':
			return { line: buildLine(NAME), path: `${COPIES}/line` } as T;
		case 'build_task_checkout':
			return `${COPIES}/reader` as T;
		case 'build_commit':
			return { id: 'abc', message: 'What it built', author: 'Ada', at: '', parents: [] } as T;
		case 'build_merge_task':
			return { merged: true, conflicts: [] } as T;
		case 'build_standing':
			return [
				{
					id: ID,
					line: buildLine(NAME),
					path: `${COPIES}/line`,
					from: FROM,
					tasks: [{ task: 'reader', path: `${COPIES}/reader` }]
				}
			] as T;
		default:
			return undefined as T;
	}
};

function builds(): BuildAccess {
	return tauriBuilds(
		() => notes,
		tauriFiles('', call, (path) => path),
		call
	);
}

/** What one act was asked for, by its command. */
function args(command: string): Record<string, unknown> | undefined {
	return asked.find((one) => one.command === command)?.args;
}

beforeEach(() => {
	asked = [];
	answers = new Map();
	refuses = undefined;
	notes = NOTES;
});

describe('the line a build writes on', () => {
	it('is opened for the project in front of the person, at the version named', async () => {
		const line = await builds().start(PROJECT, ID, NAME, FROM);

		expect(line).toEqual({ line: 'build/the-reader', path: `${COPIES}/line` });
		expect(args('build_start')).toEqual({ root: NOTES, id: ID, name: NAME, from: FROM });
	});

	it('is not opened for a project somebody does not have open', async () => {
		await expect(builds().start('/work/garden', ID, NAME, FROM)).rejects.toThrow(
			'Open the project you want to build first.'
		);
		expect(asked).toEqual([]);

		notes = undefined;
		await expect(builds().start(PROJECT, ID, NAME, FROM)).rejects.toThrow(
			'Open the project you want to build first.'
		);
	});

	it('says what the person is told where the platform would not open one', async () => {
		refuses = 'A line of work is already called the-reader. Give the build another name.';

		const why = await builds()
			.start(PROJECT, ID, NAME, FROM)
			.catch((reason: unknown) => reason);

		expect(why).toBeInstanceOf(HistoryError);
		expect((why as HistoryError).message).toBe(refuses);
	});

	it('is given up with its copy, and discarded whole', async () => {
		await builds().finish(ID);
		await builds().discard(ID);

		expect(args('build_finish')).toEqual({ root: NOTES, id: ID });
		expect(args('build_discard')).toEqual({ root: NOTES, id: ID });
	});
});

describe('a task of a build', () => {
	it('is worked on in a copy of its own', async () => {
		expect(await builds().taskCheckout(ID, 'reader')).toBe(`${COPIES}/reader`);
		expect(args('build_task_checkout')).toEqual({ root: NOTES, id: ID, task: 'reader' });
	});

	it('is taken into the line, and finished with', async () => {
		expect(await builds().mergeTask(ID, 'reader')).toEqual({ merged: true, conflicts: [] });
		await builds().finishTask(ID, 'reader');

		expect(args('build_merge_task')).toEqual({ root: NOTES, id: ID, task: 'reader' });
		expect(args('build_finish_task')).toEqual({ root: NOTES, id: ID, task: 'reader' });
	});

	it('says which files a merge left in two versions', async () => {
		answers.set('build_merge_task', { merged: false, conflicts: ['src/a.ts'] });

		expect(await builds().mergeTask(ID, 'reader')).toEqual({
			merged: false,
			conflicts: ['src/a.ts']
		});
	});
});

describe('what is in a copy', () => {
	it('is read and written where the session works', () => {
		expect(builds().files(`${COPIES}/reader`).root).toBe(`${COPIES}/reader`);
	});

	it('is kept as one version, and nothing where there is nothing to keep', async () => {
		const kept = await builds().commit(`${COPIES}/line`, 'What it built');

		expect(kept?.id).toBe('abc');
		expect(args('build_commit')).toEqual({
			root: NOTES,
			path: `${COPIES}/line`,
			message: 'What it built'
		});

		answers.set('build_commit', null);
		expect(await builds().commit(`${COPIES}/line`, 'Again')).toBeUndefined();
	});
});

describe('what is standing', () => {
	it('is read out of the project in front of the person', async () => {
		const held = await builds().standing(PROJECT);

		expect(held).toHaveLength(1);
		expect(held[0].line).toBe('build/the-reader');
		expect(held[0].tasks).toEqual([{ task: 'reader', path: `${COPIES}/reader` }]);
		expect(args('build_standing')).toEqual({ root: NOTES });
	});

	it('is nothing where that project is not the one open', async () => {
		expect(await builds().standing('/work/garden')).toEqual([]);

		notes = undefined;
		expect(await builds().standing(PROJECT)).toEqual([]);
		expect(asked).toEqual([]);
	});

	it('is refused rather than carried where a path does not read as one', async () => {
		answers.set('build_standing', [{ id: ID, line: buildLine(NAME), from: FROM, tasks: [] }]);

		await expect(builds().standing(PROJECT)).rejects.toThrow('That did not work. Try again.');
	});
});
