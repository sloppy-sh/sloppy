/**
 * The keystrokes the graph answers, and how the control that does the same
 * thing names them. Naming them on the control is what makes them findable.
 */

const onMac = (): boolean =>
	typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);

export interface Accelerator {
	/** For `aria-keyshortcuts`, which takes every combination that works. */
	keys: string;
	/** Spelled for the keyboard in front of the reader. */
	says: string;
}

export const NEW_BRANCH: Accelerator = {
	keys: 'Meta+Enter Control+Enter',
	get says() {
		return onMac() ? '⌘ Return' : 'Ctrl+Enter';
	}
};

export const WRITE_UNDER: Accelerator = {
	keys: 'Meta+Shift+Enter Control+Shift+Enter',
	get says() {
		return onMac() ? '⇧ ⌘ Return' : 'Ctrl+Shift+Enter';
	}
};

export const THE_PALETTE: Accelerator = {
	keys: 'Meta+K Control+K',
	get says() {
		return onMac() ? '⌘ K' : 'Ctrl+K';
	}
};

/** Whether the keystroke asks for the field that reaches a note or an act. */
export function opensPalette(event: KeyboardEvent): boolean {
	if (event.key !== 'k' && event.key !== 'K') return false;
	if (event.altKey || event.shiftKey) return false;
	return event.metaKey || event.ctrlKey;
}

/** Which of the two a keystroke is, if either. */
export function acceleratorFor(event: KeyboardEvent): 'branch' | 'under' | null {
	if (event.key !== 'Enter' || event.altKey) return null;
	if (!event.metaKey && !event.ctrlKey) return null;
	return event.shiftKey ? 'under' : 'branch';
}

const WRITING = 'input, textarea';

/** Whether the keystroke was typed into a field whose Enter is its own. The
 *  note's writing is not one: it refuses the default on every chord it binds,
 *  so a page over it reads `defaultPrevented` rather than standing down for the
 *  chords the writing leaves alone. */
export function typedIntoWriting(event: KeyboardEvent): boolean {
	const at = event.target;
	return at instanceof Element && at.closest(WRITING) !== null;
}
