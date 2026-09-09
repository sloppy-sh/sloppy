/**
 * This shell's half of `Files` in `@sloppy/local`, which declares every method
 * and what its answer means. The commands below live in `src-tauri`; bytes
 * cross as base64 because the bridge carries JSON, and a picture is loaded from
 * the address `url` answers rather than read here.
 */

import { checkPath, joinPath, type Files } from '@sloppy/local';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** The commands `src-tauri` answers. Anything not on this list is not a thing
 *  the shell offers, whatever a caller spells. */
const READ = 'files_read';
const WRITE = 'files_write';
const LIST = 'files_list';
const REMOVE = 'files_remove';
const EXISTS = 'files_exists';
const MKDIR = 'files_mkdir';
const PICK_FOLDER = 'pick_folder';
const DATA_PATH = 'app_data_path';

/** The scheme `src-tauri/src/vault.rs` answers a picture at. */
const VAULT_SCHEME = 'vault';

function decodeBase64(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

class TauriFiles implements Files {
	constructor(
		readonly root: string,
		private readonly call: Invoke,
		private readonly toUrl: (path: string) => string
	) {}

	private where(path: string, allowRoot = false): Record<string, unknown> {
		return { root: this.root, path: checkPath(path, allowRoot) };
	}

	async read(path: string): Promise<Uint8Array | undefined> {
		const held = await this.call<string | null>(READ, this.where(path));
		return held == null ? undefined : decodeBase64(held);
	}

	async write(path: string, bytes: Uint8Array): Promise<void> {
		await this.call<void>(WRITE, { ...this.where(path), bytes: encodeBase64(bytes) });
	}

	async list(path: string): Promise<string[]> {
		return this.call<string[]>(LIST, this.where(path, true));
	}

	async remove(path: string): Promise<void> {
		await this.call<void>(REMOVE, this.where(path));
	}

	async exists(path: string): Promise<boolean> {
		return this.call<boolean>(EXISTS, this.where(path));
	}

	async mkdir(path: string): Promise<void> {
		await this.call<void>(MKDIR, this.where(path, true));
	}

	at(root: string): Files {
		const under = root.startsWith('/') ? root : joinPath(this.root, root);
		return new TauriFiles(under, this.call, this.toUrl);
	}

	url(path: string): string {
		return this.toUrl(joinPath(this.root, checkPath(path)));
	}

	async pickFolder(): Promise<string | undefined> {
		return (await this.call<string | null>(PICK_FOLDER)) ?? undefined;
	}

	async dataPath(): Promise<string> {
		return this.call<string>(DATA_PATH);
	}
}

/** `root` empty is the device's own idea of where it starts; a graph opens by
 *  re-rooting this at the folder somebody picked. */
export function tauriFiles(
	root = '',
	call: Invoke = invoke,
	toUrl: (path: string) => string = (path) => convertFileSrc(path, VAULT_SCHEME)
): Files {
	return new TauriFiles(root, call, toUrl);
}
