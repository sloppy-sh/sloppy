/**
 * Shared on-screen-keyboard state: one writer — the native shell's viewport
 * tracker, the only code that can measure a WebView keyboard — and many
 * readers. Stays closed wherever nothing tracks it, which is the web.
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
