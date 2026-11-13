// `asset/read` — a picture a note's own writing shows, for a headset drawing
// that writing: docs/ARCHITECTURE.md § "A headset beside the desk".

import {
	containerOf,
	extensionOf,
	type Files,
	mimeForExtension,
	placeApi,
	type ProjectServed,
	type ServeMethodTable,
	ServeRefused
} from '@sloppy/local';
import {
	ASSET_MOST,
	ASSET_READ,
	ASSET_TOO_LARGE_SAID,
	type AssetRead,
	NO_SUCH_ASSET_SAID,
	type OwnedRef,
	OwnedRefSchema,
	SERVE_REFUSALS,
	splitOwnedRef
} from '@sloppy/types';
import {
	emptySidecars,
	GRAPH_FILE,
	inkImagePath,
	inkSvg,
	MEDIA_DIR,
	type Sidecars,
	toMarkdown,
	uploadAt
} from '@sloppy/vault';

const SVG = 'image/svg+xml';

function notShown(): ServeRefused {
	return new ServeRefused(SERVE_REFUSALS.NO_SUCH_ASSET, NO_SUCH_ASSET_SAID);
}

/** What `note`'s sections name beside their text, written as `read_note`
 *  writes them; undefined where the note is not in this project. */
async function namedBy(files: Files, note: OwnedRef): Promise<Sidecars | undefined> {
	const blocks = await placeApi(files)
		.listBlocks(note)
		.catch(() => undefined);
	if (blocks === undefined) return undefined;
	const aside = emptySidecars(splitOwnedRef(note).localId);
	for (const block of blocks) {
		toMarkdown(block.content, { ...aside, block: splitOwnedRef(block.ref).localId });
	}
	return aside;
}

async function vaultOf(files: Files): Promise<Files | undefined> {
	return (await files.exists(GRAPH_FILE)) ? files : containerOf(files);
}

async function keptPicture(
	files: Files,
	upload: string
): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
	const vault = await vaultOf(files);
	if (vault === undefined) return undefined;
	const kept = (await vault.list(MEDIA_DIR)).find((path) => uploadAt(path) === upload);
	const mime = kept === undefined ? undefined : mimeForExtension(extensionOf(kept));
	const bytes = kept === undefined || mime === undefined ? undefined : await vault.read(kept);
	return bytes === undefined || mime === undefined ? undefined : { bytes, mime };
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (let at = 0; at < bytes.length; at += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	}
	return btoa(binary);
}

/** The picture at `params.path` in `params.note`'s writing, where its writing shows one there. */
export async function assetRead(
	params: Record<string, unknown>,
	project: ProjectServed
): Promise<AssetRead> {
	const note = OwnedRefSchema.safeParse(params.note);
	const path = params.path;
	const files = project.server.files;
	if (files === undefined || !note.success || typeof path !== 'string') throw notShown();
	const named = await namedBy(files, note.data);
	if (named === undefined) throw notShown();
	const drawing = [...named.ink].find(([stem]) => inkImagePath(stem) === path);
	const upload = uploadAt(path);
	const held =
		drawing !== undefined
			? { bytes: new TextEncoder().encode(inkSvg(drawing[1])), mime: SVG }
			: upload !== undefined && named.pictures.has(upload)
				? await keptPicture(files, upload)
				: undefined;
	if (held === undefined) throw notShown();
	if (held.bytes.byteLength > ASSET_MOST) {
		throw new ServeRefused(SERVE_REFUSALS.ASSET_TOO_LARGE, ASSET_TOO_LARGE_SAID);
	}
	return { bytes: base64(held.bytes), mime: held.mime };
}

export const assetMethods: ServeMethodTable = {
	[ASSET_READ]: { queued: true, handle: assetRead }
};
