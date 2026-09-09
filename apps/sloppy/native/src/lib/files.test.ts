import { OutsideRootError } from '@sloppy/local';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
	convertFileSrc: (path: string, scheme: string) => `${scheme}://localhost/${path}`
}));

const { tauriFiles } = await import('./files.js');

/** The commands with the arguments they were called with, answering whatever
 *  `answers` holds for each. */
function shell(answers: Record<string, unknown> = {}) {
	const asked: { command: string; args?: Record<string, unknown> }[] = [];
	const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
		asked.push({ command, args });
		return answers[command] as T;
	};
	return { asked, call };
}

describe('the shell files a graph on this device is kept in', () => {
	it('reads a file back as the bytes that were written', async () => {
		const { asked, call } = shell({ files_read: btoa('one') });
		const files = tauriFiles('/vault', call);

		expect(await files.read('notes/a.md')).toEqual(Uint8Array.from([111, 110, 101]));
		expect(asked).toEqual([
			{ command: 'files_read', args: { root: '/vault', path: 'notes/a.md' } }
		]);
	});

	it('answers nothing for a file that is not there', async () => {
		const { call } = shell({ files_read: null });
		expect(await tauriFiles('/vault', call).read('notes/a.md')).toBeUndefined();
	});

	it('hands bytes over as something the bridge can carry', async () => {
		const { asked, call } = shell();
		await tauriFiles('/vault', call).write('media/p.png', new Uint8Array([1, 2, 3]));

		expect(asked[0].args).toEqual({
			root: '/vault',
			path: 'media/p.png',
			bytes: btoa(String.fromCharCode(1, 2, 3))
		});
	});

	it('refuses a path that would leave the folder before it asks for anything', async () => {
		const { asked, call } = shell();
		await expect(tauriFiles('/vault', call).read('../elsewhere')).rejects.toBeInstanceOf(
			OutsideRootError
		);
		expect(asked).toEqual([]);
	});

	it('re-roots onto the folder somebody picked', async () => {
		const { asked, call } = shell({ pick_folder: '/Users/me/graph' });
		const files = tauriFiles('', call);

		const picked = await files.pickFolder();
		if (!picked) throw new Error('nothing was picked');
		await files.at(picked).read('graph.json');

		expect(asked.at(-1)).toEqual({
			command: 'files_read',
			args: { root: '/Users/me/graph', path: 'graph.json' }
		});
	});

	it('gives a picture an address the page can load it from', () => {
		const { call } = shell();
		expect(tauriFiles('/vault', call).url('media/p.png')).toBe(
			'vault://localhost//vault/media/p.png'
		);
	});
});
