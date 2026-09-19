// A stand-in for the folder a browser hands over, so what reads and writes one
// can be exercised without a browser.

import { LocalApi, MemoryFiles } from '@sloppy/local';
import type { FileHandleHere, FolderHandle, WritingHere } from './browser-files.js';

/** A folder and everything under it, as one map of path to bytes — the shape a
 *  vault is already held in everywhere else. */
export type Held = Map<string, Uint8Array>;

/** A folder holding a graph with one note in it. A real `LocalApi` writes it,
 *  so the files are the ones the app reads back. */
export async function aGraphFolder(title = 'The garden'): Promise<Held> {
	const store = new Map<string, Uint8Array>();
	const at = '/the-folder';
	const writing = new LocalApi(new MemoryFiles({ store, folder: at, data: '/elsewhere' }));
	await writing.createGraph({ title });
	await writing.createNode({ title: 'One' });
	return new Map(
		[...store]
			.filter(([path]) => path.startsWith(`${at}/`))
			.map(([path, bytes]) => [path.slice(at.length + 1), bytes])
	);
}

class NotThere extends DOMException {
	constructor(name: string) {
		super(`No such entry: ${name}`, 'NotFoundError');
	}
}

function fileIn(held: Held, path: string): FileHandleHere {
	return {
		async getFile() {
			const bytes = held.get(path) ?? new Uint8Array();
			return new Blob([new Uint8Array(bytes)]);
		},
		async createWritable(): Promise<WritingHere> {
			let written: Uint8Array = new Uint8Array();
			return {
				async write(data: Uint8Array) {
					written = data;
				},
				async close() {
					held.set(path, written);
				}
			};
		}
	};
}

/** The folder at `under`, reading and writing `held`. `named` is what the
 *  browser would call the folder somebody picked. */
export function fakeFolder(held: Held = new Map(), under = '', named = 'garden'): FolderHandle {
	const at = (name: string) => (under === '' ? name : `${under}/${name}`);
	const directlyUnder = (): Map<string, 'file' | 'directory'> => {
		const prefix = under === '' ? '' : `${under}/`;
		const seen = new Map<string, 'file' | 'directory'>();
		for (const path of held.keys()) {
			if (!path.startsWith(prefix)) continue;
			const rest = path.slice(prefix.length);
			const cut = rest.indexOf('/');
			if (cut === -1) seen.set(rest, 'file');
			else seen.set(rest.slice(0, cut), 'directory');
		}
		return seen;
	};
	return {
		name: named,
		async getFileHandle(name, options) {
			if (options?.create) return fileIn(held, at(name));
			if (directlyUnder().get(name) !== 'file') throw new NotThere(name);
			return fileIn(held, at(name));
		},
		async getDirectoryHandle(name, options) {
			// A folder with nothing in it is not a thing a map can hold, so one
			// being made is answered with and written the moment a file lands in it.
			if (!options?.create && directlyUnder().get(name) !== 'directory') {
				throw new NotThere(name);
			}
			return fakeFolder(held, at(name), name);
		},
		async removeEntry(name) {
			const kind = directlyUnder().get(name);
			if (kind === undefined) throw new NotThere(name);
			if (kind === 'file') held.delete(at(name));
			else for (const path of held.keys()) if (path.startsWith(`${at(name)}/`)) held.delete(path);
		},
		entries() {
			const listed = [...directlyUnder()].map(
				([name, kind]) => [name, { kind }] as [string, { kind: string }]
			);
			return {
				async *[Symbol.asyncIterator]() {
					for (const entry of listed) yield entry;
				}
			};
		}
	};
}
