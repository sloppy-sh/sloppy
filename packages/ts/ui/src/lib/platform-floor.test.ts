// Syntax this package may not ship, because the tests run on V8 and the app
// does not. A regex literal is parsed when its module is, so one unsupported
// construct throws before a line of it runs and takes the whole surface down.
// `apps/sloppy/native/src-tauri/tauri.conf.json` sets the floor.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = fileURLToPath(new URL('.', import.meta.url));

/** Lookbehind reached Safari in 16.4; iOS 16.0 is inside the supported range. */
const LOOKBEHIND = /\(\?<[=!]/;

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return sources(path);
		if (!/\.(ts|svelte)$/.test(entry) || /\.test\.ts$/.test(entry)) return [];
		return [path];
	});
}

describe('what @sloppy/ui may not ship', () => {
	it('has no regex lookbehind anywhere in the package', () => {
		const offenders = sources(LIB).filter((path) => LOOKBEHIND.test(readFileSync(path, 'utf8')));
		expect(offenders.map((path) => path.slice(LIB.length))).toEqual([]);
	});
});
