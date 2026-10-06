/**
 * Which folders this app may reach, held where it can be read without waiting.
 * `src-tauri/src/vault.rs` keeps the record and refuses everything outside it;
 * this is a copy, read again each time somebody picks a folder, so
 * `AppRuntime.placeFiles` can answer a root it will not serve on the spot.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Invoke } from './files';

const PICKED = 'folders_picked';

let admitted: string[] = [];

/** Read the record again. A read that fails leaves what was there: the folders
 *  somebody picked do not stop being theirs because one call did not answer. */
export async function readsPicked(call: Invoke = invoke): Promise<void> {
	const held: unknown = await call<unknown>(PICKED).catch(() => undefined);
	if (Array.isArray(held)) admitted = held.filter((one) => typeof one === 'string');
}

/** Whether a folder is one somebody picked, or sits inside one. */
export function picked(root: string): boolean {
	return admitted.some((folder) => root === folder || root.startsWith(`${folder}/`));
}
