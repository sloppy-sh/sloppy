/**
 * Moving the folder over writing nobody has kept — DESIGN.md § "The history as
 * a picture". One of these stands beside each history surface, so the column
 * and the sheet ask the same question in the same words.
 */

import { graphHistory } from '../stores/history.svelte.js';

/** Somewhere the folder is going, once writing nobody has kept is answered
 *  for. */
export interface Leaving {
	/** Whether the act can take that writing along with it. */
	carries: boolean;
	/** Answers whether the folder moved. */
	go: (carrying: boolean) => Promise<boolean>;
}

/** What a version kept on the way out says, until somebody writes their own. */
const BEFORE_MOVING = 'Before moving on';

export class Moving {
	#leaving = $state.raw<Leaving | null>(null);
	#asking = $state(false);
	#going = $state(false);
	#tried = $state(false);
	#message = $state(BEFORE_MOVING);
	#answer: ((moved: boolean) => void) | null = null;

	/** Whether the question is in front of somebody. */
	get asking(): boolean {
		return this.#asking;
	}

	set asking(open: boolean) {
		this.#asking = open;
		if (!open) this.#hand(false);
	}

	/** Whether the way out being asked about can take the writing along. */
	get carries(): boolean {
		return this.#leaving?.carries ?? false;
	}

	/** Whether a way out is being taken right now. */
	get busy(): boolean {
		return this.#going;
	}

	get message(): string {
		return this.#message;
	}

	set message(said: string) {
		this.#message = said;
	}

	/** Why the way out somebody took did not work, and `null` before one has
	 *  been taken. */
	get says(): string | null {
		return this.#tried ? graphHistory.says : null;
	}

	/**
	 * Move the folder, asking first where there is writing nobody has kept.
	 * Answers whether it moved.
	 */
	async leaveFor(what: Leaving): Promise<boolean> {
		if (this.#going || this.#asking) return false;
		if (!(await graphHistory.unkeptNow())) return this.#take(() => what.go(false));
		this.#message = BEFORE_MOVING;
		this.#tried = false;
		this.#leaving = what;
		this.#asking = true;
		return new Promise<boolean>((done) => (this.#answer = done));
	}

	/** Keep what is unkept as a version on the line being left, then go. */
	keepFirst(): Promise<boolean> {
		const what = this.#leaving;
		const says = this.#message.trim();
		if (!what || says === '') return Promise.resolve(false);
		return this.#take(async () => {
			if (graphHistory.unkept && !(await graphHistory.keep(says))) return false;
			return what.go(false);
		});
	}

	/** Go, and let the writing travel. */
	bringThem(): Promise<boolean> {
		const what = this.#leaving;
		return what ? this.#take(() => what.go(true)) : Promise.resolve(false);
	}

	stay(): void {
		this.asking = false;
	}

	async #take(run: () => Promise<boolean>): Promise<boolean> {
		if (this.#going) return false;
		this.#going = true;
		this.#tried = true;
		try {
			const moved = await run();
			if (moved) {
				this.#asking = false;
				this.#hand(true);
			}
			return moved;
		} finally {
			this.#going = false;
		}
	}

	#hand(moved: boolean): void {
		const done = this.#answer;
		this.#answer = null;
		done?.(moved);
	}
}
