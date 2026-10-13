/**
 * This shell's half of `BuildAccess` in `@sloppy/app-core`, which declares
 * every act and what its answer means. The line, the copies, the versions and
 * the merges are `src-tauri/src/build.rs`; what is in a copy is the `Files`
 * this shell already answers for a folder, rooted inside it.
 *
 * Every act is about the project in front of the person, as this shell knows
 * where that is — the same answer `AppRuntime.history` is rooted at — so an act
 * naming a build by its id alone is answered for that folder.
 */

import type { ChatAccess } from '@sloppy/app-core';
import type { Commit, Files } from '@sloppy/local';
import { type BuildStanding, BuildStandingSchema, type Ulid } from '@sloppy/types';
import { invoke } from '@tauri-apps/api/core';
import { refusal, type Invoke } from './files';

/** The seam, which `@sloppy/app-core` carries on `ChatAccess` rather than
 *  exporting beside it. */
export type BuildAccess = NonNullable<ChatAccess['builds']>;

/** The commands `src-tauri` answers. */
const STANDING = 'build_standing';
const START = 'build_start';
const TASK = 'build_task_checkout';
const COMMIT = 'build_commit';
const MERGE = 'build_merge_task';
const FINISH_TASK = 'build_finish_task';
const FINISH = 'build_finish';
const DISCARD = 'build_discard';

const NO_PROJECT = 'Open the project you want to build first.';
const DIDNT_WORK = 'That did not work. Try again.';

class TauriBuilds implements BuildAccess {
	constructor(
		private readonly notes: () => string | undefined,
		private readonly device: Files,
		private readonly call: Invoke
	) {}

	async start(
		root: string,
		id: Ulid,
		name: string,
		from: string
	): Promise<{ line: string; path: string }> {
		return aLine(await this.asked(START, { root: this.inside(root), id, name, from }));
	}

	async taskCheckout(id: Ulid, task: string): Promise<string> {
		return this.asked<string>(TASK, { root: this.here(), id, task });
	}

	files(path: string): Files {
		return this.device.at(path);
	}

	async commit(path: string, message: string): Promise<Commit | undefined> {
		return (
			(await this.asked<Commit | null>(COMMIT, { root: this.here(), path, message })) ?? undefined
		);
	}

	async mergeTask(id: Ulid, task: string): Promise<{ merged: boolean; conflicts: string[] }> {
		return this.asked(MERGE, { root: this.here(), id, task });
	}

	async finishTask(id: Ulid, task: string): Promise<void> {
		await this.asked<void>(FINISH_TASK, { root: this.here(), id, task });
	}

	async finish(id: Ulid): Promise<void> {
		await this.asked<void>(FINISH, { root: this.here(), id });
	}

	async discard(id: Ulid): Promise<void> {
		await this.asked<void>(DISCARD, { root: this.here(), id });
	}

	async standing(root: string): Promise<BuildStanding[]> {
		const notes = this.notes();
		if (notes === undefined || !holds(root, notes)) return [];
		return (await this.asked<unknown[]>(STANDING, { root: notes })).map(aStanding);
	}

	/** Where the graph in front of somebody is kept, which is the folder every
	 *  act here answers for. */
	private here(): string {
		const notes = this.notes();
		if (notes === undefined) throw refusal(NO_PROJECT);
		return notes;
	}

	/** The same folder, held against the project the page named — a build is of
	 *  the project somebody has open, and never of another one. */
	private inside(root: string): string {
		const notes = this.here();
		if (!holds(root, notes)) throw refusal(NO_PROJECT);
		return notes;
	}

	private async asked<T>(command: string, args: Record<string, unknown>): Promise<T> {
		try {
			return await this.call<T>(command, args);
		} catch (reason) {
			throw refusal(reason);
		}
	}
}

/** Whether `notes` is the folder `root` names or sits inside it. */
function holds(root: string, notes: string): boolean {
	const held = root.endsWith('/') ? root : `${root}/`;
	return notes === root || notes.startsWith(held);
}

/** The line and its copy, held to the halves of `BuildStanding` they are, so a
 *  store is never rooted at a path taken on trust. */
function aLine(held: unknown): { line: string; path: string } {
	const answer = BuildStandingSchema.pick({ line: true, path: true }).safeParse(held);
	if (!answer.success) throw refusal(DIDNT_WORK);
	return answer.data;
}

function aStanding(held: unknown): BuildStanding {
	const build = BuildStandingSchema.safeParse(held);
	if (!build.success) throw refusal(DIDNT_WORK);
	return build.data;
}

/** `notes` is where the graph in front of somebody is kept, asked again each
 *  time because opening another folder is another project's builds. */
export function tauriBuilds(
	notes: () => string | undefined,
	device: Files,
	call: Invoke = invoke
): BuildAccess {
	return new TauriBuilds(notes, device, call);
}
