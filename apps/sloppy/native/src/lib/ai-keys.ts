/**
 * What seals a key this device is given for an assistant. The sealing itself is
 * `tauri-plugin-crypto-hw`, reached the way this shell reaches every command;
 * `AiKeysAccess` in `@sloppy/local` is what a page sees, and it never sees a
 * secret — docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */

import { DeviceAiKeys, type Files, type SealBacking, type Sealer } from '@sloppy/local';
import { invoke } from '@tauri-apps/api/core';
import type { Invoke } from './files';

const SEAL = 'plugin:crypto-hw|seal';
const OPEN = 'plugin:crypto-hw|open';
const DELETE = 'plugin:crypto-hw|delete';

function sealer(call: Invoke): Sealer {
	return {
		async seal(identifier, plaintext) {
			return call<{ sealed: string; backing: SealBacking }>(SEAL, {
				payload: { identifier, plaintext }
			});
		},
		async open(identifier, sealed) {
			return call<{ plaintext: string; backing: SealBacking }>(OPEN, {
				payload: { identifier, sealed }
			});
		},
		async remove(identifier) {
			const { deleted } = await call<{ deleted: boolean }>(DELETE, { payload: { identifier } });
			return deleted;
		}
	};
}

export function deviceAiKeys(files: Files, call: Invoke = invoke): DeviceAiKeys {
	return new DeviceAiKeys(files, sealer(call));
}
