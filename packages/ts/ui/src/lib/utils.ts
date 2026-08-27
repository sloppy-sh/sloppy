import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The class merge every shadcn-svelte component imports. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// The prop-shape helpers shadcn-svelte generates against, under the `utils`
// alias `components.json` points at. Re-running the CLI regenerates imports of
// these, so they live here rather than anywhere tidier.

/* eslint-disable @typescript-eslint/no-explicit-any -- the test is "does this
   prop exist at all", which a narrower type would answer wrongly for a snippet. */
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
