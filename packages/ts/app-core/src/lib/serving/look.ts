// `look/list` — every look the desk could wear, painted as the desk would paint
// it: docs/ARCHITECTURE.md § "A headset beside the desk".

import type { ServeMethodTable } from '@sloppy/local';
import { LOOK_LIST, LOOK_NAME_MAX, type LookListed, type LooksListed } from '@sloppy/types';
import { dressed, schemes } from '@sloppy/ui';
import { BUILT_IN_LOOKS, type BuiltInLook, LOOK_LABELS } from '../stores/prefs.svelte.js';

/** The colours `app.css` paints one of Sloppy's own looks with, and which way
 *  its ground runs: every colour its `:root[data-look='…']` blocks declare. A
 *  token those blocks write as another token is left to the headset. */
function ownLook(css: string, look: BuiltInLook): LookListed {
	const selector = `:root[data-look='${look}']`;
	const palette: Record<string, string> = {};
	let variant: LookListed['variant'] = 'light';
	for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (!selectors.split(',').some((one) => one.trim() === selector)) continue;
		for (const declaration of body.split(';')) {
			const colon = declaration.indexOf(':');
			if (colon < 0) continue;
			const name = declaration.slice(0, colon).trim();
			const value = declaration.slice(colon + 1).trim();
			if (name === 'color-scheme') variant = value === 'dark' ? 'dark' : 'light';
			else if (name.startsWith('--') && /^(oklch\(|#)/.test(value)) palette[name] = value;
		}
	}
	return { id: look, name: LOOK_LABELS[look], variant, palette };
}

async function listed(): Promise<LooksListed> {
	const { default: written } = await import('@sloppy/ui/styles?raw');
	const css = written.replace(/\/\*[\s\S]*?\*\//g, '');
	const collection: LookListed[] = [];
	for (const scheme of await schemes()) {
		const dressing = dressed(scheme);
		if (dressing === null) continue;
		const name = scheme.name.trim().slice(0, LOOK_NAME_MAX);
		const author = scheme.author.trim();
		collection.push({
			id: scheme.slug,
			name: name === '' ? scheme.slug : name,
			variant: dressing.variant,
			...(author === '' ? {} : { author }),
			palette: { ...dressing.tokens }
		});
	}
	collection.sort(
		(a, b) =>
			Number(a.variant === 'dark') - Number(b.variant === 'dark') || a.name.localeCompare(b.name)
	);
	return { looks: [...BUILT_IN_LOOKS.map((look) => ownLook(css, look)), ...collection] };
}

let held: Promise<LooksListed> | undefined;

/** Every look the desk could wear. Worked out once; a read that failed is not
 *  held, so the next ask works it out again. */
export function looksListed(): Promise<LooksListed> {
	held ??= listed().catch((why: unknown) => {
		held = undefined;
		throw why;
	});
	return held;
}

export const lookMethods: ServeMethodTable = {
	[LOOK_LIST]: { queued: false, handle: looksListed }
};
