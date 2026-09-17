import { MemoryFiles, readVaults, writeVaults, type Files } from '@sloppy/local';
import { graphFile, VAULT_FORMAT } from '@sloppy/vault';
import { describe, expect, it } from 'vitest';

const {
	OPEN_VAULT_FILE,
	folderOf,
	forgetFolder,
	knownFolders,
	openedFolder,
	rememberedVault,
	rememberVault,
	vaultIn
} = await import('./local-mode.js');

const ADA = 'did:syr:z6MkAdaWritesHere';
const GRAPH = '01J8ZQ7X9KACDEFGHJKMNPQRST';

/** A device that cannot reach its own files — a folder that has gone, a drive
 *  that is not here. */
function refusing(): Files {
	const no = () => Promise.reject(new Error('nothing there'));
	const files: Files = {
		root: '',
		read: no,
		write: no,
		list: no,
		remove: no,
		exists: no,
		mkdir: no,
		at: () => files,
		url: () => '',
		pickFolder: no,
		dataPath: async () => '/data'
	};
	return files;
}

describe('the folder this device had a graph in last', () => {
	it('is the one that was opened', async () => {
		const files = new MemoryFiles({ data: '/data' });
		await rememberVault(files, '/Users/me/garden');

		expect(await rememberedVault(files)).toBe('/Users/me/garden');
	});

	it('is nothing on a device that has never had one', async () => {
		expect(await rememberedVault(new MemoryFiles({ data: '/data' }))).toBeUndefined();
	});

	it('is nothing where the record can no longer be read as one', async () => {
		const files = new MemoryFiles({ data: '/data' });
		const own = files.at('/data');
		for (const held of ['{ not json', '{}', '{"folder":""}', '{"folder":42}', 'null']) {
			await own.write(OPEN_VAULT_FILE, new TextEncoder().encode(held));
			expect(await rememberedVault(files)).toBeUndefined();
		}
	});

	it('is nothing where the device cannot answer for its own files', async () => {
		expect(await rememberedVault(refusing())).toBeUndefined();
	});

	it('is written where nobody else keeps their files', async () => {
		const files = new MemoryFiles({ data: '/data' });
		await rememberVault(files, '/Users/me/garden');

		expect(await files.at('/data').exists(OPEN_VAULT_FILE)).toBe(true);
		expect(await files.exists(OPEN_VAULT_FILE)).toBe(false);
	});
});

describe('the folders this device knows', () => {
	/** A device holding `folders`, each one written down in the order given and
	 *  holding the graph it is named with. */
	async function device(folders: readonly { root: string; name?: string }[]): Promise<MemoryFiles> {
		const files = new MemoryFiles({ data: '/data' });
		const at = new Date(0).toISOString();
		await writeVaults(
			files.at('/data'),
			folders.map((one, put) => ({
				root: one.root,
				created_at: at,
				updated_at: new Date(put + 1).toISOString()
			}))
		);
		for (const [put, one] of folders.entries()) {
			if (one.name === undefined) continue;
			await files.at(one.root).write(
				'graph.json',
				graphFile({
					format: VAULT_FORMAT,
					graph: `${GRAPH.slice(0, 25)}${put}`,
					name: one.name,
					owner: ADA
				})
			);
		}
		return files;
	}

	it('are listed with the graph each one holds, the one opened last first', async () => {
		const files = await device([
			{ root: '/Users/me/garden', name: 'The garden' },
			{ root: '/Users/me/thesis', name: 'The thesis' }
		]);

		const known = await knownFolders(files);

		expect(known.map((one) => one.root)).toEqual(['/Users/me/thesis', '/Users/me/garden']);
		expect(known[0].graph).toEqual({
			ref: `${ADA}/${GRAPH.slice(0, 25)}1`,
			name: 'The thesis',
			owner: ADA
		});
		expect(known.every((one) => one.reachable)).toBe(true);
	});

	it('are two where two of them hold one graph', async () => {
		const files = await device([{ root: '/Users/me/garden', name: 'The garden' }]);
		const copy = await files.at('/Users/me/garden').read('graph.json');
		await files.at('/Users/me/backup').write('graph.json', copy as Uint8Array);
		await openedFolder(files, '/Users/me/backup');

		const known = await knownFolders(files, '/Users/me/backup');

		expect(known.map((one) => one.root)).toEqual(['/Users/me/backup', '/Users/me/garden']);
		expect(known[0].graph?.ref).toBe(known[1].graph?.ref);
	});

	it('keep a folder that is not where it was, with nothing to open in it', async () => {
		const files = await device([{ root: '/Users/me/garden' }]);

		const [gone] = await knownFolders(files);

		expect(gone.root).toBe('/Users/me/garden');
		expect(gone.reachable).toBe(false);
		expect(gone.graph).toBeUndefined();
	});

	it('hold the folder that is open before anything has written it down', async () => {
		const files = await device([{ root: '/Users/me/garden', name: 'The garden' }]);
		await files
			.at('/Users/me/new')
			.write(
				'graph.json',
				graphFile({ format: VAULT_FORMAT, graph: GRAPH, name: 'New', owner: ADA })
			);

		const known = await knownFolders(files, '/Users/me/new');

		expect(known.map((one) => one.root)).toEqual(['/Users/me/new', '/Users/me/garden']);
		expect(known[0].graph?.name).toBe('New');
	});

	it('read a folder opened again as the newest one', async () => {
		const files = await device([
			{ root: '/Users/me/garden', name: 'The garden' },
			{ root: '/Users/me/thesis', name: 'The thesis' }
		]);

		await openedFolder(files, '/Users/me/garden');

		expect((await knownFolders(files)).map((one) => one.root)).toEqual([
			'/Users/me/garden',
			'/Users/me/thesis'
		]);
		// The one this device started with stays at the front of what is written
		// down, whatever order the list is read in.
		expect((await readVaults(files.at('/data'))).map((one) => one.root)).toEqual([
			'/Users/me/garden',
			'/Users/me/thesis'
		]);
	});

	it('leave a folder nobody has written down off the list', async () => {
		const files = await device([{ root: '/Users/me/garden', name: 'The garden' }]);

		await openedFolder(files, '/Users/me/new');

		expect((await knownFolders(files)).map((one) => one.root)).toEqual(['/Users/me/garden']);
	});

	it('lose one that is forgotten, and keep everything in its folder', async () => {
		const files = await device([
			{ root: '/Users/me/garden', name: 'The garden' },
			{ root: '/Users/me/thesis', name: 'The thesis' }
		]);

		await forgetFolder(files, '/Users/me/garden');

		expect((await knownFolders(files)).map((one) => one.root)).toEqual(['/Users/me/thesis']);
		expect(await files.at('/Users/me/garden').exists('graph.json')).toBe(true);
	});
});

describe("a project's notes", () => {
	const ENGINE = '/Users/me/engine';

	/** A project at `ENGINE` whose notes are the container inside it. */
	async function project(name?: string): Promise<MemoryFiles> {
		const files = new MemoryFiles({ root: '/', data: '/data' });
		const at = new Date(0).toISOString();
		await writeVaults(files.at('/data'), [
			{ root: `${ENGINE}/.sloppy`, created_at: at, updated_at: at }
		]);
		if (name !== undefined) {
			await files
				.at(`${ENGINE}/.sloppy`)
				.write(
					'graph.json',
					graphFile({ format: VAULT_FORMAT, graph: GRAPH, name, owner: ADA, project: '..' })
				);
		}
		return files;
	}

	it('are listed under the project, and say which project it is', async () => {
		const [listed] = await knownFolders(await project('Engine'));

		expect(listed.root).toBe(ENGINE);
		expect(listed.graph?.name).toBe('Engine');
		expect(listed.graph?.project).toBe('..');
	});

	it('name the project even where it is not where it was', async () => {
		const [gone] = await knownFolders(await project());

		expect(gone.root).toBe(ENGINE);
		expect(gone.reachable).toBe(false);
	});

	it('are let go of by the project, and stay in its folder', async () => {
		const files = await project('Engine');

		await forgetFolder(files, ENGINE);

		expect(await knownFolders(files)).toEqual([]);
		expect(await files.at(`${ENGINE}/.sloppy`).exists('graph.json')).toBe(true);
	});

	it('are what a project opens, and a folder opens its own', async () => {
		const files = await project('Engine');
		await files
			.at('/Users/me/garden')
			.write(
				'graph.json',
				graphFile({ format: VAULT_FORMAT, graph: GRAPH, name: 'The garden', owner: ADA })
			);

		expect(await vaultIn(files, ENGINE)).toBe(`${ENGINE}/.sloppy`);
		expect(await vaultIn(files, '/Users/me/garden')).toBe('/Users/me/garden');
		expect(await vaultIn(files, '/Users/me/empty')).toBe('/Users/me/empty');
	});

	it('are read as the project they sit in, and a folder as itself', () => {
		expect(folderOf(`${ENGINE}/.sloppy`)).toBe(ENGINE);
		expect(folderOf('C:\\Users\\me\\engine\\.sloppy')).toBe('C:\\Users\\me\\engine');
		expect(folderOf('/Users/me/garden')).toBe('/Users/me/garden');
		expect(folderOf('/.sloppy')).toBe('/.sloppy');
	});
});
