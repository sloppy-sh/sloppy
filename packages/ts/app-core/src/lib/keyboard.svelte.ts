/**
 * Shared on-screen-keyboard state, and the visual-viewport tracker both shells
 * drive it with. `trackKeyboard` is the whole of it on the web; the native shell
 * composes it with the system-bar insets only a WebView can measure.
 *
 * **This, not `--kb-inset-bottom`, answers "is the keyboard up".** That var is
 * the distance a bottom-anchored element must lift, and WebKit collapses it to
 * 0 when it pans the page instead of shrinking the viewport, with a keyboard
 * very much on screen. DESIGN.md § "The four inset vars" is the contract.
 */
class KeyboardState {
	open = $state(false);
	/** Occluded height in CSS px; 0 while closed. */
	height = $state(0);

	set(open: boolean, height: number) {
		this.open = open;
		this.height = height;
	}
}

export const keyboard = new KeyboardState();

/** Occlusion in CSS px below which this is an input accessory bar, not a keyboard. */
const KEYBOARD_FLOOR = 120;

/** One viewport reading, in CSS px: what the keyboard covers, and how far a
 *  bottom-anchored element must lift to clear it. */
export interface KeyboardChange {
	open: boolean;
	occlusion: number;
	lift: number;
}

/** Starts publishing `--kb-inset-bottom` and the `keyboard` store; the returned
 *  function stops and releases both. `onChange` runs after each publish, for a
 *  shell with insets of its own to settle against this one. */
export function trackKeyboard(onChange?: (change: KeyboardChange) => void): () => void {
	const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
	if (!vv) return () => {};

	const root = document.documentElement;

	const update = () => {
		// Scaled, because pinch zoom shrinks the visual viewport exactly as a
		// keyboard does, and undoing the zoom leaves what a keyboard covers.
		const occlusion = Math.max(0, window.innerHeight - vv.height * vv.scale);
		const lift = Math.max(0, occlusion - vv.offsetTop);
		const open = occlusion > KEYBOARD_FLOOR;

		root.style.setProperty('--kb-inset-bottom', `${Math.round(lift)}px`);
		keyboard.set(open, open ? Math.round(occlusion) : 0);
		onChange?.({ open, occlusion, lift });
	};

	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	update();

	return () => {
		vv.removeEventListener('resize', update);
		vv.removeEventListener('scroll', update);
		root.style.removeProperty('--kb-inset-bottom');
		keyboard.set(false, 0);
	};
}
