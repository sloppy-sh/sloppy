import type { Attachment } from 'svelte/attachments';

/**
 * Fades a scroller's edges, but only where its content actually continues past
 * them. DESIGN.md § Scrolling asks for exactly that; a mask cannot ask whether
 * an element overflows, so `scroll-fade-*` rests at no fade and this turns it
 * on. Without it a list too short to scroll has its first row half erased.
 *
 * The start edge fades only once it has been scrolled away from, so a list at
 * rest shows its first row whole.
 */
export function scrollFade(axis: 'y' | 'x' = 'y'): Attachment<HTMLElement> {
	return (node) => {
		const measure = () => {
			const vertical = axis === 'y';
			const seen = vertical ? node.clientHeight : node.clientWidth;
			const all = vertical ? node.scrollHeight : node.scrollWidth;
			const at = vertical ? node.scrollTop : node.scrollLeft;
			const past = all - seen;
			// A subpixel of slack: a scroller at rest reports fractional offsets
			// on a scaled display, and a 0.5px "overflow" is not content.
			const scrolls = past > 1;
			const depth = getComputedStyle(node).getPropertyValue('--scroll-fade').trim() || '1.5rem';
			node.style.setProperty('--fade-start', scrolls && at > 1 ? depth : '0px');
			node.style.setProperty('--fade-end', scrolls && at < past - 1 ? depth : '0px');
		};

		measure();
		node.addEventListener('scroll', measure, { passive: true });
		// Both boxes matter: the scroller resizing, and its content growing inside
		// a scroller that did not.
		const sizes = new ResizeObserver(measure);
		sizes.observe(node);
		for (const child of node.children) sizes.observe(child);
		const children = new MutationObserver(() => {
			for (const child of node.children) sizes.observe(child);
			measure();
		});
		children.observe(node, { childList: true });

		return () => {
			node.removeEventListener('scroll', measure);
			sizes.disconnect();
			children.disconnect();
		};
	};
}
