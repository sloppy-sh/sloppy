// The subjects bench/subjects marks private, read at build; bench/README.md § "The export".
import { resolve } from 'node:path';
import { privateSubjects } from '../../../../../../bench/lib/private.mjs';

export const HIDDEN: Map<string, string> = privateSubjects(
	resolve(process.cwd(), '../../../bench/subjects')
);

const nameOf = (name: string, flags = 'i') => new RegExp(`\\b${name}\\b`, flags);

/** Whether `text` names a private subject, as a word, in any case. */
export const namesHidden = (text: string) =>
	[...HIDDEN.keys()].some((name) => nameOf(name).test(text));

/** `text` with every private subject's name put as its label, since another project's documents may name one. */
export const unnamed = (text: string) =>
	[...HIDDEN].reduce((t, [name, label]) => t.replace(nameOf(name, 'gi'), label), text);
