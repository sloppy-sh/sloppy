// A folder a browser handed over, read and written in place —
// docs/ARCHITECTURE.md § "A graph on this device, beside the one a Sloppy serves".

import { MemoryFiles, OutsideRootError } from '@sloppy/local';
import { EMOJI_DIR, MEDIA_DIR } from '@sloppy/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_ROOT, DirectoryFiles, filesHere } from './browser-files.js';
import { fakeFolder, type Held } from './browser-files.test-support.js';

const utf8 = new TextEncoder();
const text = new TextDecoder();

let held: Held;
let files: DirectoryFiles;
let handed: string[];

beforeEach(() => {
	held = new Map();
	files = new DirectoryFiles(fakeFolder(held));
	handed = [];
	URL.createObjectURL = (blob: Blob) => {
		const at = `blob:held-${handed.length}-${blob.size}`;
		handed.push(at);
		return at;
	};
	URL.revokeObjectURL = (at: string) => {
		handed = handed.filter((one) => one !== at);
	};
});

afterEach(() => {
	files.release();
});

describe('a folder read and written in place', () => {
	it('writes the folders above a file as it goes', async () => {
		await files.write('notes/01J.md', utf8.encode('# One'));
		expect([...held.keys()]).toEqual(['notes/01J.md']);
		expect(text.decode(await files.read('notes/01J.md'))).toBe('# One');
	});

	it('answers a file that is not there with nothing at all', async () => {
		expect(await files.read('notes/nobody.md')).toBeUndefined();
		expect(await files.exists('notes/nobody.md')).toBe(false);
		expect(await files.list('notes')).toEqual([]);
	});

	it('lists every file under a path, all the way down', async () => {
		await files.write('notes/one.md', utf8.encode('one'));
		await files.write('.sloppy/ink/one.svg', utf8.encode('<svg/>'));
		await files.write('graph.json', utf8.encode('{}'));
		expect((await files.list('')).sort()).toEqual([
			'.sloppy/ink/one.svg',
			'graph.json',
			'notes/one.md'
		]);
		expect(await files.list('notes')).toEqual(['notes/one.md']);
	});

	it('removing twice is one outcome and not an error', async () => {
		await files.write('notes/one.md', utf8.encode('one'));
		await files.remove('notes/one.md');
		await files.remove('notes/one.md');
		expect(await files.exists('notes/one.md')).toBe(false);
	});

	it('reads and writes the same folder from a root inside it', async () => {
		const inside = files.at('.sloppy');
		await inside.write('graph.json', utf8.encode('{}'));
		expect([...held.keys()]).toEqual(['.sloppy/graph.json']);
		expect(await files.exists('.sloppy/graph.json')).toBe(true);
		expect(await inside.list('')).toEqual(['graph.json']);
	});

	it('refuses a path that would climb out of the folder', async () => {
		await expect(files.read('../secrets')).rejects.toThrow(OutsideRootError);
	});
});

describe('the address a page loads a picture from', () => {
	it('is there for the pictures already in the folder once it is taken up', async () => {
		held.set(`${MEDIA_DIR}/01J.png`, utf8.encode('a picture'));
		held.set(`${EMOJI_DIR}/wave.png`, utf8.encode('a sticker'));
		expect(files.url(`${MEDIA_DIR}/01J.png`)).toBe('data:,');
		await files.warm();
		expect(files.url(`${MEDIA_DIR}/01J.png`)).toMatch(/^blob:/);
		expect(files.url(`${EMOJI_DIR}/wave.png`)).toMatch(/^blob:/);
	});

	it('is there for one written while the folder is open', async () => {
		await files.write(`${MEDIA_DIR}/01J.png`, utf8.encode('a picture'));
		expect(files.url(`${MEDIA_DIR}/01J.png`)).toMatch(/^blob:/);
	});

	it('is the same address from a root inside the folder', async () => {
		await files.write(`${MEDIA_DIR}/01J.png`, utf8.encode('a picture'));
		expect(files.at(MEDIA_DIR).url('01J.png')).toBe(files.url(`${MEDIA_DIR}/01J.png`));
	});

	it('is given up when the picture is removed, and when the graph is closed', async () => {
		await files.write(`${MEDIA_DIR}/01J.png`, utf8.encode('a picture'));
		await files.write(`${MEDIA_DIR}/02J.png`, utf8.encode('another'));
		expect(handed).toHaveLength(2);
		await files.remove(`${MEDIA_DIR}/01J.png`);
		expect(handed).toHaveLength(1);
		files.release();
		expect(handed).toEqual([]);
		expect(files.url(`${MEDIA_DIR}/02J.png`)).toBe('data:,');
	});
});

describe('this browser’s own corner beside the graph', () => {
	it('keeps what is nobody’s folder out of the folder', async () => {
		const own = new MemoryFiles();
		const here = filesHere(files, own);

		await here.write('notes/one.md', utf8.encode('one'));
		const mine = here.at(await here.dataPath());
		await mine.write('identities.json', utf8.encode('[]'));

		expect([...held.keys()]).toEqual(['notes/one.md']);
		expect(text.decode(await mine.read('identities.json'))).toBe('[]');
		expect(await own.read('identities.json')).toBeDefined();
	});

	it('answers a root under that corner from the corner too', async () => {
		const own = new MemoryFiles();
		const here = filesHere(files, own);
		await here.at(`${DEVICE_ROOT}/keys`).write('one.key', utf8.encode('k'));
		expect(text.decode(await own.at('keys').read('one.key'))).toBe('k');
		expect(held.size).toBe(0);
	});

	it('keeps a root inside the graph inside the graph', async () => {
		const here = filesHere(files, new MemoryFiles());
		await here.at('.sloppy').write('graph.json', utf8.encode('{}'));
		expect([...held.keys()]).toEqual(['.sloppy/graph.json']);
	});
});
