import { containerApi, MemoryFiles, servingProjects } from '@sloppy/local';
import {
	ASSET_MOST,
	ASSET_READ,
	ASSET_TOO_LARGE_SAID,
	type AssetRead,
	NO_SUCH_ASSET_SAID,
	SERVE_REFUSALS
} from '@sloppy/types';
import { describe, expect, it } from 'vitest';
import { servedMethods } from './methods.js';
import './served.js';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DRAWN = {
	strokes: [{ points: [{ x: 0, y: 0, pressure: 0.5, t: 0 }], width: 2 }],
	width: 40,
	height: 20,
	description: 'A line'
};

function aPicture(size: number): Uint8Array {
	const bytes = new Uint8Array(size);
	bytes.set(PNG);
	return bytes;
}

async function aGarden() {
	const files = new MemoryFiles({ root: '/work/garden', data: '/work/garden-data' });
	await files.write('src/a.ts', new TextEncoder().encode('export const a = 1;\n'));
	const api = containerApi(files);
	await api.openProject('/work/garden');
	const keep = async (bytes: Uint8Array) => {
		const ticket = await api.createUpload({
			role: 'block',
			filename: 'seed.png',
			mime_type: 'image/png',
			size: bytes.byteLength
		});
		await api.sendUpload(ticket, new Blob([bytes.slice().buffer as ArrayBuffer]));
		await api.completeUpload({ upload_id: ticket.upload_id });
		return ticket.upload_id;
	};
	const shown = await keep(aPicture(12));
	const elsewhere = await keep(aPicture(10));
	const huge = await keep(aPicture(ASSET_MOST + 1));
	const write = async (title: string, content: unknown[]) => {
		const note = await api.createNode({ title });
		await api.createBlock({ node: note.ref, content: { type: 'doc', content } as never });
		return note.ref;
	};
	const seed = await write('Seed', [
		{ type: 'paragraph', content: [{ type: 'text', text: 'It sprouts.' }] },
		{ type: 'picture', attrs: { upload_id: shown, alt: 'A seed' } },
		{ type: 'ink', attrs: DRAWN }
	]);
	const other = await write('Other', [{ type: 'picture', attrs: { upload_id: elsewhere } }]);
	const heavy = await write('Heavy', [{ type: 'picture', attrs: { upload_id: huge } }]);
	return { files, seed, other, heavy, shown, elsewhere };
}

async function asked(
	files: MemoryFiles,
	lines: { method: string; params: unknown }[]
): Promise<Record<string, unknown>[]> {
	const loop = servingProjects(
		[{ id: 'garden', name: 'garden', server: { version: '1', files } }],
		{
			methods: servedMethods
		}
	);
	const answers: Record<string, unknown>[] = [];
	lines.forEach(({ method, params }, at) =>
		loop.take(JSON.stringify({ jsonrpc: '2.0', id: at + 1, method, params }), (line) =>
			answers.push(JSON.parse(line))
		)
	);
	await loop.settled();
	return answers.sort((a, b) => Number(a.id) - Number(b.id));
}

/** Every picture path the note's markdown names, as a headset reads it. */
async function picturesIn(files: MemoryFiles, note: string): Promise<string[]> {
	const [answer] = await asked(files, [
		{ method: 'tools/call', params: { name: 'read_note', arguments: { note } } }
	]);
	const read = JSON.parse((answer.result as { content: { text: string }[] }).content[0].text) as {
		sections: { markdown: string }[];
	};
	return read.sections.flatMap(({ markdown }) =>
		[...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((found) => found[1])
	);
}

function decoded(read: AssetRead): number[] {
	return [...atob(read.bytes)].map((letter) => letter.charCodeAt(0));
}

describe('a picture a note’s writing shows, read for a headset', () => {
	it('answers the bytes and type of every picture the note’s markdown names', async () => {
		const { files, seed } = await aGarden();
		const paths = await picturesIn(files, seed);
		expect(paths).toHaveLength(2);

		const answers = await asked(
			files,
			paths.map((path) => ({ method: ASSET_READ, params: { note: seed, path } }))
		);

		const [picture, drawing] = answers.map((answer) => answer.result as AssetRead);
		expect(picture.mime).toBe('image/png');
		expect(decoded(picture)).toEqual([...aPicture(12)]);
		expect(drawing.mime).toBe('image/svg+xml');
		expect(atob(drawing.bytes)).toContain('<svg');
	});

	it('refuses a path the note’s own writing does not name', async () => {
		const { files, seed, other, elsewhere } = await aGarden();
		const [named] = await picturesIn(files, seed);

		const answers = await asked(files, [
			{ method: ASSET_READ, params: { note: seed, path: `media/${elsewhere}` } },
			{ method: ASSET_READ, params: { note: other, path: named } },
			{ method: ASSET_READ, params: { note: seed, path: '.sloppy/media.json' } },
			{ method: ASSET_READ, params: { note: seed, path: '../outside.png' } },
			{ method: ASSET_READ, params: { note: 'not a note', path: named } },
			{ method: ASSET_READ, params: { note: seed } }
		]);

		expect(answers).toHaveLength(6);
		for (const answer of answers) {
			expect(answer.error).toEqual({
				code: SERVE_REFUSALS.NO_SUCH_ASSET,
				message: NO_SUCH_ASSET_SAID
			});
		}
	});

	it('refuses a picture too large to send', async () => {
		const { files, heavy } = await aGarden();
		const [path] = await picturesIn(files, heavy);

		const [answer] = await asked(files, [{ method: ASSET_READ, params: { note: heavy, path } }]);

		expect(answer.error).toEqual({
			code: SERVE_REFUSALS.ASSET_TOO_LARGE,
			message: ASSET_TOO_LARGE_SAID
		});
	});

	it('waits its turn behind the project’s other reads', () => {
		expect(servedMethods[ASSET_READ]?.queued).toBe(true);
	});
});
