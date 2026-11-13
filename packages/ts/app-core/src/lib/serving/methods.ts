// What a desk answers a headset with beyond what every serving loop answers —
// docs/ARCHITECTURE.md § "A headset beside the desk".

import type { ServeMethod, ServeMethodTable } from '@sloppy/local';

const table: Record<string, ServeMethod> = {};
const hearing = new Set<(connection: string) => void>();

/**
 * Answer the methods in `methods` from every loop serving from here, from now
 * until the disposer is called; `closed` is told each connection that goes. A
 * method already registered keeps its first registration.
 */
export function registerServeMethods(
	methods: ServeMethodTable,
	closed?: (connection: string) => void
): () => void {
	const added = Object.keys(methods).filter((name) => !(name in table));
	for (const name of added) table[name] = methods[name];
	if (closed) hearing.add(closed);
	return () => {
		for (const name of added) delete table[name];
		if (closed) hearing.delete(closed);
	};
}

/** Every method registered, read as each line arrives. */
export const servedMethods: ServeMethodTable = table;

/** Tells every registration that `connection` has gone. */
export function servedClosed(connection: string): void {
	for (const closed of hearing) closed(connection);
}
