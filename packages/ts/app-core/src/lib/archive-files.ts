/**
 * A graph kept in one file, opened in a browser tab —
 * docs/ARCHITECTURE.md § "A graph on this device, in the browser".
 */

import { type Files, MemoryFiles } from '@sloppy/local';
import { unpack } from '@sloppy/vault';

/** What finds the graph in a folder reads the root it is open at, so a graph
 *  held in memory is open at one too. Nothing on the device is there. */
const ARCHIVE_ROOT = '/archive';

/**
 * The graph an archive holds, as files this tab can read and write. The writes
 * are these files and nowhere else: the archive itself is untouched until
 * somebody saves a copy of it.
 *
 * Throws in the reader's own words where the file is not a graph.
 */
export function filesFromArchive(bytes: Uint8Array): Files {
	const held = new Map([...unpack(bytes)].map(([path, file]) => [`${ARCHIVE_ROOT}/${path}`, file]));
	return new MemoryFiles({ root: ARCHIVE_ROOT, store: held });
}
