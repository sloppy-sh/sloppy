/**
 * What the versions kept in the folder in front of somebody are by, how they
 * are signed, where else the folder is kept and what this device was given to
 * get in there.
 *
 * `History` in `@sloppy/local` declares every act and what its answer means;
 * `GitDefaultsAccess` and `CredentialsAccess` beside it are what a new folder
 * inherits and what stays on this device. Absent is a platform that can be told
 * none of it, and {@link GitSettingsStore.offers} is false.
 */

import type {
	Credential,
	GitUser,
	HeldCredential,
	History,
	Remote,
	SigningConfig
} from '@sloppy/local';
import { runtime } from '../runtime.js';
import { serverMessage } from './errors.js';

/** Somewhere else the folder is kept, with what this device has to get in
 *  there. `host` absent is an address with nowhere to sign in to — another
 *  folder on this same device — and `credential` absent is a host this device
 *  was given nothing for. */
export interface PlaceKept extends Remote {
	host?: string;
	credential?: Credential;
}

/** The acts a shell that can be told any of this has. */
type HistoryTold = Required<
	Pick<
		History,
		| 'gitUser'
		| 'setGitUser'
		| 'signing'
		| 'setSigning'
		| 'remotes'
		| 'addRemote'
		| 'renameRemote'
		| 'setRemoteUrl'
		| 'removeRemote'
	>
>;

/** The history in front of somebody where it answers all of these, and nothing
 *  where it answers none — the interface says a shell that defines one of them
 *  defines all, and this is where that is taken at its word. */
function told(): HistoryTold | undefined {
	const history = runtime.history();
	if (
		!history?.gitUser ||
		!history.setGitUser ||
		!history.signing ||
		!history.setSigning ||
		!history.remotes ||
		!history.addRemote ||
		!history.renameRemote ||
		!history.setRemoteUrl ||
		!history.removeRemote
	) {
		return undefined;
	}
	return history as HistoryTold;
}

/**
 * Whether another program on this device can be run at all. A webview on a
 * phone or a tablet cannot start one, so an OpenPGP program is a desktop's
 * alone and the offer of one says so there.
 */
export function onADesktop(): boolean {
	if (typeof navigator === 'undefined') return false;
	const said = navigator.userAgent;
	if (/Android|iPhone|iPad|iPod/.test(said)) return false;
	// iPadOS says Macintosh; a screen that takes several fingers is what tells
	// the two apart.
	return !(/Macintosh/.test(said) && navigator.maxTouchPoints > 1);
}

/** `@sloppy/local` reads a folder, and a page that never opens one should not
 *  carry it. */
async function local() {
	return import('@sloppy/local');
}

/** The words an act came back with. A history refuses in words fit to show. */
function said(err: unknown): string {
	const words = serverMessage(err);
	if (words) return words;
	if (err instanceof Error && err.message) return err.message;
	return 'That did not work. Try again in a moment.';
}

class GitSettingsStore {
	#user = $state<GitUser | undefined>(undefined);
	#signing = $state<SigningConfig>({ kind: 'none' });
	#places = $state<PlaceKept[]>([]);
	#busy = $state(false);
	#says = $state<string | null>(null);
	#epoch = 0;

	/** Whether this platform can be told any of it. */
	get offers(): boolean {
		return told() !== undefined;
	}

	/** Whether this device holds what a host asks for. */
	get holdsWaysIn(): boolean {
		return runtime.credentials() !== undefined;
	}

	get busy(): boolean {
		return this.#busy;
	}

	/** Why the last act did not happen, in the words it gave. */
	get says(): string | null {
		return this.#says;
	}

	/** Who the versions kept here are by; `undefined` is a folder nobody has
	 *  said for, where the graph's owner stands in. */
	get user(): GitUser | undefined {
		return this.#user;
	}

	get signing(): SigningConfig {
		return this.#signing;
	}

	/** The public half of the key this app keeps, where that is what signs here:
	 *  the one line a host takes. `undefined` until the shell has answered with
	 *  one. */
	get keptKey(): string | undefined {
		const signing = this.#signing;
		if (signing.kind !== 'ssh' || signing.key.kind !== 'kept') return undefined;
		return signing.publicKey;
	}

	get places(): readonly PlaceKept[] {
		return this.#places;
	}

	/** How many of the places kept are reached at that host, which is how many a
	 *  way in serves. */
	placesAt(host: string): number {
		return this.#places.filter((place) => place.host === host).length;
	}

	clear(): void {
		this.#epoch += 1;
		this.#user = undefined;
		this.#signing = { kind: 'none' };
		this.#places = [];
		this.#busy = false;
		this.#says = null;
	}

	/** Everything the surface shows, and the way in this device holds for each
	 *  place beside it. */
	async read(): Promise<void> {
		const history = told();
		if (!history) return;
		const at = ++this.#epoch;
		this.#busy = true;
		this.#says = null;
		try {
			const [user, signing, remotes, held] = await Promise.all([
				history.gitUser(),
				history.signing(),
				history.remotes(),
				runtime.credentials()?.list() ?? Promise.resolve<HeldCredential[]>([])
			]);
			const { credentialFor, remoteHost } = await local();
			if (at !== this.#epoch) return;
			this.#user = user;
			this.#signing = signing;
			this.#places = remotes.map((remote) => {
				const host = remoteHost(remote.url);
				const credential = credentialFor(held, remote.url);
				return {
					...remote,
					...(host === undefined ? {} : { host }),
					...(credential === undefined ? {} : { credential })
				};
			});
		} catch (err) {
			if (at === this.#epoch) this.#says = said(err);
		} finally {
			if (at === this.#epoch) this.#busy = false;
		}
	}

	/** Who the versions kept here are by, for this folder — and what the next
	 *  folder started on this device begins with. */
	async setUser(user: GitUser): Promise<boolean> {
		return this.act(async (history) => {
			await history.setGitUser(user);
			const defaults = runtime.gitDefaults();
			if (defaults) await defaults.write({ ...(await defaults.read()), user });
		});
	}

	/**
	 * Begin a folder started or brought onto this device with what the last one
	 * was told, for a folder that names nobody and signs with nothing of its
	 * own. Nobody asked for it, so it says nothing either way: Settings is
	 * where a person sees what it left and changes it.
	 */
	async beginFolder(): Promise<void> {
		const history = told();
		if (!history) return;
		try {
			const defaults = await runtime.gitDefaults()?.read();
			if (!defaults) return;
			if (defaults.user && !(await history.gitUser())) await history.setGitUser(defaults.user);
			if (defaults.signing && (await history.signing()).kind === 'none') {
				await history.setSigning(defaults.signing);
			}
		} catch {
			return;
		}
		await this.read();
	}

	/** How the versions kept here are signed, for this folder and for the next
	 *  one started on this device. */
	async signWith(config: SigningConfig): Promise<boolean> {
		return this.act(async (history) => {
			await history.setSigning(config);
			const defaults = runtime.gitDefaults();
			if (defaults) await defaults.write({ ...(await defaults.read()), signing: config });
		});
	}

	async addPlace(name: string, url: string): Promise<boolean> {
		return this.act((history) => history.addRemote(name, url));
	}

	async renamePlace(name: string, to: string): Promise<boolean> {
		return this.act((history) => history.renameRemote(name, to));
	}

	async setPlaceAddress(name: string, url: string): Promise<boolean> {
		return this.act((history) => history.setRemoteUrl(name, url));
	}

	async removePlace(name: string): Promise<boolean> {
		return this.act((history) => history.removeRemote(name));
	}

	/** Hold what a host asks for, in place of whatever was held for it. */
	async holdWayIn(host: string, credential: Credential): Promise<boolean> {
		return this.act(async () => {
			await runtime.credentials()?.hold(host, credential);
		});
	}

	async forgetWayIn(host: string): Promise<boolean> {
		return this.act(async () => {
			await runtime.credentials()?.forget(host);
		});
	}

	/** An act, with what it refuses in the words it gave, and everything read
	 *  again after it. */
	private async act(what: (history: HistoryTold) => Promise<void>): Promise<boolean> {
		const history = told();
		if (!history) return false;
		this.#busy = true;
		this.#says = null;
		try {
			await what(history);
			await this.read();
			return true;
		} catch (err) {
			this.#says = said(err);
			return false;
		} finally {
			this.#busy = false;
		}
	}
}

export const gitSettings = new GitSettingsStore();
