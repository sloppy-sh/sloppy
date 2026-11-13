/**
 * The conversations this device is holding with an agent, one per thread,
 * whoever is talking into them: the desk's chat in front of somebody, and a
 * headset speaking to the desk. docs/ARCHITECTURE.md § "A headset beside the
 * desk" and § "Asking a tool to write the notes".
 *
 * `stores/chat.svelte.ts` is what the desk SHOWS of these — the thread in front
 * of somebody, what it holds them to — and `serving/chat.ts` is what a headset
 * is sent. Both read the same record of a thread, so what is said from either
 * is the same thread on the other.
 */

import type { Files } from '@sloppy/local';
import {
	type BuildRole,
	type BuildToolCall,
	type ChatActDone,
	type ChatAgent,
	type ChatAttachment,
	type ChatBlock,
	type ChatCallId,
	type ChatEvent,
	chatModels,
	type ChatPlace,
	type ChatSessionId,
	type ChatSpend,
	type ChatSurface,
	type ChatThread,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatToolName,
	chatToolWrites,
	type ChatTurn,
	type ContextUsage,
	contextTogether,
	isChatToolCall,
	MAX_TURNS_PER_SESSION,
	type SloppyToolCall,
	spentTogether,
	type StandingDraft,
	type Ulid
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { serveChatCall } from './chat-acts.js';
import { carriedOver, placesKey, withCarried, withPlaces } from './chat-said.js';
import { runtime, type ChatLive } from './runtime.js';
import { seam } from './seam.svelte.js';
import { chatDraft } from './stores/chat-draft.svelte.js';
import { wordsFor } from './stores/errors.js';
import { prefs } from './stores/prefs.svelte.js';
import { doingIn, troubleIn, whatHappened } from './stores/what-happened.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNSAID = 'Sloppy could not send that just now. Try again.';
const MODEL_UNKNOWN = "That model isn't one this assistant knows. Pick another.";

/** Said once, quietly, where a conversation goes on without what came before
 *  it: the agent's own session was not there to pick up. */
const PICKED_UP = 'The assistant is going on from a summary of this thread.';

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';
const NO_PLACE =
	'There is no place here by that name. Name one you were given, or leave it out to read this project.';
const PLACE_UNREAD = 'That place cannot be read from here.';
const NO_NOTES_THERE = 'There are no notes in that place. Read its files with your own tools.';
const NOT_IN_A_CHAT =
	'That act belongs to a build. Here there is only this conversation and these notes.';

/** A reading act asked for a place it cannot have. The agent reads these
 *  words and acts on them, so one is answered rather than thrown past the
 *  shell, which has no words of its own for what went wrong. */
export class PlaceRefused extends Error {}

function agentTurn(conversation?: Ulid): ChatTurn {
	return {
		from: 'agent',
		blocks: [],
		at: new Date().toISOString(),
		...(conversation === undefined ? {} : { conversation })
	};
}

/** What the agent is told about what was put in front of it, which is where to
 *  read it. */
export function withAttached(said: string, attached: readonly ChatAttachment[]): string {
	if (attached.length === 0) return said;
	const lines = attached.map((one) => `- ${one.name} — ${one.path}`).join('\n');
	const says = `Attached, in this project:\n${lines}`;
	return said === '' ? says : `${said}\n\n${says}`;
}

/** What an act came to, for the record: whether it worked and how much it left
 *  different — never what it read, wrote or answered with. */
export function cameTo(done: ChatActDone): string {
	if (done.trouble === true)
		return `did not work${done.told === undefined ? '' : `: ${done.told}`}`;
	const left = done.touched?.length ?? 0;
	return left === 0 ? 'is done' : `is done, leaving ${left} note${left === 1 ? '' : 's'} different`;
}

/** Whose turn a block is arriving into: the thread's own conversation, which
 *  names none, or one of a build's sessions, which names its own. */
export interface Writing {
	writingTurn: ChatTurn | null;
	conversation?: Ulid;
}

/** What one of a build's sessions tells the store running the build. What it
 *  SAID is on the thread; these are what a build acts on. */
export type BuildHeard =
	| { heard: 'context'; usage: ContextUsage }
	| { heard: 'ended'; spent?: ChatSpend }
	/** The conversation is over, whichever way it ended. `said` is why it could
	 *  not go on, in words for the person; absent is one that simply ended. */
	| { heard: 'over'; said?: string };

/** One conversation of a build, on the build's own thread. A build runs several
 *  at once, so what a chat keeps on its thread — the handle, the turn being
 *  written into — each of these keeps for itself. */
export class Session {
	handle: ChatLive | null = null;
	/** The agent's turn this conversation is writing into; `null` is one not
	 *  writing. It is the turn ITSELF rather than where it stands, because
	 *  another conversation's turn lands between them. */
	writingTurn: ChatTurn | null = null;
	/** An event that lands after this session was let go of is not an event
	 *  about whatever was opened in its place. */
	epoch = 0;

	constructor(
		readonly conversation: Ulid,
		readonly role: BuildRole,
		readonly cwd: string,
		readonly serve: (call: BuildToolCall) => Promise<ChatActDone>,
		readonly heard: (what: BuildHeard) => void
	) {}
}

/** An answer somebody asked to keep as a note, waiting on their say-so. It is
 *  the person's own act, so nothing the agent's turn does answers it.
 *
 *  `arguments` is carried untouched; a surface parses it against the act's own
 *  schema before drawing any of it. */
export interface ChatKeeping {
	call: ChatCallId;
	act: ChatToolName;
	arguments: unknown;
	/** Where the turn whose answer it would keep stands. */
	at: number;
}

/**
 * One thread's conversation and everything arriving in it. A thread read again
 * is read off its own record, so a thread answering while somebody is
 * elsewhere goes on filling its own.
 */
export class Live {
	/** The thread as it was last kept, which every write to it is made from. */
	thread: ChatThread;
	/** The folder a thread works in where it is not the one in front of the
	 *  desk — a headset reading another of the folders open there. **Absent is
	 *  the desk's own.** */
	home: Files | undefined = undefined;
	/** What the shell answered `open` with. Absent is a thread with nothing
	 *  standing, which the next thing said opens one for. */
	handle: ChatLive | null = null;
	/** The draft this thread's writing lands in, once it has one. */
	draft: StandingDraft | null = null;
	turns = $state.raw<readonly ChatTurn[]>([]);
	/** The places the standing conversation was opened with, which is what an
	 *  act naming one is answered against. */
	places: readonly ChatPlace[] = [];
	context = $state.raw<ContextUsage | null>(null);
	standing = $state(false);
	running = $state(false);
	/** The agent's turn this thread's own conversation is writing into; `null`
	 *  is one not writing. */
	writingTurn: ChatTurn | null = null;
	/** The sessions a build is running on this thread, by conversation. EMPTY
	 *  is every chat, and a build whose sessions are all over. */
	readonly sessions = new SvelteMap<Ulid, Session>();
	keeping = $state.raw<ChatKeeping | null>(null);
	keepSettling = $state(false);
	stopping = $state(false);
	/** What each of Sloppy's own acts came to, for the person — the agent read
	 *  its own half and this is the rest of it. */
	readonly done = new SvelteMap<ChatCallId, ChatActDone>();
	/** What came of keeping a turn's answer, by where that turn stands. */
	readonly kept = new SvelteMap<number, ChatActDone>();
	attached = $state.raw<readonly ChatAttachment[]>([]);
	trouble = $state.raw<string | null>(null);
	says = $state.raw<string | null>(null);
	/** Which model the standing conversation was opened with, so a person who
	 *  picks another is told the one in front of them still answers. */
	openedWith = $state.raw<string | undefined>(undefined);
	/** Which agent the standing conversation was opened with. */
	openedAs: ChatAgent | undefined = undefined;
	/** Who the standing conversation was opened for, which decides the acts and
	 *  the brief it has. */
	openedFor: ChatSurface = 'desk';
	/** Whether the agent has written anything in the standing conversation,
	 *  which is what tells a model it refused from any other way one dies. */
	answered = false;
	/** An earlier conversation to carry into the next one, where the person
	 *  moved this thread to another agent. */
	carrying: string | null = null;
	/** The places the standing conversation has been told it may read, as
	 *  {@link placesKey}; `null` is one that has not been told. */
	placesTold: string | null = null;
	/** The conversation this thread asked to be picked up; `started` says
	 *  whether it was. Undefined is a conversation of the agent's own, whose
	 *  brief told it everything a picked-up one has to be told in words. */
	asked: ChatSessionId | undefined = undefined;
	/** Whether `started` has said which conversation answers. The first one
	 *  decides; a later one is the same conversation begun again after making
	 *  room. */
	introduced = false;
	/** The agent and model the last conversation died under, for the person to
	 *  be offered another. */
	failed = $state.raw<{ agent: ChatAgent; model?: string } | null>(null);
	spentTurn = $state.raw<ChatSpend | undefined>(undefined);
	spentSession = $state.raw<ChatSpend | undefined>(undefined);
	/** An event that lands after this conversation was let go of is not an event
	 *  about the one standing in its place. */
	epoch = 0;

	constructor(thread: ChatThread) {
		this.thread = thread;
		this.turns = thread.turns;
		this.spentSession = thread.spent;
	}
}

/** What a turn begun in a thread is said with. */
export interface Saying {
	agent?: ChatAgent;
	model?: string;
	/** What a conversation opened for this turn may read beside the project. */
	places: readonly ChatPlace[];
	attached: readonly ChatAttachment[];
	/** **Absent is the desk.** */
	surface?: ChatSurface;
}

/** Somebody away from the desk following one thread. */
export interface ChatListener {
	/** Every event of the thread's own conversation, after the thread has
	 *  taken it in. */
	heard(event: ChatEvent): void;
	/** One of Sloppy's own acts done in it, once the agent has its answer. */
	acted?(call: ChatToolCall, done: ChatActDone): void;
}

class ChatEngine {
	/** One record per thread with a conversation of its own. */
	readonly #live = new SvelteMap<Ulid, Live>();
	readonly #listening = new Map<Ulid, readonly ChatListener[]>();
	readonly #kept = new Set<(thread: ChatThread) => void>();
	/** Which thread the desk has in front of somebody. */
	#reading: (id: Ulid) => boolean = () => false;
	/** The writes to the chats this device holds, in the order they were asked
	 *  for. */
	#writes: Promise<void> = Promise.resolve();

	/** Tell the engine how to ask which thread the desk is reading. */
	readBy(reading: (id: Ulid) => boolean): void {
		this.#reading = reading;
	}

	live(id: Ulid): Live | undefined {
		return this.#live.get(id);
	}

	/** Every thread with a record, answering or standing. */
	all(): Live[] {
		return [...this.#live.values()];
	}

	/** The thread's own record, made where it has none. */
	liveFor(thread: ChatThread): Live {
		const held = this.#live.get(thread.id);
		if (held) return held;
		const live = new Live(thread);
		this.#live.set(thread.id, live);
		return live;
	}

	forget(id: Ulid): void {
		this.#live.delete(id);
	}

	/** Follow one thread's conversation until the disposer is called. */
	listen(thread: Ulid, listener: ChatListener): () => void {
		this.#listening.set(thread, [...(this.#listening.get(thread) ?? []), listener]);
		return () => {
			const left = (this.#listening.get(thread) ?? []).filter((one) => one !== listener);
			if (left.length === 0) this.#listening.delete(thread);
			else this.#listening.set(thread, left);
		};
	}

	/** Whether anybody away from the desk is following the thread. */
	listened(id: Ulid): boolean {
		return this.#listening.has(id);
	}

	/** Whether the thread has somebody in front of it, on the desk or away. */
	held(id: Ulid): boolean {
		return this.#reading(id) || this.listened(id);
	}

	/** Told each thread as it is kept, before it is written. */
	onKept(on: (thread: ChatThread) => void): () => void {
		this.#kept.add(on);
		return () => this.#kept.delete(on);
	}

	/** One at a time, in the order they were asked for: two of them are a turn
	 *  ending and a session saying what it is, and the later write carries what
	 *  the earlier one did. */
	async keep(thread: ChatThread): Promise<void> {
		const live = this.#live.get(thread.id);
		if (live) live.thread = thread;
		for (const on of this.#kept) on(thread);
		const threads = runtime.threads();
		if (!threads) return;
		this.#writes = this.#writes
			.then(() => threads.write(thread))
			.catch((error: unknown) => {
				whatHappened.put('trouble', `the chat was not kept: ${troubleIn(error)}`);
			});
		await this.#writes;
	}

	/** One thread's own record, changed and kept — which is what an event
	 *  arriving in a thread nobody is reading writes through. */
	async keepFor(live: Live, changed: Partial<ChatThread>): Promise<void> {
		await this.keep({ ...live.thread, ...changed, updated_at: new Date().toISOString() });
	}

	/**
	 * Say something into the thread, which begins a turn — starting the
	 * conversation where none stands, and the draft it works in where none
	 * stands either. What goes wrong is said on the thread's `trouble`.
	 */
	async say(live: Live, said: string, how: Saying): Promise<void> {
		const access = seam().chat();
		if (!access) return;
		const { attached } = how;
		const surface = how.surface ?? 'desk';
		// Said from the other surface, the conversation is opened again for this
		// one, picking up where it was by its session.
		if (live.standing && live.openedFor !== surface) this.letSessionGo(live);
		const epoch = live.epoch;
		live.trouble = null;
		live.says = null;
		live.failed = null;
		live.running = true;
		live.writingTurn = null;
		live.attached = [];
		const blocks: ChatBlock[] = [
			...(said === '' ? [] : [{ kind: 'said' as const, said }]),
			...(attached.length === 0 ? [] : [{ kind: 'attached' as const, attached: [...attached] }])
		];
		const before = live.turns;
		live.turns = [...live.turns, { from: 'person', blocks, at: new Date().toISOString() }];
		const opening = !live.standing;
		if (opening) {
			const { agent, model } = how;
			live.places = [...how.places];
			try {
				// The agent runs where the draft is, so the copy exists before the
				// conversation that works in it.
				await this.writesInto(live);
			} catch (error) {
				whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
				if (epoch !== live.epoch) return;
				live.trouble = wordsFor(error) ?? UNSTARTED;
				live.running = false;
				return;
			}
			const thread = live.thread;
			const session =
				thread.session !== undefined && thread.agent === agent ? thread.session : undefined;
			live.asked = session;
			live.placesTold = this.#placesOpenedWith(live, session);
			if (session === undefined && before.length > 0) live.carrying ??= carriedOver(before);
			// The shell says this only into a conversation opened in place of one
			// the agent would not pick up; a conversation picked up has it already.
			const carried = session !== undefined && before.length > 0 ? carriedOver(before) : undefined;
			const cwd = live.home === undefined ? undefined : (live.draft?.root ?? live.home.root);
			const named = agent === undefined ? [] : chatModels(agent);
			let handle: ChatLive;
			try {
				handle = await access.open(
					{
						...(agent === undefined ? {} : { agent }),
						...(model === undefined ? {} : { model }),
						thread: {
							id: thread.id,
							...(session === undefined ? {} : { session }),
							places: [...live.places]
						},
						reachesWeb: prefs.current.chatReachesWeb,
						...(carried === undefined ? {} : { carried }),
						...(how.surface === undefined ? {} : { surface: how.surface }),
						...(cwd === undefined ? {} : { cwd })
					},
					(event) => this.#heard(live, epoch, event, named),
					(call) => this.#serve(live, call)
				);
			} catch (error) {
				whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
				if (epoch !== live.epoch) return;
				live.trouble = wordsFor(error) ?? UNSTARTED;
				live.running = false;
				return;
			}
			if (epoch !== live.epoch) {
				// Let go of while it was still starting, so nothing points at it.
				void handle.close().catch(() => {});
				return;
			}
			live.handle = handle;
			live.standing = true;
			live.openedWith = model;
			live.openedAs = agent;
			live.openedFor = surface;
			await this.keepFor(live, {
				...(agent === undefined ? {} : { agent }),
				...(model === undefined ? {} : { model })
			});
		}
		const carried = live.carrying ?? '';
		live.carrying = null;
		try {
			await live.handle?.say(
				withCarried(carried, this.#namingPlaces(live, withAttached(said, attached)))
			);
		} catch (error) {
			whatHappened.put('trouble', `the agent was not told: ${troubleIn(error)}`);
			if (epoch !== live.epoch) return;
			live.trouble = wordsFor(error) ?? UNSAID;
			live.running = false;
		}
	}

	/** End the turn underway. The conversation stands, and the next thing said
	 *  goes on with it. */
	async stop(live: Live): Promise<void> {
		if (!live.handle || live.stopping) return;
		whatHappened.put('turn', 'an end to the turn was asked for');
		live.stopping = true;
		try {
			await live.handle.stop();
		} finally {
			live.stopping = false;
		}
	}

	/**
	 * A thread somebody away from the desk has stopped following, left the way
	 * the desk leaves one: its conversation waits for whoever comes back to it,
	 * unless chats go on answering wherever their reader is. One still followed
	 * elsewhere, or in front of somebody on the desk, is not left at all.
	 */
	leave(live: Live): void {
		if (this.held(live.thread.id)) return;
		if (!prefs.current.chatInBackground) this.letSessionGo(live);
		if (!live.standing && live.sessions.size === 0) this.#live.delete(live.thread.id);
	}

	/** A thread nobody is reading that has nothing left to answer: its
	 *  conversation let go of, and its record with it. */
	letGoOutOfSight(live: Live): void {
		this.letSessionGo(live);
		if (live.sessions.size === 0) this.#live.delete(live.thread.id);
	}

	letSessionGo(live: Live): void {
		if (live.standing) {
			void live.handle?.close().catch(() => {});
			// A turn cut off part way through has what arrived so far on screen,
			// and the thread is where somebody finds it again.
			if (live.running) void this.keepFor(live, { turns: [...live.turns] });
		}
		live.epoch += 1;
		live.handle = null;
		live.standing = false;
		live.running = false;
		live.writingTurn = null;
		live.keeping = null;
		live.keepSettling = false;
		this.#letAttachedGo(live);
		live.openedWith = undefined;
		live.openedAs = undefined;
		live.answered = false;
		live.asked = undefined;
		live.introduced = false;
		live.spentTurn = undefined;
		live.placesTold = null;
		live.trouble = null;
		live.says = null;
	}

	/** What was put in front of a conversation that is being let go was never
	 *  said, so nothing reads it again and it comes off where it was put. */
	#letAttachedGo(live: Live): void {
		const held = live.attached;
		live.attached = [];
		if (held.length === 0) return;
		void this.written(live)
			.then((project) => Promise.all(held.map((one) => project?.remove(one.path))))
			.catch(() => {});
	}

	/** What the conversation now standing has been told about its places: the
	 *  set the brief names for one Sloppy OPENED, and nothing for one picked
	 *  up, which never reads that brief. */
	#placesOpenedWith(live: Live, session: ChatSessionId | undefined): string | null {
		return session === undefined ? placesKey(live.places) : null;
	}

	/** What is said, with the places this thread reads named to the agent where
	 *  what its conversation was told is not the set in front of the person. */
	#namingPlaces(live: Live, said: string): string {
		const key = placesKey(live.places);
		if (key === live.placesTold) return said;
		live.placesTold = key;
		return live.places.length === 0 ? said : withPlaces(live.places, said);
	}

	#heard(
		live: Live,
		epoch: number,
		event: ChatEvent,
		models: readonly { model: string; name: string }[]
	): void {
		if (epoch !== live.epoch) return;
		switch (event.event) {
			case 'started': {
				live.standing = true;
				const named = models.find((one) => one.model === event.model)?.name;
				whatHappened.put(
					'turn',
					`the chat opened with ${named ?? 'whatever the agent answers with'}, and the agent has ${event.tools.length} tools`
				);
				if (!live.introduced) {
					live.introduced = true;
					if (live.asked !== undefined && live.asked !== event.session) {
						whatHappened.put('turn', 'the conversation was not picked up where it was left');
						live.says = PICKED_UP;
						live.asked = undefined;
					}
				} else {
					// Begun again after making room: what it was told in words went
					// with the rest, and the brief is still its own.
					live.placesTold = this.#placesOpenedWith(live, live.asked);
				}
				void this.keepFor(live, { session: event.session });
				break;
			}
			case 'block':
				live.answered = true;
				this.block(live, live, event.at, event.block);
				break;
			case 'context':
				live.context = contextTogether(live.context ?? undefined, event.usage);
				break;
			case 'ended':
				whatHappened.put(
					'turn',
					event.stopped === true ? 'the turn was stopped' : 'the turn ended'
				);
				live.running = false;
				live.writingTurn = null;
				if (event.spent !== undefined) {
					live.spentTurn = event.spent;
					live.spentSession = spentTogether(live.spentSession, event.spent);
				}
				live.turns = live.turns.slice(-MAX_TURNS_PER_SESSION);
				void this.keepFor(live, {
					turns: [...live.turns],
					...(live.spentSession === undefined ? {} : { spent: live.spentSession })
				});
				void chatDraft.keepWhatTheTurnWrote(live.draft ?? undefined);
				// A thread answering out of sight was left to finish, and it has:
				// what it said is on the thread, and the next thing said there
				// picks the conversation up by its session.
				if (!this.held(live.thread.id)) this.letGoOutOfSight(live);
				break;
			case 'over': {
				if (event.said === undefined) whatHappened.put('turn', 'the chat is over');
				else whatHappened.put('trouble', 'the chat could not go on');
				const refusedModel =
					event.said !== undefined && !live.answered && live.openedWith !== undefined;
				if (event.said !== undefined && live.openedAs !== undefined) {
					live.failed = {
						agent: live.openedAs,
						...(live.openedWith === undefined ? {} : { model: live.openedWith })
					};
				}
				// What the agent had written when it ended is on screen; the thread
				// is where somebody finds it again.
				if (live.running) void this.keepFor(live, { turns: [...live.turns] });
				live.handle = null;
				live.standing = false;
				live.running = false;
				live.writingTurn = null;
				live.openedWith = undefined;
				live.openedAs = undefined;
				live.answered = false;
				live.asked = undefined;
				live.introduced = false;
				live.trouble = refusedModel ? MODEL_UNKNOWN : (event.said ?? null);
				break;
			}
		}
		for (const listener of this.#listening.get(live.thread.id) ?? []) {
			listener.heard(event);
		}
	}

	/**
	 * A block already at this place in the turn underway is that block grown.
	 * `into` is whose turn that is — the thread's own conversation, or one of a
	 * build's sessions, which is why the turn is held rather than its place: a
	 * build runs several at once and each one's turn stays its own.
	 */
	block(live: Live, into: Writing, at: number, block: ChatBlock): void {
		const turns = [...live.turns];
		let where = into.writingTurn === null ? -1 : turns.indexOf(into.writingTurn);
		if (where < 0) {
			where = turns.length;
			turns.push(agentTurn(into.conversation));
		}
		const turn = turns[where];
		const blocks = [...turn.blocks];
		if (at < blocks.length) blocks[at] = block;
		else blocks.push(block);
		const grown = { ...turn, blocks };
		turns[where] = grown;
		into.writingTurn = grown;
		live.turns = turns;
	}

	/**
	 * Where this thread's acts and the files put in front of it are written: the
	 * draft it keeps one in, and the project itself where this device keeps
	 * none. A turn beginning is what starts a draft, so this starts one where
	 * the thread has none. REJECTS in words the agent reads.
	 */
	async writesInto(live: Live): Promise<Files> {
		const drafts = seam().chat()?.drafts;
		if (!drafts) {
			const project = live.home ?? (await runtime.project());
			if (!project) throw new Error(NO_PROJECT);
			return project;
		}
		// The draft somebody is looking at is the thread in front of them; a
		// thread answering out of their sight writes into its own and moves
		// nothing of theirs.
		const draft =
			live.draft ??
			(await (this.#reading(live.thread.id)
				? chatDraft.start(live.thread.id)
				: chatDraft.started(live.thread.id, live.home?.root)));
		live.draft = draft;
		return drafts.files(draft);
	}

	/** The same folder, for taking something back off it: a draft that is not
	 *  standing holds nothing to take off, so this starts none. */
	async written(live: Live): Promise<Files | undefined> {
		const drafts = seam().chat()?.drafts;
		if (!drafts) return live.home ?? (await runtime.project());
		return live.draft ? drafts.files(live.draft) : undefined;
	}

	/**
	 * Where one act reads or writes, and whether that folder is one this chat
	 * only reads. A writing act lands in this thread's own draft, whatever it
	 * says; a reading act answers for the place it names, and for this project
	 * where it names none. A place it cannot have is answered in words the
	 * agent reads.
	 */
	async #filesFor(live: Live, call: ChatToolCall): Promise<{ files: Files; reading: boolean }> {
		const place = chatToolWrites(call.act) ? undefined : this.#placeNamed(live, call);
		if (!place) return { files: await this.writesInto(live), reading: false };
		if (place.graph === undefined) throw new PlaceRefused(NO_NOTES_THERE);
		const files = seam().placeFiles()?.(place.root);
		if (!files) throw new PlaceRefused(PLACE_UNREAD);
		return { files, reading: true };
	}

	/** The place a reading act asks for, or none where it asks for this
	 *  project. A place this thread's conversation was not given is answered as
	 *  such. */
	#placeNamed(live: Live, call: ChatToolCall): ChatPlace | undefined {
		const named = 'in' in call.arguments ? call.arguments.in : undefined;
		if (named === undefined || named === '') return undefined;
		const place = live.places.find((one) => one.name === named);
		if (!place) throw new PlaceRefused(NO_PLACE);
		return place;
	}

	/** One of Sloppy's own acts, done here and answered to the agent. What the
	 *  act lays out for the PERSON is held here; the agent reads `said` and
	 *  nothing else. */
	async #serve(live: Live, call: SloppyToolCall): Promise<ChatToolAnswer> {
		if (!isChatToolCall(call)) return { said: NOT_IN_A_CHAT, trouble: true };
		const done = await this.act(live, call);
		live.done.set(call.call, done);
		for (const listener of this.#listening.get(live.thread.id) ?? []) {
			listener.acted?.(call, done);
		}
		return { said: done.said, ...(done.trouble === undefined ? {} : { trouble: done.trouble }) };
	}

	async act(live: Live, call: ChatToolCall): Promise<ChatActDone> {
		whatHappened.put('act', `${doingIn(call.act)} began`, call.call);
		try {
			const where = await this.#filesFor(live, call);
			const done: ChatActDone = await serveChatCall(where.files, call, where.reading);
			whatHappened.put(
				done.trouble === true ? 'trouble' : 'act',
				`${doingIn(call.act)} ${cameTo(done)}`,
				call.call
			);
			return done;
		} catch (error) {
			whatHappened.put(
				'trouble',
				`${doingIn(call.act)} did not answer: ${troubleIn(error)}`,
				call.call
			);
			if (error instanceof PlaceRefused) return { said: error.message, trouble: true };
			throw error;
		}
	}
}

export const chatEngine = new ChatEngine();
