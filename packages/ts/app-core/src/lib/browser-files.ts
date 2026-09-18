/**
 * The device's own files as a browser tab reaches them: the folder somebody
 * picked, and this browser's own corner beside it —
 * docs/ARCHITECTURE.md § "A graph on this device, in the browser".
 */

import { checkPath, type Files, joinPath } from '@sloppy/local';
import { EMOJI_DIR, MEDIA_DIR } from '@sloppy/vault';
import { deviceStore } from './device-store.js';

/** The part of a browser's directory handle this reads and writes. A test
 *  hands a stand-in, and a browser's own handle is one. */
export interface FolderHandle {
	readonly name: string;
	getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleHere>;
	getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
	removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
	entries(): AsyncIterable<[string, { readonly kind: string }]>;
}

export interface FileHandleHere {
	getFile(): Promise<Blob>;
	createWritable(options?: { keepExistingData?: boolean }): Promise<WritingHere>;
}

export interface WritingHere {
	write(data: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

/** Where this browser keeps what is nobody's folder: the identity a graph
 *  opened here is written under, and the folder to ask for again. It is
 *  absolute so {@link filesHere} tells it from a folder inside the graph, and
 *  named as nothing a vault writes. */
export const DEVICE_ROOT = '/.this-browser';

/** Not an identity's corner: what is kept here is this browser's own and
 *  outlives whoever signs in, so signing out does not take it. */
const THIS_BROWSER = 'this browser';

/** Chromium asks for a folder once and remembers; neither the picker nor the
 *  two permission calls are in the standard's types yet. */
interface Asking {
	queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
	requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

type Picker = (options?: {
	mode?: 'readwrite';
	id?: string;
	startIn?: string;
}) => Promise<FolderHandle>;

function picker(): Picker | undefined {
	return (globalThis as { showDirectoryPicker?: Picker }).showDirectoryPicker;
}

/** Whether this browser can open a folder at all. A browser without the picker
 *  is offered the archive alone — never asked what it is called. */
export function opensAFolder(): boolean {
	return picker() !== undefined;
}

/** Ask for a folder to read and write in place. `undefined` is somebody who
 *  chose none, which is not a failure. */
export async function askForAFolder(): Promise<FolderHandle | undefined> {
	const ask = picker();
	if (!ask) return undefined;
	try {
		return await ask({ mode: 'readwrite', id: 'sloppy-graph' });
	} catch {
		// Every browser reports a closed picker by throwing, and a person who
		// closed it asked for nothing.
		return undefined;
	}
}

/**
 * Whether this tab may read and write the folder. `ask` is a person who just
 * pressed something, which is the only moment a browser lets one be asked —
 * false on a launch, so nobody is asked for anything they did not begin.
 */
export async function stillAllowed(handle: FolderHandle, ask: boolean): Promise<boolean> {
	const asking = handle as Asking;
	if (!asking.queryPermission || !asking.requestPermission) return true;
	const mode = { mode: 'readwrite' } as const;
	if ((await asking.queryPermission(mode)) === 'granted') return true;
	return ask && (await asking.requestPermission(mode)) === 'granted';
}

function segments(path: string): string[] {
	return path.split('/').filter((one) => one !== '');
}

/** Nothing there, as every one of these methods reads it: a folder that has
 *  not been written yet is the ordinary first run. */
function nothingThere(reason: unknown): boolean {
	return reason instanceof DOMException && reason.name === 'NotFoundError';
}

/**
 * {@link Files} over a folder a person picked in their browser. Read and
 * written in place: nothing is copied anywhere, and nothing leaves the device.
 *
 * {@link Files.url} is answered from addresses this holds for the files a page
 * LOADS rather than reads — pictures and stickers. They cost no memory: an
 * object URL over a file handle is the browser reading the disk, not a copy of
 * it. {@link warm} takes up the ones already in the folder; a file read or
 * written here is taken up as it goes by.
 */
export class DirectoryFiles implements Files {
	/** `root` is a path from the folder somebody picked, and the top of it is
	 *  `/`: what finds the graph in a folder reads the root it is open at, and
	 *  the empty string is no folder at all. */
	constructor(
		private readonly handle: FolderHandle,
		readonly root = '/',
		private readonly loadable: Map<string, string> = new Map()
	) {}

	private full(path: string, allowRoot = false): string {
		return joinPath(this.root, checkPath(path, allowRoot));
	}

	/** The folder at `path`, or `undefined` where it is not there and is not
	 *  being made. */
	private async folderAt(path: string, create: boolean): Promise<FolderHandle | undefined> {
		let at = this.handle;
		for (const name of segments(path)) {
			try {
				at = await at.getDirectoryHandle(name, { create });
			} catch (reason) {
				if (create || !nothingThere(reason)) throw reason;
				return undefined;
			}
		}
		return at;
	}

	/** The folder the file at `path` is in. */
	private folderOf(path: string, create: boolean): Promise<FolderHandle | undefined> {
		return this.folderAt(segments(path).slice(0, -1).join('/'), create);
	}

	private async fileAt(path: string, create: boolean): Promise<FileHandleHere | undefined> {
		const name = segments(path).at(-1);
		if (name === undefined) return undefined;
		const folder = await this.folderOf(path, create);
		if (!folder) return undefined;
		try {
			return await folder.getFileHandle(name, { create });
		} catch (reason) {
			if (create || !nothingThere(reason)) throw reason;
			return undefined;
		}
	}

	async read(path: string): Promise<Uint8Array | undefined> {
		const at = this.full(path);
		const file = await this.fileAt(at, false);
		if (!file) return undefined;
		const held = await file.getFile();
		this.hold(at, held);
		return new Uint8Array(await held.arrayBuffer());
	}

	async write(path: string, bytes: Uint8Array): Promise<void> {
		const at = this.full(path);
		const file = await this.fileAt(at, true);
		if (!file) return;
		const writing = await file.createWritable();
		try {
			await writing.write(bytes);
		} finally {
			await writing.close();
		}
		this.hold(at, await file.getFile());
	}

	async list(path: string): Promise<string[]> {
		const under = joinPath(this.root, checkPath(path, true));
		const found: string[] = [];
		await this.walk(under, found);
		// `joinPath` drops a root's trailing slash, so the top of the folder is
		// one character and not two.
		const cut = this.root === '' ? 0 : this.root.replace(/\/+$/, '').length + 1;
		return found.map((one) => one.slice(cut));
	}

	private async walk(under: string, found: string[]): Promise<void> {
		const at = await this.folderAt(under, false);
		if (!at) return;
		for await (const [name, entry] of at.entries()) {
			const here = joinPath(under, name);
			if (entry.kind === 'directory') await this.walk(here, found);
			else found.push(here);
		}
	}

	async remove(path: string): Promise<void> {
		const at = this.full(path);
		const name = segments(at).at(-1);
		const folder = await this.folderOf(at, false);
		if (!folder || name === undefined) return;
		try {
			await folder.removeEntry(name);
		} catch (reason) {
			if (!nothingThere(reason)) throw reason;
		}
		this.letGo(at);
	}

	async exists(path: string): Promise<boolean> {
		return (await this.fileAt(this.full(path), false)) !== undefined;
	}

	async mkdir(path: string): Promise<void> {
		await this.folderAt(this.full(path, true), true);
	}

	at(root: string): Files {
		return new DirectoryFiles(
			this.handle,
			root.startsWith('/') ? root : joinPath(this.root, root),
			this.loadable
		);
	}

	url(path: string): string {
		// A file this tab has neither read nor taken up is not an address yet,
		// and an <img> given this one shows the picture it cannot find.
		return this.loadable.get(this.full(path)) ?? 'data:,';
	}

	/** Take up the files a page loads by address, which are the ones already in
	 *  the folder when it is opened. */
	async warm(): Promise<void> {
		for (const dir of [MEDIA_DIR, EMOJI_DIR]) {
			for (const path of await this.list(dir).catch(() => [])) {
				const at = this.full(path);
				const file = await this.fileAt(at, false).catch(() => undefined);
				if (file) this.hold(at, await file.getFile());
			}
		}
	}

	/** Every address this folder handed out, given up. Called when the graph is
	 *  closed: an object URL outlives the page otherwise. */
	release(): void {
		for (const [, at] of this.loadable) URL.revokeObjectURL(at);
		this.loadable.clear();
	}

	private hold(at: string, file: Blob): void {
		this.letGo(at);
		this.loadable.set(at, URL.createObjectURL(file));
	}

	private letGo(at: string): void {
		const held = this.loadable.get(at);
		if (held === undefined) return;
		URL.revokeObjectURL(held);
		this.loadable.delete(at);
	}

	/** A tab has no path to name a folder by, so the doors hand a handle over
	 *  instead — {@link askForAFolder}. */
	async pickFolder(): Promise<string | undefined> {
		return undefined;
	}

	async dataPath(): Promise<string> {
		return DEVICE_ROOT;
	}
}

/** {@link Files} over what this browser keeps for itself, which is a handful of
 *  small files and no folder anybody picked. */
class BrowserOwnFiles implements Files {
	private readonly area = deviceStore.area(THIS_BROWSER, 'files');

	constructor(readonly root = '') {}

	private full(path: string, allowRoot = false): string {
		return joinPath(this.root, checkPath(path, allowRoot));
	}

	async read(path: string): Promise<Uint8Array | undefined> {
		const held = await this.area.get<Uint8Array>(this.full(path));
		return held === undefined ? undefined : new Uint8Array(held);
	}

	async write(path: string, bytes: Uint8Array): Promise<void> {
		await this.area.set(this.full(path), new Uint8Array(bytes));
	}

	async list(path: string): Promise<string[]> {
		const under = joinPath(this.root, checkPath(path, true));
		const prefix = under === '' ? '' : `${under}/`;
		const cut = this.root === '' ? 0 : this.root.length + 1;
		return (await this.area.keys())
			.filter((key) => key.startsWith(prefix))
			.map((key) => key.slice(cut));
	}

	async remove(path: string): Promise<void> {
		await this.area.delete(this.full(path));
	}

	async exists(path: string): Promise<boolean> {
		return (await this.area.get(this.full(path))) !== undefined;
	}

	async mkdir(path: string): Promise<void> {
		checkPath(path, true);
	}

	at(root: string): Files {
		return new BrowserOwnFiles(root.startsWith('/') ? root.slice(1) : joinPath(this.root, root));
	}

	url(): string {
		// Nothing kept here is a picture on a page.
		return 'data:,';
	}

	async pickFolder(): Promise<string | undefined> {
		return undefined;
	}

	async dataPath(): Promise<string> {
		return DEVICE_ROOT;
	}
}

/** Where the folder to ask for again and the identity a graph is written under
 *  are kept: this browser's own corner, in no folder of anybody's. */
export function browserOwnFiles(): Files {
	return new BrowserOwnFiles();
}

/** What this browser was told to open again, `undefined` before it has been
 *  told anything — which is the first visit, and a browser that keeps nothing
 *  between them. */
export async function rememberedFolder(): Promise<FolderHandle | undefined> {
	try {
		return await deviceStore.area(THIS_BROWSER, 'folder').get<FolderHandle>('open');
	} catch {
		return undefined;
	}
}

/** Ask for this folder rather than the picker on the next visit. A browser
 *  that will not keep a handle loses nothing but the asking. */
export async function rememberFolder(handle: FolderHandle | null): Promise<void> {
	const area = deviceStore.area(THIS_BROWSER, 'folder');
	try {
		if (handle === null) await area.delete('open');
		else await area.set('open', handle);
	} catch {
		// Being asked for the folder again is the whole of what is lost.
	}
}

/**
 * The graph in front of somebody in this tab, with this browser's own corner
 * beside it. Everything a graph is made of goes to `graph`; what is nobody's
 * folder — the identity a write here carries, the graphs this browser knows —
 * goes to `own`, because a private key does not belong in somebody's notes.
 */
export function filesHere(graph: Files, own: Files): Files {
	const here: Files = {
		root: graph.root,
		read: (path) => graph.read(path),
		write: (path, bytes) => graph.write(path, bytes),
		list: (path) => graph.list(path),
		remove: (path) => graph.remove(path),
		exists: (path) => graph.exists(path),
		mkdir: (path) => graph.mkdir(path),
		url: (path) => graph.url(path),
		pickFolder: () => graph.pickFolder(),
		dataPath: async () => DEVICE_ROOT,
		at: (root) => {
			if (root === DEVICE_ROOT) return own;
			if (root.startsWith(`${DEVICE_ROOT}/`)) return own.at(root.slice(DEVICE_ROOT.length + 1));
			return filesHere(graph.at(root), own);
		}
	};
	return here;
}
