// `chat/*` — the desk's chat, spoken to from a headset:
// docs/ARCHITECTURE.md § "A headset beside the desk".

import {
	type Files,
	placeApi,
	type ProjectServed,
	type ServeCaller,
	ServeRefused,
	type ServeMethodTable
} from '@sloppy/local';
import {
	type ChatAgent,
	type ChatBlock,
	type ChatEventServed,
	type ChatOpened,
	type ChatThread,
	type ChatThreadServed,
	type ChatThreadsListed,
	type ChatTurn,
	CHAT_CLOSE,
	CHAT_EVENT,
	CHAT_OPEN,
	CHAT_OPEN_TURNS,
	CHAT_SAID_CUT,
	CHAT_SAY,
	CHAT_STOP,
	CHAT_THREADS,
	NO_AGENT_SAID,
	type OwnedRef,
	SERVE_REFUSALS,
	threadNameFrom,
	ulid,
	type Ulid,
	VIEW_SHOW,
	type ViewShow
} from '@sloppy/types';
import { chatEngine } from '../chat-engine.svelte.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { prefs } from '../stores/prefs.svelte.js';

/** The desk's own sentence for a thread it will not leave mid-answer. */
export const STILL_ANSWERING = 'The assistant is still answering. Stop it first.';
export const NO_SUCH_THREAD = "That thread isn't here any more.";
export const NO_NOTES_HERE = 'There are no notes here to talk about.';
export const NOTHING_SAID = 'Say something first.';

/** A thread one connection is following. */
interface Following {
	caller: ServeCaller;
	root: string;
	stop: () => void;
}

/** By connection, then by thread. */
const following = new Map<string, Map<Ulid, Following>>();
/** Threads a connection opened new and has said nothing into yet, so they are
 *  not on the desk: the folder each is about and who opened it. */
const fresh = new Map<Ulid, { root: string; connection: string }>();
/** The connection that last said something into each thread, which is where
 *  the note the assistant shows is shown. */
const driving = new Map<Ulid, string>();

/** The folder a served project is, where it holds notes. */
function folderOf(project: ProjectServed): Files {
	const files = project.server.files;
	if (files === undefined) throw new ServeRefused(-32602, NO_NOTES_HERE);
	return files;
}

function threadNamed(params: Record<string, unknown>): Ulid {
	const thread = params.thread;
	if (typeof thread !== 'string' || thread === '') {
		throw new ServeRefused(-32602, NO_SUCH_THREAD);
	}
	return thread as Ulid;
}

/** The chat threads about `root`, newest first and the archived ones last. */
export async function threadsOf(root: string): Promise<ChatThreadServed[]> {
	const held = (await runtime.threads()?.list()) ?? [];
	const about = held
		.filter((one) => one.project === root && (one.kind ?? 'chat') === 'chat')
		.map((one) => chatEngine.live(one.id)?.thread ?? one);
	const newest = (a: ChatThread, b: ChatThread) => b.updated_at.localeCompare(a.updated_at);
	const open = about.filter((one) => one.archived_at === undefined).sort(newest);
	const archived = about.filter((one) => one.archived_at !== undefined).sort(newest);
	return [...open, ...archived].map((one) => ({
		id: one.id,
		name: one.name,
		updated_at: one.updated_at,
		archived: one.archived_at !== undefined,
		answering: chatEngine.live(one.id)?.running === true
	}));
}

/** The agent a headset's turn is said to: the one picked on the desk where the
 *  desk reaches it, else the first it reaches. */
async function agentHere(): Promise<{ agent: ChatAgent; model?: string }> {
	const held =
		(await seam()
			.chat()
			?.agents()
			.catch(() => [])) ?? [];
	if (held.length === 0) throw new ServeRefused(SERVE_REFUSALS.NO_AGENT, NO_AGENT_SAID);
	const picked = prefs.current.chatAgent;
	const agent = picked !== null && held.includes(picked) ? picked : held[0];
	const model = prefs.current.chatModel[agent];
	return model === undefined ? { agent } : { agent, model };
}

/** Under the desk's rule, one thread of a folder answers at a time unless the
 *  person lets chats go on in the background. */
function answeringBeside(root: string, id: Ulid | undefined): boolean {
	if (prefs.current.chatInBackground) return false;
	return chatEngine
		.all()
		.some((live) => live.running && live.thread.project === root && live.thread.id !== id);
}

async function threadIn(root: string, id: Ulid): Promise<ChatThread> {
	const thread =
		chatEngine.live(id)?.thread ??
		(await runtime
			.threads()
			?.read(id)
			.catch(() => undefined));
	if (thread === undefined || thread.project !== root || (thread.kind ?? 'chat') !== 'chat') {
		throw new ServeRefused(-32602, NO_SUCH_THREAD);
	}
	return thread;
}

function cut(said: string): string {
	return said.length > CHAT_SAID_CUT ? `${said.slice(0, CHAT_SAID_CUT)}…` : said;
}

function blockServed(block: ChatBlock): ChatBlock {
	if ('said' in block && typeof block.said === 'string') return { ...block, said: cut(block.said) };
	if (
		block.kind === 'tool_call' &&
		JSON.stringify(block.arguments ?? null).length > CHAT_SAID_CUT
	) {
		const rest = { ...block };
		delete rest.arguments;
		return rest;
	}
	return block;
}

/** The last turns, each one's writing cut short enough for one line. */
export function turnsServed(turns: readonly ChatTurn[]): ChatTurn[] {
	return turns
		.slice(-CHAT_OPEN_TURNS)
		.map((turn) => ({ ...turn, blocks: turn.blocks.map(blockServed) }));
}

/** Push the note the assistant showed to the connection that asked for it. */
async function show(caller: ServeCaller, files: Files, note: OwnedRef): Promise<void> {
	const held = await placeApi(files)
		.getNode(note)
		.catch(() => null);
	if (!held) return;
	const shown: ViewShow = {
		note: held.ref,
		title: held.title,
		...(held.address === undefined ? {} : { address: held.address })
	};
	caller.notify(VIEW_SHOW, shown);
}

function follow(caller: ServeCaller, id: Ulid, root: string, files: Files): void {
	const held = following.get(caller.id) ?? new Map<Ulid, Following>();
	following.set(caller.id, held);
	if (held.has(id)) return;
	const stop = chatEngine.listen(id, {
		heard(event) {
			const served: ChatEventServed = { thread: id, event };
			caller.notify(CHAT_EVENT, served);
		},
		acted(call, done) {
			if (call.act !== 'show_note' || done.trouble === true) return;
			if (driving.get(id) !== caller.id) return;
			void show(caller, files, call.arguments.note);
		}
	});
	held.set(id, { caller, root, stop });
}

/** A connection stops following a thread, which the desk leaves the way it
 *  leaves one nobody is reading. */
function unfollow(connection: string, id: Ulid): void {
	const held = following.get(connection);
	const one = held?.get(id);
	if (!held || !one) return;
	one.stop();
	held.delete(id);
	if (held.size === 0) following.delete(connection);
	if (driving.get(id) === connection) driving.delete(id);
	if (fresh.get(id)?.connection === connection) fresh.delete(id);
	const live = chatEngine.live(id);
	if (live) chatEngine.leave(live);
}

/** Where chats wait for their reader, opening one thread leaves the others
 *  this connection had of the same folder. */
function leaveTheOthers(connection: string, root: string, id: Ulid): void {
	if (prefs.current.chatInBackground) return;
	for (const [other, one] of following.get(connection) ?? []) {
		if (other !== id && one.root === root) unfollow(connection, other);
	}
}

export const chatMethods: ServeMethodTable = {
	[CHAT_THREADS]: {
		queued: false,
		async handle(_params, project): Promise<ChatThreadsListed> {
			const files = project.server.files;
			return { threads: files === undefined ? [] : await threadsOf(files.root) };
		}
	},
	[CHAT_OPEN]: {
		queued: false,
		async handle(params, project, connection): Promise<ChatOpened> {
			const files = folderOf(project);
			const root = files.root;
			await agentHere();
			const asked = params.thread === undefined ? undefined : threadNamed(params);
			if (answeringBeside(root, asked)) {
				throw new ServeRefused(SERVE_REFUSALS.ANSWERING, STILL_ANSWERING);
			}
			let opened: ChatOpened['thread'];
			if (asked === undefined) {
				const id = ulid();
				fresh.set(id, { root, connection: connection.id });
				opened = { id, name: '', turns: [] };
			} else if (fresh.get(asked)?.root === root) {
				opened = { id: asked, name: '', turns: [] };
			} else {
				const thread = await threadIn(root, asked);
				const turns = chatEngine.live(asked)?.turns ?? thread.turns;
				opened = { id: asked, name: thread.name, turns: turnsServed(turns) };
			}
			leaveTheOthers(connection.id, root, opened.id);
			follow(connection, opened.id, root, files);
			return { thread: opened };
		}
	},
	[CHAT_SAY]: {
		queued: false,
		async handle(params, project, connection): Promise<Record<string, never>> {
			const files = folderOf(project);
			const root = files.root;
			const id = threadNamed(params);
			const said = typeof params.said === 'string' ? params.said.trim() : '';
			if (said === '') throw new ServeRefused(-32602, NOTHING_SAID);
			const { agent, model } = await agentHere();
			if (chatEngine.live(id)?.running === true || answeringBeside(root, id)) {
				throw new ServeRefused(SERVE_REFUSALS.ANSWERING, STILL_ANSWERING);
			}
			const thread =
				fresh.get(id)?.root === root ? await minted(id, files, said) : await threadIn(root, id);
			const live = chatEngine.liveFor(thread);
			live.home ??= files;
			follow(connection, id, root, files);
			driving.set(id, connection.id);
			await chatEngine.say(live, said, {
				agent,
				...(model === undefined ? {} : { model }),
				places: live.thread.places,
				attached: [],
				surface: 'headset'
			});
			if (!live.running && live.trouble !== null) throw new ServeRefused(-32603, live.trouble);
			return {};
		}
	},
	[CHAT_STOP]: {
		queued: false,
		async handle(params): Promise<Record<string, never>> {
			const live = chatEngine.live(threadNamed(params));
			if (live) await chatEngine.stop(live);
			return {};
		}
	},
	[CHAT_CLOSE]: {
		queued: false,
		async handle(params, _project, connection): Promise<Record<string, never>> {
			unfollow(connection.id, threadNamed(params));
			return {};
		}
	}
};

/** A thread opened new from a headset, kept and named from the first thing
 *  said into it, the way the desk names one. */
async function minted(id: Ulid, files: Files, said: string): Promise<ChatThread> {
	const graph = await placeApi(files)
		.graphHere()
		.catch(() => undefined);
	if (graph === undefined) throw new ServeRefused(-32602, NO_NOTES_HERE);
	const at = new Date().toISOString();
	const thread: ChatThread = {
		id,
		name: threadNameFrom(said),
		graph,
		project: files.root,
		created_at: at,
		updated_at: at,
		places: [],
		turns: []
	};
	fresh.delete(id);
	chatEngine.liveFor(thread);
	await chatEngine.keep(thread);
	return thread;
}

/** Told each connection that has gone, so what it held of a thread is let go. */
export function chatClosed(connection: string): void {
	for (const id of [...(following.get(connection)?.keys() ?? [])]) unfollow(connection, id);
	for (const [id, one] of fresh) if (one.connection === connection) fresh.delete(id);
}
