// Settings is read a section at a time (DESIGN.md § Layout), so a suite about
// one of them says which it is standing in — and a section the page does not
// hold is one the contents do not name.

import { flushSync } from 'svelte';

const entries = (): HTMLButtonElement[] => [
	...document.body.querySelectorAll<HTMLButtonElement>('nav[aria-label="On this page"] button')
];

/** The sections the page holds, by name, in its own order. */
export function sectionsOffered(): string[] {
	return entries().map((one) => one.textContent?.trim() ?? '');
}

/** Stand in one of them, the way somebody does: from the contents. */
export function standIn(name: string): void {
	const entry = entries().find((one) => one.textContent?.trim() === name);
	if (!entry) throw new Error(`No "${name}" section on the page`);
	entry.click();
	flushSync();
}
