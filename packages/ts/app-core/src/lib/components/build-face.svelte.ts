/**
 * What the card and the acts that start a build ask of the build in front of
 * somebody — docs/ARCHITECTURE.md § "Building from the notes". The store that
 * runs the phases stands behind it, and a page offers it here the way it offers
 * its acts, so a surface that cannot build is one nothing was offered to.
 */

import type { Build, BuildName, BuildSlug, ContextUsage, OwnedRef, Ulid } from '@sloppy/types';
import { builds } from '../stores/build.svelte.js';

export interface BuildFace {
	/** Whether a build can run on the assistant this device is set to. */
	readonly reaches: boolean;
	/** The build standing on this project. `null` is a project with none, which
	 *  is where a build is offered. */
	readonly standing: Build | null;
	/** Why the last act did not land, in words for the person. */
	readonly says: string | null;
	/** Whether an act is in flight. */
	readonly busy: boolean;
	/** One build this device holds. */
	of(id: Ulid): Build | undefined;
	/** Whether something is already called this here, which is asked before a
	 *  version is kept. The lines of the folder and the copies a build is
	 *  working in both answer it, so the answer is awaited. */
	taken(name: BuildName): Promise<boolean>;
	/** Read the notes and answer with a plan. */
	begin(about: readonly OwnedRef[], name: BuildName): Promise<boolean>;
	/** The plan says what the person means: build it. */
	go(): Promise<boolean>;
	/** The note somebody wrote for a question. */
	answer(need: BuildSlug, note: OwnedRef): Promise<boolean>;
	/** The question set aside. */
	drop(need: BuildSlug): Promise<boolean>;
	/** A note this task is to be built from. */
	reads(task: BuildSlug, note: OwnedRef): Promise<boolean>;
	/** A note it is not. */
	leaves(task: BuildSlug, note: OwnedRef): Promise<boolean>;
	stop(): Promise<boolean>;
	carryOn(): Promise<boolean>;
	discard(): Promise<boolean>;
	/** How full one session's window is, as it last said. `null` is a session
	 *  that has not said, which draws no bar. */
	contextOf(conversation: Ulid): ContextUsage | null;
}

class BuildsHere {
	#held = $state.raw<BuildFace | null>(null);

	/** The builds on this device, and `null` where nothing can build. */
	get face(): BuildFace | null {
		return this.#held;
	}

	/** Returns the disposer that takes it away again; calling it twice is a
	 *  no-op, so an `$effect` cleanup can own it. */
	offers(face: BuildFace): () => void {
		this.#held = face;
		return () => {
			if (this.#held === face) this.#held = null;
		};
	}
}

export const buildsHere = new BuildsHere();

/**
 * The store that runs the phases, under the names the card and the acts ask by.
 * `stores/build.svelte.ts` is where every one of them happens; nothing is
 * decided here.
 */
class TheBuilds implements BuildFace {
	#acting = $state(0);

	/** A device that has not said what assistants it has is not a device with
	 *  none, so the act stands and a refusal says what was found. */
	get reaches(): boolean {
		return builds.assistantHere !== false;
	}

	get standing(): Build | null {
		return builds.current;
	}

	get says(): string | null {
		return builds.says;
	}

	get busy(): boolean {
		return this.#acting > 0;
	}

	of(id: Ulid): Build | undefined {
		const held = builds.current;
		return held?.id === id ? held : undefined;
	}

	taken(name: BuildName): Promise<boolean> {
		return builds.nameTaken(name);
	}

	begin(about: readonly OwnedRef[], name: BuildName): Promise<boolean> {
		return this.#act(() => builds.start(about, name));
	}

	go(): Promise<boolean> {
		return this.#act(() => builds.go());
	}

	answer(need: BuildSlug, note: OwnedRef): Promise<boolean> {
		return this.#act(() => builds.answer(need, note));
	}

	drop(need: BuildSlug): Promise<boolean> {
		return this.#act(() => builds.drop(need));
	}

	reads(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		return this.#act(() => builds.addNote(task, note));
	}

	leaves(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		return this.#act(() => builds.takeNote(task, note));
	}

	stop(): Promise<boolean> {
		return this.#act(async () => {
			await builds.stop();
			return true;
		});
	}

	carryOn(): Promise<boolean> {
		return this.#act(async () => {
			await builds.goOn();
			return true;
		});
	}

	discard(): Promise<boolean> {
		return this.#act(() => builds.discard());
	}

	contextOf(conversation: Ulid): ContextUsage | null {
		return builds.contextOf(conversation);
	}

	async #act(run: () => Promise<boolean>): Promise<boolean> {
		this.#acting += 1;
		try {
			return await run();
		} finally {
			this.#acting -= 1;
		}
	}
}

/** The one the pages offer, which runs the phases. */
export const theBuilds = new TheBuilds();
