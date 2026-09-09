import { MemoryFiles, type Files } from '@sloppy/local';
import { describe, expect, it } from 'vitest';

const { OPEN_VAULT_FILE, rememberedVault, rememberVault } = await import('./local-mode.js');

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
