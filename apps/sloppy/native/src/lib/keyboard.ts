/**
 * The webview's viewport truth, and the single writer of `--kb-inset-bottom`
 * and `--safe-area-inset-bottom`. It also drives `@sloppy/app-core`'s `keyboard`
 * store, which is what answers "is the keyboard up". DESIGN.md § "The four inset
 * vars" is the contract for all three.
 *
 * Two platform facts it exists to absorb.
 * `tauri-plugin-safe-area-insets-css` restores `--safe-area-inset-bottom` on
 * `keyboardWillHide`, which fires at the START of the dismissal, and publishes
 * nothing at all if its init throws. Meanwhile WebKit ties
 * `env(safe-area-inset-bottom)` to the keyboard — 0 while it covers the home
 * indicator, inflated by the accessory bar while it animates away. So: sample a
 * plausible bar only while no keyboard is up, re-assert it on every quiet pass,
 * and otherwise leave the plugin authoritative, since it is the only thing that
 * knows Android's nav-bar height.
 */

import { keyboard } from '@sloppy/app-core';

/** iOS home indicator 34pt, Android 3-button nav 48pt. Larger than this is
 *  keyboard contamination, not a bar. */
const MAX_SYSTEM_BAR = 64;
/** Occlusion in CSS px below which this is an input accessory bar, not a keyboard. */
const KEYBOARD_FLOOR = 120;
/** Fights per keyboard session before WebKit's pan is allowed to win — a page
 *  that legitimately wants the offset must not loop forever. */
const MAX_PAN_CORRECTIONS = 3;

/** `env(safe-area-inset-bottom)` in CSS px, read through a probe element. */
function envSafeAreaBottom(): number {
	const probe = document.createElement('div');
	probe.style.cssText =
		'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none';
	document.body.appendChild(probe);
	const h = probe.getBoundingClientRect().height;
	probe.remove();
	return h;
}

/** Starts tracking; the returned function stops it and releases both vars. */
export function trackKeyboardInset(): () => void {
	const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
	if (!vv) return () => {};

	const root = document.documentElement;
	/** Sampled ONLY while no keyboard is up. */
	let stableSafeBottom = 0;
	let wasOpen = false;
	let panCorrections = 0;
	let settle = 0;
	/** The probe costs a forced layout and these events can fire per scroll
	 *  frame, so read `env()` once and let the plugin's value take over. */
	let probed = false;

	const publishedSafeBottom = () => {
		const v = parseFloat(root.style.getPropertyValue('--safe-area-inset-bottom'));
		return Number.isFinite(v) && v > 0 && v <= MAX_SYSTEM_BAR ? v : 0;
	};

	/**
	 * Undo WebKit's scroll assist, ONLY where the pan is unambiguously wrong: a
	 * document that cannot scroll has no business being scrolled, and there the
	 * pan is what slides the canvas up under the status bar. A genuinely
	 * scrollable page never reaches this — WebKit scrolls the document and leaves
	 * `offsetTop` at 0.
	 */
	const cancelPan = () => {
		if (vv.offsetTop <= 1 || panCorrections >= MAX_PAN_CORRECTIONS) return;
		const doc = document.scrollingElement ?? document.documentElement;
		if (doc.scrollHeight > doc.clientHeight + 1) return;
		panCorrections++;
		doc.scrollTop = 0;
		window.scrollTo(0, 0);
		// The layout has since lifted the focused field clear, so re-running
		// WebKit's own "reveal it" pass now resolves to no pan at all.
		const active = document.activeElement;
		if (active instanceof HTMLElement) active.scrollIntoView({ block: 'nearest' });
	};

	const update = () => {
		const occlusion = Math.max(0, window.innerHeight - vv.height);
		const lift = Math.max(0, occlusion - vv.offsetTop);
		const open = occlusion > KEYBOARD_FLOOR;

		root.style.setProperty('--kb-inset-bottom', `${Math.round(lift)}px`);
		keyboard.set(open, Math.round(occlusion));

		if (!open) {
			const published = publishedSafeBottom();
			if (published > 0) stableSafeBottom = published;
			else if (!probed) {
				probed = true;
				const measured = envSafeAreaBottom();
				if (measured > 0 && measured <= MAX_SYSTEM_BAR) stableSafeBottom = measured;
			}
			if (stableSafeBottom > 0) {
				root.style.setProperty('--safe-area-inset-bottom', `${stableSafeBottom}px`);
			}
			panCorrections = 0;
		} else if (!wasOpen) {
			// The keyboard covers the home indicator, so there is no bar left to
			// clear — the real inset here would float a composer above the keys.
			root.style.setProperty('--safe-area-inset-bottom', '0px');
		}
		wasOpen = open;

		// The pan/resize pair arrives as two events; mid-flight geometry is
		// meaningless, so let it settle.
		cancelAnimationFrame(settle);
		settle = requestAnimationFrame(() => requestAnimationFrame(cancelPan));
	};

	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	update();

	return () => {
		cancelAnimationFrame(settle);
		vv.removeEventListener('resize', update);
		vv.removeEventListener('scroll', update);
		root.style.removeProperty('--kb-inset-bottom');
		keyboard.set(false, 0);
	};
}
