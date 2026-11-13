// `ServeAccess` over `src-tauri/src/serve.rs`: the commands that serve, show a
// code, stop, say what is served, forget a headset and send a line, and the events
// each line comes by and each connection ends with.

import type { ServeAccess } from '@sloppy/app-core';
import type { ServeCall, ServeReach, Serving } from '@sloppy/types';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Invoke } from './files';

/** `listen` from `@tauri-apps/api/event`, as far as this file reads it. */
export type Listen = <T>(event: string, on: (event: { payload: T }) => void) => Promise<() => void>;

const CALL_EVENT = 'serve:call';

const CLOSED_EVENT = 'serve:closed';

const WENT_WRONG = 'Serving could not start here. Try again.';

function refused(thrown: unknown): Error {
	return new Error(typeof thrown === 'string' && thrown !== '' ? thrown : WENT_WRONG);
}

/** A disposer for a listener that is still being registered. */
function disposer(registering: Promise<() => void>): () => void {
	return () => {
		void registering.then((stop) => stop()).catch(() => {});
	};
}

export function tauriServe(call: Invoke = invoke, hear: Listen = listen as Listen): ServeAccess {
	const asking = async <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
		await call<T>(command, args).catch((thrown) => {
			throw refused(thrown);
		});
	const sending = async (connection: string, line: string): Promise<void> => {
		await call<void>('serve_answer', { connection, line });
	};
	return {
		start: (reach: ServeReach, relay?: string) =>
			asking<Serving>('serve_start', { reach, relay: relay ?? null }),
		pair: () => asking<Serving>('serve_pair'),
		stop: () => asking<void>('serve_stop'),
		status: async () => (await asking<Serving | null>('serve_status')) ?? undefined,
		forget: (id: string) => asking<void>('serve_forget', { id }),
		calls(on: (call: ServeCall) => void): () => void {
			return disposer(hear<ServeCall>(CALL_EVENT, (event) => on(event.payload)));
		},
		closed(on: (connection: string) => void): () => void {
			return disposer(
				hear<{ connection: string }>(CLOSED_EVENT, (event) => on(event.payload.connection))
			);
		},
		answer: (connection: string, line: string) => sending(connection, line),
		notify: (connection: string, line: string) => sending(connection, line)
	};
}
