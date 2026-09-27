/**
 * A record of what the app did, kept for somebody who hit something wrong and
 * is about to say what. Off until they turn it on, and it is handed to other
 * people, so what goes in it is bounded on purpose:
 *
 * **What an act WAS and what it came to goes in. What a note says, what
 * somebody typed, who anybody is and anything that gets them in anywhere never
 * does.** Every call site is held to that, and a line that would carry one of
 * them is a bug rather than a detail.
 */

import { prefs } from './prefs.svelte.js';

/** How many are kept. Past this the oldest goes, so a long day costs a bounded
 *  amount of memory rather than a file that grows. */
export const MOST_KEPT = 500;

/** How long one line may be, which is what bounds a failure written somewhere
 *  else — a library's error text is not ours to trust with the record. */
const MOST_SAID = 300;

export type HappeningKind = 'turn' | 'act' | 'question' | 'trouble';

export interface Happening {
	/** ISO 8601 with the milliseconds, which is what lets two of these be lined
	 *  up against each other. */
	at: string;
	kind: HappeningKind;
	said: string;
	/** The act this is about, where it is about one, so what was called and what
	 *  came of it read as a pair. */
	call?: string;
}

/** A failure as one line, whatever was thrown. */
export function troubleIn(reason: unknown): string {
	if (reason instanceof Error) return `${reason.name}: ${reason.message}`.slice(0, MOST_SAID);
	if (typeof reason === 'string') return reason.slice(0, MOST_SAID);
	try {
		return String(reason).slice(0, MOST_SAID);
	} catch {
		return 'something with nothing to say for itself';
	}
}

class WhatHappened {
	#kept = $state.raw<readonly Happening[]>([]);

	constructor() {
		if (typeof window === 'undefined') return;
		// A failure nobody wrote a path for reaches the record here or nowhere.
		window.addEventListener('error', (event) =>
			this.put('trouble', troubleIn(event.error ?? event.message))
		);
		window.addEventListener('unhandledrejection', (event) =>
			this.put('trouble', troubleIn(event.reason))
		);
	}

	/** Whether the app is recording. Their answer outlives the app being closed;
	 *  what was recorded does not. */
	get on(): boolean {
		return prefs.current.recordsWhatHappens;
	}

	record(on: boolean): void {
		prefs.set('recordsWhatHappens', on);
	}

	/** What has been recorded, oldest first. */
	get kept(): readonly Happening[] {
		return this.#kept;
	}

	/** Put one thing in the record. Does nothing while it is off, which is what
	 *  makes this safe to call from anywhere. */
	put(kind: HappeningKind, said: string, call?: string): void {
		if (!this.on) return;
		const one: Happening = {
			at: new Date().toISOString(),
			kind,
			said: said.slice(0, MOST_SAID),
			...(call === undefined ? {} : { call })
		};
		const held = this.#kept;
		this.#kept = [...held.slice(Math.max(0, held.length + 1 - MOST_KEPT)), one];
	}

	clear(): void {
		this.#kept = [];
	}

	/** The record as somebody hands it over: a line each, oldest first. */
	asText(): string {
		return this.#kept
			.map(
				(one) =>
					`${one.at}  ${one.kind}  ${one.said}${one.call === undefined ? '' : `  [${one.call}]`}`
			)
			.join('\n');
	}
}

export const whatHappened = new WhatHappened();
