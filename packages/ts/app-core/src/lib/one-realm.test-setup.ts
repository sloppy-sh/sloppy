// jsdom hands out a `TextEncoder` whose arrays belong to another realm, so
// `bytes instanceof Uint8Array` is FALSE inside a bundled dependency and a
// library that branches on it reads a file as a folder. A browser has one
// realm; this gives the suite the same.

const Foreign = globalThis.TextEncoder;

class OneRealmTextEncoder extends Foreign {
	override encode(input?: string): Uint8Array<ArrayBuffer> {
		const foreign = super.encode(input);
		const here = new Uint8Array(foreign.length);
		here.set(foreign);
		return here;
	}
}

globalThis.TextEncoder = OneRealmTextEncoder;
