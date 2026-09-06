/**
 * What this device keeps for the person signed in — DESIGN.md § "Persistence"
 * is the doc of record for what belongs here and what does not.
 *
 * Scoped by identity and by area, so two surfaces cannot collide and one
 * person's keys go when they sign out. Values are stored as the browser clones
 * them, so hand it plain data: a Svelte `$state` proxy is not cloneable.
 */

const DATABASE = 'sloppy_device';
const STORE = 'entries';
/** Sorts below every character a DID, an area or a key can hold, so one
 *  identity's range cannot run into the next, and no area's keys can spell
 *  another's. */
const SEPARATOR = '\u0000';
const LAST = '\uffff';

export interface DeviceArea {
	get<T>(key: string): Promise<T | undefined>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	/** The keys this area holds, without the scope in front of them. */
	keys(): Promise<string[]>;
	clear(): Promise<void>;
}

interface Backing {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
	keysUnder(prefix: string): Promise<string[]>;
	dropUnder(prefix: string): Promise<void>;
}

function scope(did: string, area?: string): string {
	return area === undefined ? `${did}${SEPARATOR}` : `${did}${SEPARATOR}${area}${SEPARATOR}`;
}

/** `null` where this device has no store to keep anything in: the identifier is
 *  missing, a browser told to block site data throws on the accessor, or the
 *  open is refused. Memory then holds what a page is given, for as long as the
 *  page lives. */
function openDatabase(): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		let request: IDBOpenDBRequest;
		try {
			request = indexedDB.open(DATABASE, 1);
		} catch {
			resolve(null);
			return;
		}
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function storedBacking(db: IDBDatabase): Backing {
	const write = (work: (store: IDBObjectStore) => IDBRequest): Promise<void> =>
		settle(work(db.transaction(STORE, 'readwrite').objectStore(STORE))).then(() => undefined);
	const range = (prefix: string) => IDBKeyRange.bound(prefix, prefix + LAST);
	return {
		get: (key) => settle(db.transaction(STORE, 'readonly').objectStore(STORE).get(key)),
		set: (key, value) => write((store) => store.put(value, key)),
		delete: (key) => write((store) => store.delete(key)),
		keysUnder: async (prefix) => {
			const keys = await settle(
				db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(range(prefix))
			);
			return keys.map((key) => String(key).slice(prefix.length));
		},
		dropUnder: (prefix) => write((store) => store.delete(range(prefix)))
	};
}

function memoryBacking(): Backing {
	const held = new Map<string, unknown>();
	const under = (prefix: string) => [...held.keys()].filter((key) => key.startsWith(prefix));
	return {
		get: async (key) => held.get(key),
		set: async (key, value) => {
			held.set(key, value);
		},
		delete: async (key) => {
			held.delete(key);
		},
		keysUnder: async (prefix) => under(prefix).map((key) => key.slice(prefix.length)),
		dropUnder: async (prefix) => {
			for (const key of under(prefix)) held.delete(key);
		}
	};
}

let opening: Promise<Backing> | null = null;

function backing(): Promise<Backing> {
	if (opening) return opening;
	opening = (async () => {
		const db = await openDatabase();
		return db ? storedBacking(db) : memoryBacking();
	})();
	return opening;
}

class DeviceStore {
	/** One identity's corner of the device, under a name the caller picks. */
	area(did: string, name: string): DeviceArea {
		const prefix = scope(did, name);
		return {
			get: async <T>(key: string): Promise<T | undefined> =>
				(await (await backing()).get(prefix + key)) as T | undefined,
			set: async (key, value) => (await backing()).set(prefix + key, value),
			delete: async (key) => (await backing()).delete(prefix + key),
			keys: async () => (await backing()).keysUnder(prefix),
			clear: async () => (await backing()).dropUnder(prefix)
		};
	}

	/** Everything this device kept for one identity, in every area. */
	async forget(did: string): Promise<void> {
		await (await backing()).dropUnder(scope(did));
	}
}

export const deviceStore = new DeviceStore();
