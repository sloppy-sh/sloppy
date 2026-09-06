/** A caller's own `did`, so a suite can watch what the surface writes back. */
export function asking(did: string | null): { did: string | null } {
	const held = $state({ did });
	return held;
}
