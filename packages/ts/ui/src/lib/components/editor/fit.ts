// Redrawing a picture at the size it will be looked at. What a camera hands
// over is far larger than the column a note draws it in, and every later read
// of it — in the note and in the picker — pays that difference again.

/** The longest side a picture in a note is kept at: wider than the reading
 *  column on every screen Sloppy runs on, dense ones included. */
export const NOTE_PX = 1600;
/** The longest side a custom emoji is kept at. */
export const EMOJI_PX = 128;

const QUALITY = 0.82;
/** An animation does not survive being redrawn onto a canvas, and either of
 *  these may carry one. */
const ANIMATABLE: ReadonlySet<string> = new Set(['image/gif', 'image/webp']);

/**
 * `source` redrawn with its longest side at `longest`, or null where it is
 * already within that, or where the browser would neither draw nor encode it.
 * The type is the browser's answer, not the source's.
 */
export async function capped(source: Blob, longest: number): Promise<Blob | null> {
	let whole: ImageBitmap | undefined;
	try {
		whole = await createImageBitmap(source);
		const scale = Math.min(1, longest / Math.max(whole.width, whole.height));
		if (scale === 1) return null;

		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(whole.width * scale));
		canvas.height = Math.max(1, Math.round(whole.height * scale));
		const onto = canvas.getContext('2d');
		if (!onto) return null;
		onto.drawImage(whole, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', QUALITY));
	} catch {
		return null;
	} finally {
		whole?.close();
	}
}

/** The file to send in `file`'s place — `file` itself where redrawing it would
 *  lose an animation or gain nothing. */
export async function fitted(file: File, longest: number): Promise<File> {
	if (ANIMATABLE.has(file.type)) return file;
	const drawn = await capped(file, longest);
	if (!drawn || drawn.size >= file.size) return file;
	return new File([drawn], named(file.name, drawn.type), { type: drawn.type });
}

function named(was: string, type: string): string {
	const stem = was.replace(/\.[^./\\]+$/, '') || 'picture';
	return `${stem}.${type.slice(type.indexOf('/') + 1)}`;
}
