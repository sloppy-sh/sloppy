// The folders a build that talks to a server reaches on this device, which is
// what `graphHere` in @sloppy/app-core serves one of.

import { MemoryFiles, type Files } from '@sloppy/local';
import { graphFile, GRAPH_FILE, VAULT_FORMAT } from '@sloppy/vault';
import { describe, expect, it } from 'vitest';
import { deviceFolders } from './folders.js';
import { rememberedVault, rememberVault } from './local-mode.js';

const ADA = 'did:syr:z6MkAdaWritesHere';
const GRAPH = '01J8ZQ7X9KACDEFGHJKMNPQRST';
const GARDEN = '/Users/me/garden';

function aDevice(picks?: string): Files {
	return new MemoryFiles({ data: '/data', ...(picks === undefined ? {} : { folder: picks }) });
}

async function aGraphIn(files: Files, root: string): Promise<void> {
	await files
		.at(root)
		.write(
			GRAPH_FILE,
			graphFile({ format: VAULT_FORMAT, graph: GRAPH, name: 'The garden', owner: ADA })
		);
}

describe('a folder somebody names', () => {
	it('is the one they picked, and is opened again next time', async () => {
		const device = aDevice(GARDEN);

		const folder = await deviceFolders(device).ask();

		expect(folder?.name).toBe(GARDEN);
		await folder?.remember();
		expect(await rememberedVault(device)).toBe(GARDEN);
	});

	it('is nothing where they named none', async () => {
		expect(await deviceFolders(aDevice()).ask()).toBeUndefined();
	});

	// This device names its own folders, so there is nobody to ask a second time.
	it('is read without anybody being asked', async () => {
		const folder = await deviceFolders(aDevice(GARDEN)).ask();

		expect(await folder?.allowed(false)).toBe(true);
	});

	it('reads and writes the folder itself', async () => {
		const device = aDevice(GARDEN);
		const folder = await deviceFolders(device).ask();

		await (await folder!.open()).write('notes/one.md', new TextEncoder().encode('a thought'));

		expect(await device.at(GARDEN).exists('notes/one.md')).toBe(true);
	});
});

describe('the folder this device was told to open again', () => {
	it('is the one it was told, where the graph is still in it', async () => {
		const device = aDevice();
		await aGraphIn(device, GARDEN);
		await rememberVault(device, GARDEN);

		expect((await deviceFolders(device).remembered())?.name).toBe(GARDEN);
	});

	it('is nothing before this device has been told anything', async () => {
		expect(await deviceFolders(aDevice()).remembered()).toBeUndefined();
	});

	// A folder that has been moved or emptied since would otherwise have a graph
	// started in it on a launch nobody asked for.
	it('is nothing where the folder holds no graph any more', async () => {
		const device = aDevice();
		await rememberVault(device, GARDEN);

		expect(await deviceFolders(device).remembered()).toBeUndefined();
	});

	it('is nothing once it has been forgotten', async () => {
		const device = aDevice();
		await aGraphIn(device, GARDEN);
		await rememberVault(device, GARDEN);

		await deviceFolders(device).forget();

		expect(await deviceFolders(device).remembered()).toBeUndefined();
	});
});

describe('what this device says it can do with a folder', () => {
	it('opens one, and starts a graph in one holding none', () => {
		const folders = deviceFolders(aDevice());

		expect(folders.opens).toBe(true);
		expect(folders.starts).toBe(true);
	});
});
