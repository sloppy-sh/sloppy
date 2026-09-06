// The writing a note has that the server does not, kept on this device until it
// lands — DESIGN.md § "Persistence" is the doc of record for what belongs here.

import type { OwnedRef } from '@sloppy/types';
import type { DraftStore, NoteDraft } from '@sloppy/ui';
import { SvelteSet } from 'svelte/reactivity';
import { deviceStore, type DeviceArea } from '../device-store.js';
import { session } from './session.svelte.js';

const AREA = 'drafts';
/** A draft on its way to the server is not worth saying anything about; one
 *  still here after this has been waiting. */
const WAITING_AFTER_MS = 3000;

class DraftsStore implements DraftStore {
	readonly #waiting = new SvelteSet<OwnedRef>();
	readonly #holding = new Map<OwnedRef, ReturnType<typeof setTimeout>>();
	readonly #last = new Map<OwnedRef, number>();
	#count = 0;

	/** Null with nobody signed in: every key here is one identity's, and there
	 *  is no identity to scope it to. */
	#area(): DeviceArea | null {
		const did = session.viewer?.did;
		return did ? deviceStore.area(did, AREA) : null;
	}

	async read(note: OwnedRef): Promise<NoteDraft | null> {
		const held = (await this.#area()?.get<NoteDraft>(note)) ?? null;
		if (held) this.#hold(note);
		return held;
	}

	last(note: OwnedRef): number {
		return this.#last.get(note) ?? 0;
	}

	keep(note: OwnedRef, draft: NoteDraft, which?: number): number {
		if (which !== undefined && this.last(note) > which) return which;
		const now = ++this.#count;
		this.#last.set(note, now);
		this.#hold(note);
		// The surface hands over its own live rows, so what is written down is a
		// copy taken now rather than whatever they say by the time it lands.
		void this.#area()
			?.set(note, structuredClone(draft))
			.catch(() => undefined);
		return now;
	}

	forget(note: OwnedRef, which?: number): void {
		if (which !== undefined && this.last(note) > which) return;
		this.#last.delete(note);
		this.#rest(note);
		void this.#area()
			?.delete(note)
			.catch(() => undefined);
	}

	landed(note: OwnedRef): void {
		this.#rest(note);
		if (this.#last.has(note)) this.#hold(note);
	}

	/** Whether this device is still holding writing for a note that the server
	 *  has not taken. False while one is simply on its way. */
	waiting(note: OwnedRef): boolean {
		return this.#waiting.has(note);
	}

	#rest(note: OwnedRef): void {
		clearTimeout(this.#holding.get(note));
		this.#holding.delete(note);
		this.#waiting.delete(note);
	}

	#hold(note: OwnedRef): void {
		if (this.#holding.has(note) || this.#waiting.has(note)) return;
		this.#holding.set(
			note,
			setTimeout(() => {
				this.#holding.delete(note);
				this.#waiting.add(note);
			}, WAITING_AFTER_MS)
		);
	}
}

export const drafts = new DraftsStore();
