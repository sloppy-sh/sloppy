/**
 * What the card and the acts that start a build ask of the build in front of
 * somebody — docs/ARCHITECTURE.md § "Building from the notes". The store that
 * runs the phases offers itself here, the way a page offers its acts, so a
 * surface that cannot build is one nothing was offered to.
 */

import type { Build, BuildName, BuildSlug, ContextUsage, OwnedRef, Ulid } from '@sloppy/types';

export interface BuildFace {
	/** Whether this device can build at all. */
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
	 *  version is kept. */
	taken(name: BuildName): boolean;
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
