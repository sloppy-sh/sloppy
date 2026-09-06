/**
 * The keystrokes that write a note, and how a control that writes the same note
 * names them. Naming them on the control is what makes them findable at all.
 */

const MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);

export interface Accelerator {
	/** For `aria-keyshortcuts`, which takes every combination that works. */
	keys: string;
	/** Spelled for the keyboard in front of the reader. */
	says: string;
}

export const NEW_BRANCH: Accelerator = {
	keys: 'Meta+Enter Control+Enter',
	says: MAC ? '⌘ Return' : 'Ctrl+Enter'
};

export const WRITE_UNDER: Accelerator = {
	keys: 'Meta+Shift+Enter Control+Shift+Enter',
	says: MAC ? '⇧ ⌘ Return' : 'Ctrl+Shift+Enter'
};

/** Which of the two a keystroke is, if either. */
export function acceleratorFor(event: KeyboardEvent): 'branch' | 'under' | null {
	if (event.key !== 'Enter' || event.altKey) return null;
	if (!event.metaKey && !event.ctrlKey) return null;
	return event.shiftKey ? 'under' : 'branch';
}
