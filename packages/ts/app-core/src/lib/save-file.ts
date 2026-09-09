// Handing a person a file to keep. `saveFile` in runtime.ts says what each
// shell's answer means.

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
