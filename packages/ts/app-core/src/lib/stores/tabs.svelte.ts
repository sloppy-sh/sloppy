/**
 * The folders open at once, which of them is in front of somebody, and the one
 * act that puts another there — docs/ARCHITECTURE.md § "Several folders open at
 * once".
 *
 * **A tab switch IS the folder switch this app has always done**, plus the
 * memory of how each folder was being read. So nothing here multiplexes a
 * surface: {@link TabsState.switchTo} tells the page to snapshot what it has,
 * asks the store to serve the other folder, and tells the page to come back to
 * what was kept for it. A shell whose seam holds no `TabsAccess` still
 * switches this way and shows no strip, because there is only ever one folder
 * to show.
 */

import type { OpenTabs } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { graphs } from './graphs.svelte.js';
import { prefs } from './prefs.svelte.js';

/** The page in front of the folder, as a switch asks it to behave. */
export interface TabPage {
	/** A SNAPSHOT of how `root` is being read, and nothing else — it may run and
	 *  then nothing open. */
	leaving(root: string): void;
	/** The folder in front of somebody is now `root`: let go of what was read
	 *  and bring `root` back as it was left. */
	arrived(root: string): void;
}

/** What a person called the folder, for one no graph names. */
export function folderName(root: string): string {
	return root.split(/[\\/]/).filter(Boolean).at(-1) ?? root;
}

/** One of the folders open, as a strip across the top shows it. */
export interface TabRow {
	root: string;
	name: string;
	active: boolean;
}

class TabsState {
	#open = $state.raw<readonly string[]>([]);
	#active = $state<string | undefined>(undefined);
	#page: TabPage | null = null;
	#booted = false;
	#drop: (() => void) | null = null;
	#turn: Promise<unknown> = Promise.resolve();

	get open(): readonly string[] {
		return this.#open;
	}

	get active(): string | undefined {
		return this.#active;
	}

	/** Two or more folders open is the only time there is anything to tell
	 *  apart. */
	get shows(): boolean {
		return this.#open.length > 1;
	}

	/** For a strip: root, what the folder is called, and whether it is the one
	 *  in front. In {@link TabsState.open} order. */
	get rows(): readonly TabRow[] {
		return this.#open.map((root) => {
			const known = graphs.folders.find((one) => one.root === root);
			return {
				root,
				name: known?.graph?.name.trim() || folderName(root),
				active: root === this.#active
			};
		});
	}

	/** Read what the shell holds and keep hearing it. Idempotent; the frame
	 *  calls it once. */
	boot(): void {
		if (this.#booted) return;
		this.#booted = true;
		const access = seam().tabs();
		if (!access) return;
		this.#take(access.held());
		this.#drop = access.changed((tabs) => this.#take(tabs));
	}

	/** Put `root` in front. Already in front is nothing. Calls serialize. */
	switchTo(root: string): Promise<void> {
		return this.#inTurn(async () => {
			const was = this.#inFront;
			if (was === root) return;
			if (was !== undefined) this.#page?.leaving(was);
			await graphs.enterFolder(root);
			this.#page?.arrived(root);
		});
	}

	/** Open through whatever `open` does — the picker, a project, a clone — with
	 *  the same leaving and arriving around it. `false` from `open` is somebody
	 *  who chose nothing, and nothing more happens. */
	openWith(open: () => Promise<boolean>): Promise<boolean> {
		return this.#inTurn(async () => {
			const was = this.#inFront;
			if (was !== undefined) this.#page?.leaving(was);
			if (!(await open())) return false;
			const now = this.#inFront;
			if (now !== undefined) this.#page?.arrived(now);
			return true;
		});
	}

	/** Take a folder off, and with it what was kept of how it was read. Where the
	 *  shell holds no tabs, nothing. */
	close(root: string): Promise<void> {
		const access = seam().tabs();
		if (!access) return Promise.resolve();
		return this.#inTurn(async () => {
			// Closing the only one is refused, so nothing of the folder's is given
			// up before the shell has taken it off.
			const last = this.#open.length < 2;
			const front = !last && this.#active === root;
			if (front) this.#page?.leaving(root);
			if (!last) prefs.setView(root, null);
			await access.close(root);
			if (!front) return;
			const now = this.#active;
			if (now !== undefined) this.#page?.arrived(now);
		});
	}

	/** The page in front of the folder says how it leaves and arrives. One at a
	 *  time; returns the disposer. */
	serves(page: TabPage): () => void {
		this.#page = page;
		return () => {
			if (this.#page === page) this.#page = null;
		};
	}

	/** What the shell said is given up, and it is asked again on the next
	 *  {@link TabsState.boot}. The page serving the folder is still the one
	 *  serving it. */
	clear(): void {
		this.#drop?.();
		this.#drop = null;
		this.#booted = false;
		this.#open = [];
		this.#active = undefined;
	}

	/** The folder being left: the one the shell says is in front where it holds
	 *  tabs, and the only folder open where it does not. */
	get #inFront(): string | undefined {
		return this.#active ?? graphs.openFolder;
	}

	#take(tabs: OpenTabs): void {
		this.#open = [...tabs.open];
		this.#active = tabs.active;
	}

	/** One switch at a time: two of them overlapping would snapshot a folder the
	 *  other has already served away. */
	#inTurn<T>(act: () => Promise<T>): Promise<T> {
		const next = this.#turn.then(act, act);
		this.#turn = next.catch(() => undefined);
		return next;
	}
}

export const tabs = new TabsState();
