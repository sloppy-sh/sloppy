import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The class merge every shadcn-svelte component imports. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
