/**
 * This shell's half of `Files` in `@sloppy/local`, which declares every method
 * and what its answer means. The commands below live in `src-tauri`; bytes
 * cross as base64 because the bridge carries JSON, and a picture is loaded from
 * the address `url` answers rather than read here.
 */

import {
	checkPath,
	joinPath,
	type Branch,
	type Commit,
	type CommitGraphPage,
	type CommitPage,
	type ConflictSide,
	type Credential,
	type Files,
	type FolderAsked,
	type GitUser,
	type History,
	HistoryError,
	type HistoryStatus,
	type MergeResult,
	type Remote,
	type SigningConfig
} from '@sloppy/local';
import type { Vault } from '@sloppy/vault';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { readsPicked } from './places';

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
const PICK_FILE = 'pick_file';
const SAVE_FILE = 'save_file';
const DATA_PATH = 'app_data_path';
const HISTORY_STATUS = 'history_status';
const HISTORY_LOG = 'history_log';
const HISTORY_COMMIT = 'history_commit';
const HISTORY_BRANCHES = 'history_branches';
const HISTORY_BRANCH = 'history_branch';
const HISTORY_SWITCH = 'history_switch';
const HISTORY_STAND_ON = 'history_stand_on';
const HISTORY_LINE_HERE = 'history_line_here';
const HISTORY_RENAME_LINE = 'history_rename_line';
const HISTORY_ABANDON_MERGE = 'history_abandon_merge';
const HISTORY_MERGE = 'history_merge';
const HISTORY_RESOLVE = 'history_resolve';
const HISTORY_READ_AT = 'history_read_at';
const HISTORY_HEAD = 'history_head';
const HISTORY_CHANGED_SINCE = 'history_changed_since';
const HISTORY_GRAPH = 'history_graph';
const HISTORY_BRANCH_AT = 'history_branch_at';
const HISTORY_DELETE_BRANCH = 'history_delete_branch';
const HISTORY_GIT_USER = 'history_git_user';
const HISTORY_SET_GIT_USER = 'history_set_git_user';
const HISTORY_SIGNING = 'history_signing';
const HISTORY_SET_SIGNING = 'history_set_signing';
const HISTORY_REMOTES = 'history_remotes';
const HISTORY_ADD_REMOTE = 'history_add_remote';
const HISTORY_RENAME_REMOTE = 'history_rename_remote';
const HISTORY_SET_REMOTE_URL = 'history_set_remote_url';
const HISTORY_REMOVE_REMOTE = 'history_remove_remote';
const HISTORY_FETCH = 'history_fetch';
const HISTORY_PULL = 'history_pull';
const HISTORY_PUSH = 'history_push';
const CLONE = 'files_clone';

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

	async pickFolder(asking: FolderAsked = 'graph'): Promise<string | undefined> {
		const picked = (await this.call<string | null>(PICK_FOLDER, { asking })) ?? undefined;
		if (picked !== undefined) await readsPicked(this.call);
		return picked;
	}

	async clone(url: string, into: string, credential?: Credential): Promise<void> {
		try {
			await this.call<void>(CLONE, { url, into, credential: credential ?? null });
		} catch (reason) {
			throw refusal(reason);
		}
	}

	async dataPath(): Promise<string> {
		return this.call<string>(DATA_PATH);
	}
}

/** An act `src-tauri` would not take. The bridge carries JSON, so what it
 *  answers is the sentence itself rather than the error `History` promises. */
export function refusal(reason: unknown): HistoryError {
	if (reason instanceof HistoryError) return reason;
	if (typeof reason === 'string') return new HistoryError(reason);
	return new HistoryError('That did not work. Try again.');
}

/**
 * This shell's half of `History` in `@sloppy/local`, which declares every act
 * and what its answer means. The commands answer for the folder `root` names,
 * and land in `src-tauri` with the History surface itself.
 */
class TauriHistory implements History {
	constructor(
		private readonly root: string,
		private readonly call: Invoke
	) {}

	private async asked<T>(command: string, args: Record<string, unknown>): Promise<T> {
		try {
			return await this.call<T>(command, args);
		} catch (reason) {
			throw refusal(reason);
		}
	}

	async status(): Promise<HistoryStatus> {
		return this.asked<HistoryStatus>(HISTORY_STATUS, { root: this.root });
	}

	async log(limit: number, cursor?: string): Promise<CommitPage> {
		return this.asked<CommitPage>(HISTORY_LOG, { root: this.root, limit, cursor: cursor ?? null });
	}

	async commit(message: string): Promise<Commit | undefined> {
		return (
			(await this.asked<Commit | null>(HISTORY_COMMIT, { root: this.root, message })) ?? undefined
		);
	}

	async branches(): Promise<Branch[]> {
		return this.asked<Branch[]>(HISTORY_BRANCHES, { root: this.root });
	}

	async branch(name: string): Promise<Branch> {
		return this.asked<Branch>(HISTORY_BRANCH, { root: this.root, name });
	}

	async switch(name: string): Promise<void> {
		await this.asked<void>(HISTORY_SWITCH, { root: this.root, name });
	}

	async standOn(commit: string, carrying?: boolean): Promise<void> {
		await this.asked<void>(HISTORY_STAND_ON, {
			root: this.root,
			commit,
			carrying: carrying ?? false
		});
	}

	async lineHere(name: string): Promise<Branch> {
		return this.asked<Branch>(HISTORY_LINE_HERE, { root: this.root, name });
	}

	async renameLine(from: string, to: string): Promise<Branch> {
		return this.asked<Branch>(HISTORY_RENAME_LINE, { root: this.root, from, to });
	}

	async abandonMerge(): Promise<void> {
		await this.asked<void>(HISTORY_ABANDON_MERGE, { root: this.root });
	}

	async merge(name: string): Promise<MergeResult> {
		return this.asked<MergeResult>(HISTORY_MERGE, { root: this.root, name });
	}

	async resolve(path: string, side: ConflictSide): Promise<void> {
		await this.asked<void>(HISTORY_RESOLVE, { root: this.root, path: checkPath(path), side });
	}

	async readAt(commit: string): Promise<Vault> {
		const held = await this.asked<Record<string, string>>(HISTORY_READ_AT, {
			root: this.root,
			commit
		});
		return new Map(Object.entries(held).map(([path, bytes]) => [path, decodeBase64(bytes)]));
	}

	async currentCommit(): Promise<string | undefined> {
		return (await this.asked<string | null>(HISTORY_HEAD, { root: this.root })) ?? undefined;
	}

	async changedSince(commit: string, paths: readonly string[]): Promise<string[]> {
		return this.asked<string[]>(HISTORY_CHANGED_SINCE, {
			root: this.root,
			commit,
			paths: [...paths]
		});
	}

	async graph(limit: number, cursor?: string): Promise<CommitGraphPage> {
		return this.asked<CommitGraphPage>(HISTORY_GRAPH, {
			root: this.root,
			limit,
			cursor: cursor ?? null
		});
	}

	async branchAt(name: string, commit: string): Promise<Branch> {
		return this.asked<Branch>(HISTORY_BRANCH_AT, { root: this.root, name, commit });
	}

	async deleteBranch(name: string): Promise<void> {
		await this.asked<void>(HISTORY_DELETE_BRANCH, { root: this.root, name });
	}

	async gitUser(): Promise<GitUser | undefined> {
		return (await this.asked<GitUser | null>(HISTORY_GIT_USER, { root: this.root })) ?? undefined;
	}

	async setGitUser(user: GitUser): Promise<void> {
		await this.asked<void>(HISTORY_SET_GIT_USER, { root: this.root, user });
	}

	async signing(): Promise<SigningConfig> {
		return this.asked<SigningConfig>(HISTORY_SIGNING, { root: this.root });
	}

	async setSigning(config: SigningConfig): Promise<void> {
		await this.asked<void>(HISTORY_SET_SIGNING, { root: this.root, signing: config });
	}

	async remotes(): Promise<Remote[]> {
		return this.asked<Remote[]>(HISTORY_REMOTES, { root: this.root });
	}

	async addRemote(name: string, url: string): Promise<void> {
		await this.asked<void>(HISTORY_ADD_REMOTE, { root: this.root, name, url });
	}

	async renameRemote(name: string, to: string): Promise<void> {
		await this.asked<void>(HISTORY_RENAME_REMOTE, { root: this.root, name, to });
	}

	async setRemoteUrl(name: string, url: string): Promise<void> {
		await this.asked<void>(HISTORY_SET_REMOTE_URL, { root: this.root, name, url });
	}

	async removeRemote(name: string): Promise<void> {
		await this.asked<void>(HISTORY_REMOVE_REMOTE, { root: this.root, name });
	}

	async fetch(remote: string, credential?: Credential): Promise<void> {
		await this.asked<void>(HISTORY_FETCH, {
			root: this.root,
			remote,
			credential: credential ?? null
		});
	}

	async pull(remote?: string, credential?: Credential): Promise<MergeResult> {
		return this.asked<MergeResult>(HISTORY_PULL, {
			root: this.root,
			remote: remote ?? null,
			credential: credential ?? null
		});
	}

	async push(remote?: string, credential?: Credential): Promise<void> {
		await this.asked<void>(HISTORY_PUSH, {
			root: this.root,
			remote: remote ?? null,
			credential: credential ?? null
		});
	}
}

/**
 * `openFile` in `@sloppy/app-core`'s runtime, which says what its answer means.
 * `accept` is a file input's list; the media types in it are dropped, because
 * what the system offers is filtered by extension. The bytes come back with the
 * file rather than a path: nothing grants this webview a file outside the
 * folders somebody picked.
 */
export function tauriOpenFile(call: Invoke = invoke): (accept: string) => Promise<File | null> {
	return async (accept) => {
		const extensions = accept
			.split(',')
			.map((one) => one.trim())
			.filter((one) => one.startsWith('.'))
			.map((one) => one.slice(1));
		const picked = await call<{ name: string; bytes: string } | null>(PICK_FILE, { extensions });
		if (!picked) return null;
		return new File([decodeBase64(picked.bytes).slice().buffer as ArrayBuffer], picked.name);
	};
}

/** `saveFile` in `@sloppy/app-core`'s runtime, which says what its answer
 *  means. A webview has no download of its own, so the file is handed to the
 *  app and put where a person says. */
export function tauriSaveFile(call: Invoke = invoke): (name: string, body: Blob) => Promise<void> {
	return async (name, body) => {
		const bytes = encodeBase64(new Uint8Array(await body.arrayBuffer()));
		await call<boolean>(SAVE_FILE, { name, bytes });
	};
}

/** The states of the graph in the folder at `root`. */
export function tauriHistory(root: string, call: Invoke = invoke): History {
	return new TauriHistory(root, call);
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
