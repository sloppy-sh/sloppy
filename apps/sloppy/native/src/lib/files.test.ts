import { HistoryError, OutsideRootError } from '@sloppy/local';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(),
	convertFileSrc: (path: string, scheme: string) => `${scheme}://localhost/${path}`
}));

const { tauriFiles, tauriHistory, tauriOpenFile, tauriSaveFile } = await import('./files.js');

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

describe('the states the graph in this folder has been in', () => {
	it('asks about the folder that is open', async () => {
		const { asked, call } = shell({
			history_status: {
				changed: ['notes/a.md'],
				untracked: [],
				branch: 'main',
				ahead: 0,
				behind: 2,
				upstream: 'origin/main'
			}
		});

		expect(await tauriHistory('/vault', call).status()).toEqual({
			changed: ['notes/a.md'],
			untracked: [],
			branch: 'main',
			ahead: 0,
			behind: 2,
			upstream: 'origin/main'
		});
		expect(asked).toEqual([{ command: 'history_status', args: { root: '/vault' } }]);
	});

	it('answers nothing for a commit that was not made and a folder on none', async () => {
		const { call } = shell({ history_commit: null, history_head: null });
		const history = tauriHistory('/vault', call);

		expect(await history.commit('Nothing new')).toBeUndefined();
		expect(await history.currentCommit()).toBeUndefined();
	});

	it('reads a whole graph back out of a commit', async () => {
		const { asked, call } = shell({ history_read_at: { 'notes/a.md': btoa('one') } });

		expect(await tauriHistory('/vault', call).readAt('abc')).toEqual(
			new Map([['notes/a.md', Uint8Array.from([111, 110, 101])]])
		);
		expect(asked[0]).toEqual({
			command: 'history_read_at',
			args: { root: '/vault', commit: 'abc' }
		});
	});

	it('asks which of the paths under a note have moved since a commit', async () => {
		const { asked, call } = shell({ history_changed_since: ['src/a.ts'] });

		expect(
			await tauriHistory('/vault', call).changedSince?.('abc', ['src/a.ts', 'src/b.ts'])
		).toEqual(['src/a.ts']);
		expect(asked[0]).toEqual({
			command: 'history_changed_since',
			args: { root: '/vault', commit: 'abc', paths: ['src/a.ts', 'src/b.ts'] }
		});
	});

	it('hands on what an act it would not take was refused with', async () => {
		const call = async <T>(): Promise<T> => {
			throw 'Finish the merge you are in the middle of first.';
		};
		const history = tauriHistory('/vault', call);

		await expect(history.switch('later')).rejects.toBeInstanceOf(HistoryError);
		await expect(history.switch('later')).rejects.toThrow(
			'Finish the merge you are in the middle of first.'
		);
	});

	it('refuses to settle a conflict over a path outside the folder', async () => {
		const { asked, call } = shell();
		await expect(
			tauriHistory('/vault', call).resolve('../elsewhere/a.md', 'mine')
		).rejects.toBeInstanceOf(OutsideRootError);
		expect(asked).toEqual([]);
	});
});

describe('a file that arrives from outside every folder this app reads', () => {
	it('comes back as the bytes somebody picked, under the name they picked', async () => {
		const { asked, call } = shell({
			pick_file: { name: 'sloppy-identity.json', bytes: btoa('{"did":"did:syr:z1"}') }
		});

		const picked = await tauriOpenFile(call)('.json,application/json');

		expect(picked?.name).toBe('sloppy-identity.json');
		expect(await picked?.text()).toBe('{"did":"did:syr:z1"}');
		// A media type is not something the system filters a file list by.
		expect(asked).toEqual([{ command: 'pick_file', args: { extensions: ['json'] } }]);
	});

	it('is nothing where somebody picked none', async () => {
		const { call } = shell({ pick_file: null });

		expect(await tauriOpenFile(call)('.json')).toBeNull();
	});
});

describe('a file the app hands a person to keep', () => {
	it('crosses the bridge as bytes, with the name to offer them', async () => {
		const { asked, call } = shell({ save_file: true });

		await tauriSaveFile(call)('sloppy-identity.json', new Blob([new Uint8Array([1, 2, 3])]));

		expect(asked).toEqual([
			{
				command: 'save_file',
				args: { name: 'sloppy-identity.json', bytes: btoa('') }
			}
		]);
	});
});

describe('the places a folder is also kept', () => {
	it('asks for what is kept elsewhere and what a change to it is called', async () => {
		const { asked, call } = shell({
			history_remotes: [{ name: 'origin', url: 'https://host/me' }]
		});
		const history = tauriHistory('/vault', call);

		expect(await history.remotes?.()).toEqual([{ name: 'origin', url: 'https://host/me' }]);
		await history.addRemote?.('origin', 'https://host/me');
		await history.renameRemote?.('origin', 'mine');
		await history.setRemoteUrl?.('mine', 'https://host/us');
		await history.removeRemote?.('mine');

		expect(asked).toEqual([
			{ command: 'history_remotes', args: { root: '/vault' } },
			{
				command: 'history_add_remote',
				args: { root: '/vault', name: 'origin', url: 'https://host/me' }
			},
			{ command: 'history_rename_remote', args: { root: '/vault', name: 'origin', to: 'mine' } },
			{
				command: 'history_set_remote_url',
				args: { root: '/vault', name: 'mine', url: 'https://host/us' }
			},
			{ command: 'history_remove_remote', args: { root: '/vault', name: 'mine' } }
		]);
	});

	it('hands what a host wants over with the act that needs it, and nothing where there is none', async () => {
		const { asked, call } = shell({ history_pull: { merged: true } });
		const history = tauriHistory('/vault', call);
		const credential = { kind: 'token', username: 'me', token: 'a token' } as const;

		await history.fetch?.('origin', credential);
		expect(await history.pull?.()).toEqual({ merged: true });
		await history.push?.('origin');

		expect(asked).toEqual([
			{ command: 'history_fetch', args: { root: '/vault', remote: 'origin', credential } },
			{ command: 'history_pull', args: { root: '/vault', remote: null, credential: null } },
			{ command: 'history_push', args: { root: '/vault', remote: 'origin', credential: null } }
		]);
	});

	it('brings a copy of one over into the folder somebody chose', async () => {
		const { asked, call } = shell();
		await tauriFiles('/vault', call).clone?.('https://host/me', '/Users/me/notes', {
			kind: 'ssh',
			key: { kind: 'kept' }
		});

		expect(asked).toEqual([
			{
				command: 'files_clone',
				args: {
					url: 'https://host/me',
					into: '/Users/me/notes',
					credential: { kind: 'ssh', key: { kind: 'kept' } }
				}
			}
		]);
	});

	it('hands on what a copy that could not be made was refused with', async () => {
		const call = async <T>(): Promise<T> => {
			throw 'There is nothing at that address. Check it and try again.';
		};

		await expect(
			tauriFiles('/vault', call).clone?.('https://host/nobody', '/Users/me/notes')
		).rejects.toBeInstanceOf(HistoryError);
	});
});

describe('the whole picture of what this folder has been', () => {
	it('reads every branch at once and says what is at each commit', async () => {
		const { asked, call } = shell({
			history_graph: {
				commits: [
					{
						id: 'b',
						message: 'A note',
						author: 'Ada',
						at: '2026-01-01T00:00:00.000Z',
						parents: ['a'],
						refs: ['main', 'origin/main'],
						signature: { by: 'SHA256:abc', verified: true }
					}
				]
			}
		});

		const held = await tauriHistory('/vault', call).graph?.(10);
		expect(held?.commits[0].refs).toEqual(['main', 'origin/main']);
		expect(held?.commits[0].signature).toEqual({ by: 'SHA256:abc', verified: true });
		expect(held?.cursor).toBeUndefined();
		expect(asked).toEqual([
			{ command: 'history_graph', args: { root: '/vault', limit: 10, cursor: null } }
		]);
	});

	it('makes a branch back in the history and takes one away', async () => {
		const { asked, call } = shell({
			history_branch_at: { name: 'from-then', head: 'a', current: false }
		});
		const history = tauriHistory('/vault', call);

		expect(await history.branchAt?.('from-then', 'a')).toEqual({
			name: 'from-then',
			head: 'a',
			current: false
		});
		await history.deleteBranch?.('from-then');

		expect(asked).toEqual([
			{ command: 'history_branch_at', args: { root: '/vault', name: 'from-then', commit: 'a' } },
			{ command: 'history_delete_branch', args: { root: '/vault', name: 'from-then' } }
		]);
	});
});

describe('who the commits made in this folder are by, and how they are signed', () => {
	it('answers nobody where nothing anywhere says', async () => {
		const { call } = shell({ history_git_user: null });
		expect(await tauriHistory('/vault', call).gitUser?.()).toBeUndefined();
	});

	it('writes the pair and how a commit is signed for this folder alone', async () => {
		const { asked, call } = shell({ history_signing: { kind: 'none' } });
		const history = tauriHistory('/vault', call);

		await history.setGitUser?.({ name: 'Ada', email: 'ada@example.com' });
		expect(await history.signing?.()).toEqual({ kind: 'none' });
		await history.setSigning?.({ kind: 'ssh', key: { kind: 'kept' } });

		expect(asked).toEqual([
			{
				command: 'history_set_git_user',
				args: { root: '/vault', user: { name: 'Ada', email: 'ada@example.com' } }
			},
			{ command: 'history_signing', args: { root: '/vault' } },
			{
				command: 'history_set_signing',
				args: { root: '/vault', signing: { kind: 'ssh', key: { kind: 'kept' } } }
			}
		]);
	});

	it('hands over the half of the kept key a host is given', async () => {
		const shown = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample sloppy';
		const { call } = shell({
			history_signing: { kind: 'ssh', key: { kind: 'kept' }, publicKey: shown }
		});
		expect(await tauriHistory('/vault', call).signing?.()).toEqual({
			kind: 'ssh',
			key: { kind: 'kept' },
			publicKey: shown
		});
	});
});

describe('what this shell tells the surfaces that read a folder it can do', () => {
	/** Settings › History offers nothing unless the whole set is there, and the
	 *  commit picture is drawn off `graph` — `History` in `@sloppy/local` says a
	 *  shell that defines one of these defines all of them. */
	it('defines every act those surfaces look for, together', () => {
		const history = tauriHistory('/vault', shell().call);
		for (const act of [
			'graph',
			'branchAt',
			'deleteBranch',
			'gitUser',
			'setGitUser',
			'signing',
			'setSigning',
			'remotes',
			'addRemote',
			'renameRemote',
			'setRemoteUrl',
			'removeRemote',
			'fetch',
			'pull',
			'push'
		] as const) {
			expect(typeof history[act]).toBe('function');
		}
	});
});
