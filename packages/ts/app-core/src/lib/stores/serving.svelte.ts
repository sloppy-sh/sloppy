/**
 * The folders open here, served read-only to a headset —
 * docs/ARCHITECTURE.md § "A headset beside the desk". The shell pairs and
 * carries ({@link ServeAccess}); every line is answered here, by
 * `servingProjects` in `@sloppy/local`, the look this desk is wearing with them.
 */

import { namedProjects, type ProjectsServing, servingProjects } from '@sloppy/local';
import { SERVE_REACHES, type ServeReach, type Serving } from '@sloppy/types';
import { lookServed } from '../look-file.js';
import { shrinkPicture } from '../picture-shrink.js';
import type { ServeAccess } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { servedClosed, servedMethods } from '../serving/methods.js';
import '../serving/served.js';
import { folderName } from './tabs.svelte.js';

/** What a surface says where this platform cannot serve. */
export const SERVED_ELSEWHERE =
	'Serving to a headset is done from the Sloppy app on a computer or tablet.';

/** What this desk calls itself to a headset that asks. */
const SERVED_VERSION = '1';

/** How often what is served is read again while serving, in milliseconds. */
const STATUS_EVERY = 1000;

/** Where this device keeps how far it serves. */
const KEPT_KEY = 'sloppy_serve';

/** How far this device serves, the relay a person named for `anywhere`, and
 *  whether it serves again when Sloppy opens. */
export interface ServeChoice {
	reach: ServeReach;
	/** Kept whatever the reach, and served by only in `anywhere`. **Absent is
	 *  the public relays.** */
	relay?: string;
	/** Set by turning serving on, cleared only by turning it off. **Absent is
	 *  off.** */
	on?: boolean;
}

/** What is said where serving that was left on could not start again. */
const NOT_AGAIN = 'Serving to a headset did not start again. Turn it on to try again.';

/** Storage can throw outright (a private window, blocked site data), and what
 *  it held can be anything; either is the default. */
function readChoice(): ServeChoice {
	try {
		const held: unknown = JSON.parse(localStorage.getItem(KEPT_KEY) ?? 'null');
		if (typeof held !== 'object' || held === null) return { reach: 'local' };
		const { reach, relay, on } = held as Record<string, unknown>;
		if (!SERVE_REACHES.includes(reach as ServeReach)) return { reach: 'local' };
		return {
			reach: reach as ServeReach,
			...(typeof relay === 'string' && relay !== '' ? { relay } : {}),
			...(on === true ? { on } : {})
		};
	} catch {
		return { reach: 'local' };
	}
}

class ServingState {
	/** What is served, the code shown and the paired headsets with it;
	 *  undefined while nothing is served. */
	serving = $state<Serving | undefined>(undefined);
	/** Where storage refused it, the choice for this session; otherwise read
	 *  from storage, `kept` saying when it was written again. */
	#choice = $state<ServeChoice | undefined>(undefined);
	#kept = $state(0);
	/** Why serving left on is not serving now; undefined once somebody turns
	 *  the switch either way. */
	says = $state<string | undefined>(undefined);
	#loop: ProjectsServing | null = null;
	#drops: (() => void)[] = [];
	/** Every connection a line has come on that has not been told closed. */
	#heard = new Set<string>();

	/** Whether this platform can serve at all. */
	get possible(): boolean {
		return seam().serve() !== undefined;
	}

	/** How far this device serves, kept on it; `local` until somebody chooses. */
	get choice(): ServeChoice {
		void this.#kept;
		return this.#choice ?? readChoice();
	}

	/** Keep how far this device serves, and serve that far at once where it is
	 *  serving. REJECTS with words. */
	async choose(reach: ServeReach, relay?: string): Promise<void> {
		const named = relay?.trim();
		this.#keep({
			reach,
			...(named ? { relay: named } : {}),
			...(this.choice.on ? { on: true } : {})
		});
		if (this.serving) await this.start();
	}

	/** Serve again where serving was left on and is not serving now — called
	 *  once the shell's folders can be asked for. A failure is kept in
	 *  {@link says}. */
	async resume(): Promise<void> {
		if (this.serving || !this.possible || !this.choice.on) return;
		try {
			await this.start();
		} catch (thrown) {
			this.says = thrown instanceof Error && thrown.message ? thrown.message : NOT_AGAIN;
		}
	}

	#keep(choice: ServeChoice): void {
		try {
			localStorage.setItem(KEPT_KEY, JSON.stringify(choice));
			this.#choice = undefined;
		} catch {
			this.#choice = choice;
		}
		this.#kept++;
	}

	#keepOn(on: boolean): void {
		const { reach, relay } = this.choice;
		this.#keep({ reach, ...(relay === undefined ? {} : { relay }), ...(on ? { on } : {}) });
	}

	/** Headsets connected now. */
	get connections(): number {
		return this.serving?.connections ?? 0;
	}

	/** Serve every folder open here as far as `reach`, from now until
	 *  {@link stop}. Starting while serving at the same reach answers what is
	 *  already served. REJECTS with words. */
	async start(
		reach: ServeReach = this.choice.reach,
		relay = reach === 'anywhere' ? this.choice.relay : undefined
	): Promise<Serving> {
		const access = seam().serve();
		if (!access) throw new Error(SERVED_ELSEWHERE);
		if (this.serving && this.serving.reach === reach && this.serving.relay === relay) {
			return this.serving;
		}
		this.#letGo();
		this.#serveTabs();
		this.#drops.push(
			access.calls((call) => {
				if (this.#loop !== null) this.#heard.add(call.connection);
				this.#loop?.take(
					call.line,
					(line) => {
						void access.answer(call.connection, line).catch(() => {});
					},
					call.connection
				);
			}),
			access.closed((connection) => {
				if (this.#heard.delete(connection)) this.#loop?.closed(connection);
			})
		);
		const tabs = seam().tabs();
		if (tabs) this.#drops.push(tabs.changed(() => this.#serveTabs()));
		const reading = setInterval(() => void this.#read(access), STATUS_EVERY);
		this.#drops.push(() => clearInterval(reading));
		try {
			this.serving = await access.start(reach, relay);
		} catch (thrown) {
			this.#letGo();
			this.serving = undefined;
			throw thrown;
		}
		this.says = undefined;
		this.#keepOn(true);
		return this.serving;
	}

	/** Show a fresh code a headset can pair by, in place of any shown before.
	 *  REJECTS with words. */
	async pair(): Promise<Serving> {
		const access = seam().serve();
		if (!access) throw new Error(SERVED_ELSEWHERE);
		const now = await access.pair();
		if (this.#loop !== null) this.serving = now;
		return now;
	}

	/** Stop serving; every headset is let go. */
	async stop(): Promise<void> {
		const access = seam().serve();
		this.#letGo();
		this.serving = undefined;
		this.says = undefined;
		this.#keepOn(false);
		await access?.stop();
	}

	/** Forget a paired headset, so it pairs by the code again. REJECTS with words. */
	async forget(id: string): Promise<void> {
		const access = seam().serve();
		if (!access) throw new Error(SERVED_ELSEWHERE);
		await access.forget(id);
		await this.#read(access);
	}

	async #read(access: ServeAccess): Promise<void> {
		if (this.#loop === null) return;
		const now = await access.status().catch(() => this.serving);
		if (this.#loop !== null) this.serving = now;
	}

	/** The folders open now, each by its folder's name — the tabs, or the one
	 *  folder a shell holding no tabs has open. A call already asked is answered
	 *  from the loop it was asked of. */
	#serveTabs(): void {
		const tabs = seam().tabs();
		const one = seam().vault()?.folder();
		const roots = tabs ? tabs.held().open : one === undefined ? [] : [one];
		const placeFiles = seam().placeFiles();
		this.#loop = servingProjects(
			namedProjects(
				roots.map((root) => {
					const files = placeFiles?.(root);
					return {
						name: folderName(root),
						server: {
							version: SERVED_VERSION,
							shrink: shrinkPicture,
							...(files === undefined ? {} : { files })
						}
					};
				})
			),
			{ look: lookServed, methods: servedMethods, closed: servedClosed }
		);
	}

	/** Letting go ends every connection with it, whether or not the shell
	 *  reports each one closed. */
	#letGo(): void {
		for (const drop of this.#drops.splice(0)) drop();
		for (const connection of this.#heard) this.#loop?.closed(connection);
		this.#heard.clear();
		this.#loop = null;
	}
}

export const serving = new ServingState();
