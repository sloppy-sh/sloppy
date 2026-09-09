// A file leaving and a file arriving. `saveFile` and `openFile` in runtime.ts
// say what each shell's answer means.

import { runtime } from './runtime.js';

export function savesFiles(): boolean {
	return runtime.saveFile() !== null;
}

/** Hand it over. Call where {@link savesFiles}. */
export async function saveHere(name: string, body: Blob): Promise<void> {
	const save = runtime.saveFile();
	if (save) {
		await save(name, body);
		return;
	}
	const at = URL.createObjectURL(body);
	const link = document.createElement('a');
	link.href = at;
	link.download = name;
	document.body.append(link);
	link.click();
	link.remove();
	// WebKit reads the blob after the click returns; revoking in this task
	// loses the file.
	setTimeout(() => URL.revokeObjectURL(at));
}

export function opensFiles(): boolean {
	return runtime.openFile() !== null;
}

/** Ask for one. `accept` is a file input's list of extensions, and `null` is
 *  somebody who chose nothing. Call where {@link opensFiles}. */
export async function openHere(accept: string): Promise<File | null> {
	const open = runtime.openFile();
	if (open) return open(accept);
	return new Promise((settle) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.hidden = true;
		const done = (chosen: File | null): void => {
			input.remove();
			settle(chosen);
		};
		input.onchange = () => done(input.files?.[0] ?? null);
		input.addEventListener('cancel', () => done(null));
		document.body.append(input);
		input.click();
	});
}
