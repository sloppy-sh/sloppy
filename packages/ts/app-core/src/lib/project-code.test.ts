import { MemoryFiles } from '@sloppy/local';
import { describe, expect, it } from 'vitest';
import { fileAddress, filesIn, textIn } from './project-code.js';

const held = (files: Record<string, string>): MemoryFiles => {
	const project = new MemoryFiles({ root: '/home/ada/garden' });
	for (const [path, text] of Object.entries(files)) {
		void project.write(path, new TextEncoder().encode(text));
	}
	return project;
};

describe('the files a note can be written about', () => {
	it('leaves out what a tool builds into, and the notes themselves', async () => {
		const project = held({
			'src/parser.ts': 'a',
			'README.md': 'b',
			'node_modules/left-pad/index.js': 'c',
			'src-tauri/target/debug/build.rs': 'd',
			'.git/config': 'e',
			'.sloppy/notes/01.md': 'f'
		});

		expect((await filesIn(project)).sort()).toEqual(['README.md', 'src/parser.ts']);
	});

	// A folder called `targeting` is somebody's own writing.
	it('keeps a folder whose name merely starts like one of them', async () => {
		const project = held({ 'targeting/aim.ts': 'a', 'node_modules_old/x.ts': 'b' });

		expect((await filesIn(project)).sort()).toEqual(['node_modules_old/x.ts', 'targeting/aim.ts']);
	});
});

describe('what a file says', () => {
	it('reads it as text', async () => {
		expect(await textIn(held({ 'src/parser.ts': 'const a = 1;\n' }), 'src/parser.ts')).toBe(
			'const a = 1;\n'
		);
	});

	it('is absent where this checkout has not got the file', async () => {
		expect(await textIn(held({}), 'src/gone.ts')).toBeUndefined();
	});

	// A path climbing out of the project is refused by `Files` itself, and a
	// reader must get the same answer it gets for a file that is not there.
	it('is absent where the path is not one inside the project', async () => {
		expect(await textIn(held({}), '../secrets.env')).toBeUndefined();
	});
});

describe('where a file is, for whatever opens files here', () => {
	it('names it from the project root', () => {
		expect(fileAddress('/home/ada/garden', 'src/parser.ts')).toBe(
			'file:///home/ada/garden/src/parser.ts'
		);
	});

	it('spells a space and a hash so the address still names the file', () => {
		expect(fileAddress('/home/ada/my garden', 'src/a#b.ts')).toBe(
			'file:///home/ada/my%20garden/src/a%23b.ts'
		);
	});

	it('reads a root spelled with the other separator the same way', () => {
		expect(fileAddress('C:\\Users\\ada\\garden', 'src/parser.ts')).toBe(
			'file:///C%3A/Users/ada/garden/src/parser.ts'
		);
	});
});
