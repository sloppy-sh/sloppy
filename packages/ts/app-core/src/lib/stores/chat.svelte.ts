/**
 * The chats with an agent about the project in front of somebody: the threads
 * this device holds, the one being read, and what is arriving in each one now.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * **One live conversation per thread, and how many stand at once is this
 * store's rule.** `#leave` below is a chat waiting for the person who left it,
 * unless they asked for chats to go on answering wherever they are; one that
 * goes on stands until its turn is done and is let go of there. A thread
 * answering out of sight arrives in its own record and writes into its own
 * draft, so nothing of it lands in the thread somebody is reading. The records
 * themselves are `chat-engine.svelte.ts`'s, which a headset speaks into too.
 *
 * Every act LANDS: a thread works in a draft of the notes that is its own, so
 * nothing here waits on the person and nothing of theirs changes while it
 * runs. `stores/chat-draft.svelte.ts` is the draft somebody is LOOKING at, and
 * what they do with one.
 *
 * Nothing here parses what arrives: the seam parses in both directions and
 * rejects with the words this store shows.
 */

import { attachedAt, type Files } from '@sloppy/local';
import {
	type BuildRole,
	type BuildToolCall,
	CHAT_ASKED_MAX,
	CHAT_ATTACHED_NAME_MAX,
	CHAT_ATTACHMENT_MAX,
	type ChatActDone,
	type ChatAgent,
	chatAgentName,
	type ChatAttachment,
	type ChatCallId,
	type ChatEvent,
	type ChatModel,
	chatModels,
	type ChatPlace,
	type ChatSpend,
	type ChatThread,
	type ChatToolAnswer,
	type ChatTurn,
	toolsForRole,
	type ContextUsage,
	isChatToolCall,
	MAX_TURNS_PER_SESSION,
	MOST_ATTACHED_PER_TURN,
	MOST_PLACES,
	type OwnedRef,
	placeNamed,
	type SloppyToolCall,
	threadNameFrom,
	ulid,
	type Ulid,
	type WriteNoteArguments
} from '@sloppy/types';
import {
	type BuildHeard,
	cameTo,
	chatEngine,
	type ChatKeeping,
	type Live,
	PlaceRefused,
	Session,
	withAttached
} from '../chat-engine.svelte.js';
import { serveChatCall } from '../chat-acts.js';
import { carriedOver, threadAsMarkdown } from '../chat-said.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { chatDraft } from './chat-draft.svelte.js';
import { wordsFor } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { doingIn, troubleIn, whatHappened } from './what-happened.svelte.js';

export type { BuildHeard, ChatKeeping } from '../chat-engine.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNKEPT = 'Sloppy could not keep that just now. Try again.';
const UNATTACHED = 'Sloppy could not put that where the chat can read it. Try again.';
const TOO_MANY = `You can put ${MOST_ATTACHED_PER_TURN} things in front of it at once.`;
const UNDELETED = 'That thread could not be deleted just now. Try again.';

const STILL_ANSWERING = 'The assistant is still answering. Stop it first.';
const NO_SUCH_THREAD = "That thread isn't here any more.";
const TOO_MANY_PLACES = `A thread reads ${MOST_PLACES} places besides its own project.`;
const UNREACHED_PLACE = 'Sloppy cannot read that folder from here. Choose another.';
const SETTLE_FIRST =
	'Some of what that thread wrote has to be settled against your own notes first. Read the draft.';

/** And where the places changed under a conversation that is standing. */
const PLACES_MOVED =
	'The next thing you say starts the assistant again, so it can read what you changed.';

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';
const NO_GRAPH = 'There are no notes open here to work on.';
const NOT_THIS_SESSION =
	'That act is not one this session does. The acts you were given are the whole of what you can call here.';
const NO_BUILD_WORK =
	'The copy of the project you are working in cannot be read from here, so there is nothing to act on.';

/** What a file with no name of its own is called. */
const UNNAMED = 'A file';

/** The agents this device has. `null` is a device nobody has asked, and
 *  `'untold'` one whose answer did not arrive — which is not the answer a
 *  device with no agent gives. */
export type ChatAgents = readonly ChatAgent[] | 'untold' | null;

/**
 * What becomes of a thread's draft when the thread is deleted: taken into the
 * person's notes first, or thrown away with the thread. `'merge'` is refused
 * where the two copies have anything to settle, because settling is the
 * review's act and not this one's.
 *
 * **Keeping the draft is not one of these.** A draft is reached by its thread's
 * id and by nothing else, so keeping the writing is keeping the THREAD —
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 */
export type DraftOnDelete = 'merge' | 'discard';

/** The words of a person's turn, without what was attached. */
function saidOf(turn: ChatTurn): string {
	return turn.blocks.flatMap((block) => (block.kind === 'said' ? [block.said] : [])).join('\n');
}

/** What the attachment lines take of what one turn carries, so the composer
 *  can only be typed as far as the rest of it. */
function roomTaken(attached: readonly ChatAttachment[]): number {
	return withAttached('', attached).length;
}

/** The same thread, out of the archive. */
function liveAgain(thread: ChatThread): ChatThread {
	const held = { ...thread };
	delete held.archived_at;
	return held;
}

/** What a build asks for one of its sessions: which build — and so which
 *  thread — which conversation of it, what it is FOR, the folder it works in
 *  and what it is told before anything is said. */
export interface BuildAsked {
	build: Ulid;
	conversation: Ulid;
	role: BuildRole;
	cwd: string;
	brief: string;
}

/** One of a build's sessions, as the build holds it. */
export interface BuildSessionLive {
	say(said: string): Promise<void>;
	/** Ask the agent how full its window is; the answer arrives at `heard`.
	 *  An agent this shell cannot ask is not a failure. */
	askContext(): Promise<void>;
	close(): Promise<void>;
}

class ChatStore {
	#of = $state.raw<OwnedRef | null>(null);
	/** The project the threads in front of somebody belong to, as the platform
	 *  spells a folder. */
	#project: string | null = null;
	#threads = $state.raw<readonly ChatThread[]>([]);
	#current = $state.raw<ChatThread | null>(null);
	/** The chat in front of somebody that this device holds no record of yet:
	 *  somewhere for a file to land before anything has been said. */
	#unwritten: Ulid | null = null;
	/** Unasked until somebody opens the chat: asking sooner would look for a
	 *  program nobody asked for. */
	#agents = $state.raw<ChatAgents>(null);
	/** The places the chat in front of somebody reads, which a thread nothing
	 *  has been said into yet carries into the thread it becomes. */
	#places = $state.raw<readonly ChatPlace[]>([]);
	/** One record per thread with a conversation of its own: the thread in front
	 *  of somebody, and every thread still answering out of their sight. */
	/** What went wrong where there is no thread to say it about. */
	#trouble = $state.raw<string | null>(null);

	constructor() {
		chatEngine.readBy((id) => this.#current?.id === id);
		chatEngine.onKept((thread) => this.#listed(thread));
	}

	/** Whether this device can chat at all. Absent everywhere but the shell that
	 *  can reach an agent, which is what keeps the offer off the web. */
	get reaches(): boolean {
		return seam().chat() !== undefined;
	}

	get agents(): ChatAgents {
		return this.#agents;
	}

	/** The agent this chat is with: the one the person picked where this device
	 *  reaches it, else the first it reaches. Absent until this device has said
	 *  what it has. */
	get agent(): ChatAgent | undefined {
		const held = this.#agents;
		if (!Array.isArray(held) || held.length === 0) return undefined;
		const picked = prefs.current.chatAgent;
		return picked !== null && held.includes(picked) ? picked : held[0];
	}

	/**
	 * Whether the chat is put in front of anybody at all: this device can reach
	 * an agent, the person asked for one, and something answers. **Unanswered
	 * is not offered**, so nothing appears before the device has said what it
	 * has.
	 */
	get offered(): boolean {
		const held = this.#agents;
		return this.reaches && prefs.current.aiOffered && Array.isArray(held) && held.length > 0;
	}

	/** The chats about this project that have not been put aside, the one
	 *  written to most recently first. */
	get threads(): readonly ChatThread[] {
		return this.#threads.filter((one) => one.archived_at === undefined);
	}

	/** And the ones that have, under their own heading. */
	get archived(): readonly ChatThread[] {
		return this.#threads.filter((one) => one.archived_at !== undefined);
	}

	/** The chat being read. `null` is one nothing has been said into yet, which
	 *  takes an id the first time anything is. */
	get current(): ChatThread | null {
		return this.#current;
	}

	/** Whether a thread is being answered while somebody is reading another one.
	 *  Only ever true while chats go on answering wherever the reader is. */
	answeringAway(id: Ulid): boolean {
		return id !== this.#current?.id && chatEngine.live(id)?.running === true;
	}

	/** What the chat has spent, where the agent says: the last turn, and the
	 *  conversation with this agent so far. */
	get spent(): { turn?: ChatSpend; session?: ChatSpend } {
		const live = this.#reading;
		return {
			...(live?.spentTurn === undefined ? {} : { turn: live.spentTurn }),
			...(live?.spentSession === undefined ? {} : { session: live.spentSession })
		};
	}

	/** How full the agent's window is, as the agent last said. `null` is a
	 *  conversation nothing has been said about yet. */
	get context(): ContextUsage | null {
		return this.#reading?.context ?? null;
	}

	/** Whether the conversation in front of somebody can be asked how full the
	 *  agent's window is. */
	get asksContext(): boolean {
		return this.#reading?.handle?.context !== undefined;
	}

	/** Whether this device can read a place beside the project at all. */
	get readsPlaces(): boolean {
		return seam().placeFiles() !== undefined;
	}

	/** The places this chat may read besides its own project. */
	get places(): readonly ChatPlace[] {
		return this.#places;
	}

	/** Where the last conversation died: which agent and model, for the person
	 *  to be offered another route. */
	get failedRoute(): { agent: ChatAgent; model?: string } | null {
		return this.#reading?.failed ?? null;
	}

	/**
	 * Answer with this agent and model from here on. Another agent takes the
	 * conversation so far with it: what is standing is let go of, and what was
	 * said is carried into the next one as the earlier conversation.
	 */
	pick(agent: ChatAgent, model: string | undefined): void {
		const held = { ...prefs.current.chatModel };
		if (model === undefined) delete held[agent];
		else held[agent] = model;
		prefs.set('chatModel', held);
		prefs.set('chatAgent', agent);
		const live = this.#reading;
		if (live?.standing === true && live.openedAs !== undefined && live.openedAs !== agent) {
			whatHappened.put('turn', `the conversation moved to ${chatAgentName(agent)}`);
			live.carrying = carriedOver(live.turns);
			this.#letSessionGo(live);
		}
	}

	/** Say the last thing again, to another agent, with the conversation before
	 *  it carried over. */
	async retryWith(agent: ChatAgent): Promise<void> {
		const live = this.#reading;
		if (!live) return;
		const turns = live.turns;
		const last = [...turns].reverse().find((turn) => turn.from === 'person');
		const words = last ? saidOf(last) : '';
		const before = last ? turns.slice(0, turns.lastIndexOf(last)) : turns;
		live.carrying = carriedOver(before);
		live.failed = null;
		if (live.standing) this.#letSessionGo(live);
		this.pick(agent, prefs.current.chatModel[agent]);
		live.turns = before;
		await this.say(words);
	}

	get turns(): readonly ChatTurn[] {
		return this.#reading?.turns ?? [];
	}

	/** Whether the agent is answering the last thing it was told. */
	get running(): boolean {
		return this.#reading?.running === true;
	}

	/** The answer somebody asked to keep, waiting on their say-so. */
	get keeping(): ChatKeeping | null {
		return this.#reading?.keeping ?? null;
	}

	/** Whether the note they asked to keep is being written and has not landed
	 *  yet. */
	get keepSettling(): boolean {
		return this.#reading?.keepSettling === true;
	}

	/** Whether an end has been asked for and has not landed yet. */
	get stopping(): boolean {
		return this.#reading?.stopping === true;
	}

	/** What went wrong, in words meant for the person. */
	get trouble(): string | null {
		const live = this.#reading;
		return live ? live.trouble : this.#trouble;
	}

	/** One quiet line about the conversation itself, which is not trouble. */
	get says(): string | null {
		return this.#reading?.says ?? null;
	}

	/** What one of Sloppy's own acts came to, for the person. */
	done(call: ChatCallId): ChatActDone | undefined {
		return this.#reading?.done.get(call);
	}

	/** What came of keeping the answer in the turn at `at`. */
	kept(at: number): ChatActDone | undefined {
		return this.#reading?.kept.get(at);
	}

	/** The models this chat's agent answers with, in the order somebody is
	 *  offered them. Empty until this device has said what it has. */
	get models(): readonly ChatModel[] {
		const agent = this.agent;
		return agent === undefined ? [] : chatModels(agent);
	}

	/** Which one they picked. **Absent is nobody having picked**, and the agent
	 *  answers with whatever it would on its own. */
	get model(): string | undefined {
		const agent = this.agent;
		return agent === undefined ? undefined : prefs.current.chatModel[agent];
	}

	setModel(model: string | undefined): void {
		const agent = this.agent;
		if (agent === undefined) return;
		const held = { ...prefs.current.chatModel };
		if (model === undefined) delete held[agent];
		else held[agent] = model;
		prefs.set('chatModel', held);
	}

	/**
	 * What the conversation on screen is being answered with, where that is not
	 * what they have picked: the model, or `'its own'` where it was opened
	 * before anybody picked one. Absent while the two agree, before anything
	 * has been said, and where it was opened with a model this agent no longer
	 * offers, which there is nothing to call in front of somebody.
	 */
	get answeringWith(): ChatModel | 'its own' | undefined {
		const live = this.#reading;
		const opened = live?.openedWith;
		if (live?.standing !== true || opened === this.model) return undefined;
		if (opened === undefined) return 'its own';
		return this.models.find((one) => one.model === opened);
	}

	/** What somebody has put in front of the agent alongside what they are
	 *  saying. */
	get attached(): readonly ChatAttachment[] {
		return this.#reading?.attached ?? [];
	}

	/** How much of a turn is left to type, once what is attached has its say. */
	get roomToSay(): number {
		return CHAT_ASKED_MAX - roomTaken(this.attached);
	}

	/**
	 * Somebody has opened this on `graph`. Another graph has not had this one's
	 * conversations, so what is held is let go of; the same one is picked up
	 * where it was left, in the thread most recently written to.
	 */
	async opened(graph: OwnedRef): Promise<void> {
		if (this.#of !== null && this.#of !== graph) this.clear();
		this.#of = graph;
		const held = this.#agents;
		if (held === null || held === 'untold') await this.lookForAgents();
		await chatDraft.look();
		await this.#readThreads();
	}

	/** Ask this device what it has. An ask that goes wrong is told apart from a
	 *  device with no agent, which would send somebody to install one they
	 *  have. */
	async lookForAgents(): Promise<void> {
		const access = seam().chat();
		if (!access) return;
		this.#agents = null;
		try {
			this.#agents = await access.agents();
		} catch (error) {
			this.#agents = 'untold';
			whatHappened.put(
				'trouble',
				`this device did not say what it can chat with: ${troubleIn(error)}`
			);
		}
	}

	/** Read one of the chats about this project, leaving the one that was in
	 *  front of somebody. */
	async openThread(id: Ulid): Promise<void> {
		if (this.#current?.id === id) return;
		if (this.#held) {
			this.#tell(STILL_ANSWERING);
			return;
		}
		const thread = this.#threads.find((one) => one.id === id);
		if (!thread) {
			this.#tell(NO_SUCH_THREAD);
			return;
		}
		await this.#unwrittenGoes(this.#letThreadGo());
		await this.#pickUp(thread);
	}

	/** Begin another chat about this project. It takes an id and a name the
	 *  first time anything is said into it, and the thread that was in front of
	 *  somebody is left — which is the way out of a conversation that is going
	 *  nowhere. */
	async startThread(): Promise<void> {
		if (this.#held) {
			this.#tell(STILL_ANSWERING);
			return;
		}
		await this.#unwrittenGoes(this.#letThreadGo());
		await chatDraft.standingFor();
	}

	/** Call the chat being read something else. Nothing is what
	 *  {@link threadNameFrom} makes of nothing. */
	async rename(name: string): Promise<void> {
		await this.#keepCurrent({ name: threadNameFrom(name) });
	}

	/** Put the chat being read aside. Its draft stands untouched, and the chat
	 *  most recently written to takes its place. */
	async archive(): Promise<void> {
		const live = this.#reading;
		if (live === undefined) return;
		if (live.running) {
			this.#tell(STILL_ANSWERING);
			return;
		}
		// A thread put aside has nothing left to answer, wherever its reader is.
		this.#letSessionGo(live);
		await this.#keepCurrent({ archived_at: new Date().toISOString() });
		await this.#readNext();
	}

	/** Take one back out of the archive. */
	async putBack(id: Ulid): Promise<void> {
		const thread = this.#threads.find((one) => one.id === id);
		if (!thread) {
			this.#tell(NO_SUCH_THREAD);
			return;
		}
		await this.#keep({ ...liveAgain(thread), updated_at: new Date().toISOString() });
	}

	/**
	 * Delete a chat, with what became of its draft already answered —
	 * {@link DraftOnDelete}, and **absent is thrown away with it**, which is a
	 * delete nothing had to be asked about. False is a chat that is still
	 * there, with {@link trouble} saying why; the chat being READ is left with
	 * its own draft in hand either way.
	 */
	async remove(id: Ulid, draft: DraftOnDelete = 'discard'): Promise<boolean> {
		const thread =
			this.#threads.find((one) => one.id === id) ??
			(this.#current?.id === id ? this.#current : undefined);
		if (!thread) {
			this.#tell(NO_SUCH_THREAD);
			return false;
		}
		const reading = this.#current?.id === id;
		const live = chatEngine.live(id);
		// One draft is read and settled at a time, so settling one while a turn
		// writes into another would settle whichever of the two is in hand.
		if (this.running || live?.running === true) {
			this.#tell(STILL_ANSWERING);
			return false;
		}
		// A thread that is going has nothing left to answer, wherever its reader
		// is.
		if (live) this.#letSessionGo(live);
		// The draft goes first: a thread deleted with its draft still standing
		// leaves writing nothing can reach.
		const gone = (await this.#draftGoes(id, draft)) && (await this.#threadGoes(id));
		if (gone) {
			this.#threads = this.#threads.filter((one) => one.id !== id);
			chatEngine.forget(id);
		}
		if (gone && reading) await this.#readNext();
		else await chatDraft.standingFor(this.#current?.id);
		return gone;
	}

	/** Add a place this thread may read besides its own project. A folder
	 *  already there is no second place, and a name already taken is held apart
	 *  from the place that has it — {@link placeNamed}. */
	async addPlace(place: ChatPlace): Promise<void> {
		if (this.#places.some((one) => one.root === place.root)) return;
		if (this.running) {
			this.#tell(STILL_ANSWERING);
			return;
		}
		if (this.#places.length >= MOST_PLACES) {
			this.#tell(TOO_MANY_PLACES);
			return;
		}
		if (seam().placeFiles()?.(place.root) === undefined) {
			this.#tell(UNREACHED_PLACE);
			return;
		}
		const named = placeNamed(
			this.#places.map((one) => one.name),
			place
		);
		await this.#placesNow([...this.#places, { ...place, name: named }]);
	}

	/** Take one back off it. */
	async removePlace(root: string): Promise<void> {
		if (!this.#places.some((one) => one.root === root)) return;
		if (this.running) {
			this.#tell(STILL_ANSWERING);
			return;
		}
		await this.#placesNow(this.#places.filter((one) => one.root !== root));
	}

	/** Ask the agent how full its window is; the answer arrives as an event.
	 *  Nothing standing has nothing to ask. */
	async askContext(detail: 'summary' | 'full' = 'summary'): Promise<void> {
		const live = this.#reading;
		if (live?.standing !== true || !live.handle?.context) return;
		try {
			await live.handle.context(detail);
		} catch (error) {
			whatHappened.put('trouble', `how full the window is was not said: ${troubleIn(error)}`);
		}
	}

	/** The whole chat being read, as markdown somebody can keep. Empty where
	 *  nothing has been said. */
	copyAsMarkdown(): string {
		const live = this.#reading;
		if (live === undefined) return '';
		return threadAsMarkdown({ ...live.thread, turns: [...live.turns] });
	}

	/**
	 * Say something, which begins a turn — starting the conversation where none
	 * stands, and the draft it works in where none stands either. Nothing is
	 * said while the agent is still answering the last turn, nor is the empty
	 * string with nothing attached.
	 */
	async say(words: string): Promise<void> {
		const access = seam().chat();
		const said = words.trim();
		const attached = this.attached;
		if (!access || (said === '' && attached.length === 0) || this.running) return;
		// A build is read, answered and stopped; there is no conversation on its
		// thread for anybody to type into.
		if (this.#current?.kind === 'build') return;
		whatHappened.put(
			'turn',
			attached.length === 0
				? 'a turn began'
				: `a turn began, with ${attached.length} file${attached.length === 1 ? '' : 's'} in front of it`
		);
		let live: Live;
		try {
			live = this.#liveFor(await this.#threadSaying(said));
		} catch (error) {
			whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
			this.#tell(wordsFor(error) ?? UNSTARTED);
			return;
		}
		await chatEngine.say(live, said, {
			...(this.agent === undefined ? {} : { agent: this.agent }),
			...(this.model === undefined ? {} : { model: this.model }),
			places: this.#places,
			attached
		});
	}

	/**
	 * Put files in front of the agent, which writes them where the agent works
	 * so that it reads them where it reads everything else. What comes back is
	 * what to tell the person where one of them did not go, and `null` where
	 * they all did.
	 */
	async attach(files: readonly File[]): Promise<string | null> {
		if (files.length === 0) return null;
		let live: Live;
		let project: Files;
		try {
			live = this.#liveFor(await this.#threadNow());
			project = await chatEngine.writesInto(live);
		} catch (error) {
			return wordsFor(error) ?? UNATTACHED;
		}
		let trouble: string | null = null;
		const held = [...live.attached];
		for (const file of files) {
			if (held.length >= MOST_ATTACHED_PER_TURN) {
				trouble = TOO_MANY;
				break;
			}
			if (file.size > CHAT_ATTACHMENT_MAX) {
				trouble = `“${file.name || UNNAMED}” is too big to send.`;
				continue;
			}
			const path = attachedAt(file.name);
			try {
				await project.write(path, new Uint8Array(await file.arrayBuffer()));
			} catch {
				trouble = UNATTACHED;
				continue;
			}
			held.push({ name: (file.name || UNNAMED).slice(0, CHAT_ATTACHED_NAME_MAX), path });
		}
		live.attached = held;
		return trouble;
	}

	/** Take one of them back off what is about to be said. */
	async takeOff(path: string): Promise<void> {
		const live = this.#reading;
		if (!live) return;
		live.attached = live.attached.filter((one) => one.path !== path);
		const project = await chatEngine.written(live);
		await project?.remove(path).catch(() => {});
	}

	/**
	 * Keep the answer in the turn at `at` as a note. It goes through the act the
	 * agent's writes go through, so it lands in the same draft and is read again
	 * in the same review; the card in front of it is where they read what it
	 * would be called before saying so.
	 */
	keep(at: number, asked: WriteNoteArguments): void {
		const live = this.#reading;
		if (!live || live.keeping !== null || live.keepSettling) return;
		live.kept.delete(at);
		live.keeping = { call: ulid(), act: 'write_note', arguments: asked, at };
	}

	/** Their answer to keeping it. */
	async keepIt(allowed: boolean): Promise<void> {
		const live = this.#reading;
		const keeping = live?.keeping ?? null;
		if (!live || keeping === null || live.keepSettling) return;
		live.keeping = null;
		if (!allowed) return;
		live.keepSettling = true;
		try {
			const done = await chatEngine.act(live, {
				call: keeping.call,
				act: 'write_note',
				arguments: keeping.arguments as WriteNoteArguments
			});
			live.kept.set(keeping.at, done);
		} catch (error) {
			live.kept.set(keeping.at, { said: '', trouble: true, told: wordsFor(error) ?? UNKEPT });
		} finally {
			live.keepSettling = false;
		}
	}

	/** End the turn underway in the chat being read. The conversation stands,
	 *  and the next thing said goes on with it. */
	async stop(): Promise<void> {
		const live = this.#reading;
		if (live) await chatEngine.stop(live);
	}

	/**
	 * The draft in front of somebody is gone, taken in or thrown away. Its
	 * conversation ran WHERE the draft was, so it is over with it; what was said
	 * stays on screen, and the next thing said opens another conversation in
	 * another draft.
	 */
	draftGone(): void {
		const live = this.#reading;
		if (!live) return;
		if (live.standing) this.#letSessionGo(live);
		live.draft = null;
	}

	/** Every thread standing out of sight waits for its reader again, which is
	 *  what asking for chats to wait means for the ones already standing. One
	 *  still answering finishes first and is let go of as its turn ends, and
	 *  one a headset has open is in front of its reader already. */
	leaveTheOthers(): void {
		for (const live of chatEngine.all()) {
			if (chatEngine.held(live.thread.id) || live.running) continue;
			this.#letGoOutOfSight(live);
		}
	}

	/** Another graph has not had this one's conversations. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		void this.#unwrittenGoes(this.#letThreadGo());
		for (const live of chatEngine.all()) {
			this.#letBuildGo(live);
			this.#leave(live);
		}
		this.#threads = [];
		chatDraft.clear();
		this.#of = null;
		this.#project = null;
		this.#agents = null;
		this.#trouble = null;
	}

	/**
	 * The thread a build stands in, made where this device holds none. **The
	 *  build's id is the thread's**, so the dock lists it beside the chats and
	 * every session's turns land on it; `kind` is what tells the two apart.
	 */
	async buildThread(asked: {
		build: Ulid;
		name: string;
		graph: OwnedRef;
		project: string;
	}): Promise<void> {
		if (await this.#threadRead(asked.build)) return;
		const at = new Date().toISOString();
		await this.#keep({
			id: asked.build,
			kind: 'build',
			build: asked.build,
			name: asked.name,
			graph: asked.graph,
			project: asked.project,
			created_at: at,
			updated_at: at,
			places: [],
			turns: []
		});
	}

	/**
	 * One session of a build, opened on the build's thread: the conversation
	 * standing under `asked.conversation` is ended and every other one of the
	 * build's is left running.
	 *
	 * `serve` is the build's own four acts — the chat's acts are served here,
	 * against the copy the session works in — and `heard` is what the build
	 * acts on. REJECTS in words for the person.
	 */
	async openBuild(
		asked: BuildAsked,
		serve: (call: BuildToolCall) => Promise<ChatActDone>,
		heard: (what: BuildHeard) => void
	): Promise<BuildSessionLive> {
		const access = seam().chat();
		if (!access) throw new Error(UNSTARTED);
		const thread = await this.#threadRead(asked.build);
		if (!thread) throw new Error(NO_SUCH_THREAD);
		const live = this.#liveFor(thread);
		const held = live.sessions.get(asked.conversation);
		if (held) this.#letSessionGoIn(live, held);
		const session = new Session(asked.conversation, asked.role, asked.cwd, serve, heard);
		live.sessions.set(asked.conversation, session);
		const epoch = session.epoch;
		const agent = this.agent;
		const model = this.model;
		const handle = await access.open(
			{
				...(agent === undefined ? {} : { agent }),
				...(model === undefined ? {} : { model }),
				thread: { id: thread.id, places: [] },
				conversation: asked.conversation,
				role: asked.role,
				cwd: asked.cwd,
				brief: asked.brief,
				reachesWeb: prefs.current.chatReachesWeb
			},
			(event) => this.#heardIn(live, session, epoch, event),
			(call) => this.#serveIn(live, session, call)
		);
		if (epoch !== session.epoch) {
			void handle.close().catch(() => {});
			throw new Error(UNSTARTED);
		}
		session.handle = handle;
		return {
			say: async (said: string) => {
				if (epoch !== session.epoch) return;
				live.turns = [
					...live.turns,
					{
						from: 'person',
						blocks: [{ kind: 'said', said }],
						at: new Date().toISOString(),
						conversation: asked.conversation
					}
				];
				await this.#keepFor(live, { turns: [...live.turns] });
				await handle.say(said);
			},
			askContext: async () => {
				if (epoch !== session.epoch) return;
				await handle.context?.('summary').catch(() => {});
			},
			close: async () => {
				if (epoch !== session.epoch) return;
				this.#letSessionGoIn(live, session);
				await handle.close().catch(() => {});
			}
		};
	}

	/** A build's thread gone, with every session of it: what it said goes with
	 *  it, and nothing of the person's is touched. */
	async buildGone(build: Ulid): Promise<void> {
		const live = chatEngine.live(build);
		if (live) {
			this.#letBuildGo(live);
			if (!live.standing) chatEngine.forget(build);
		}
		const reading = this.#current?.id === build;
		this.#threads = this.#threads.filter((one) => one.id !== build);
		await this.#threadGoes(build);
		if (reading) await this.#readNext();
	}

	/** The thread this device holds under that id: the one in hand, else the one
	 *  it keeps. A build's thread is written before its first session opens, so
	 *  a run that has not listed the threads yet still finds it. */
	async #threadRead(id: Ulid): Promise<ChatThread | undefined> {
		const held = this.#threads.find((one) => one.id === id) ?? chatEngine.live(id)?.thread;
		if (held) return held;
		try {
			return await runtime.threads()?.read(id);
		} catch {
			return undefined;
		}
	}

	/** Every session of a build on this thread let go of, and the build TOLD, so
	 *  what it was running is stopped rather than lost. */
	#letBuildGo(live: Live): void {
		for (const session of [...live.sessions.values()]) {
			const handle = session.handle;
			session.heard({ heard: 'over' });
			this.#letSessionGoIn(live, session);
			if (handle) void handle.close().catch(() => {});
		}
	}

	/** One session off the thread. Synchronous to the last line, so a caller
	 *  reading `sessions` straight after reads one without it. */
	#letSessionGoIn(live: Live, session: Session): void {
		session.epoch += 1;
		session.handle = null;
		session.writingTurn = null;
		live.sessions.delete(session.conversation);
	}

	#heardIn(live: Live, session: Session, epoch: number, event: ChatEvent): void {
		if (epoch !== session.epoch) return;
		switch (event.event) {
			case 'started':
				whatHappened.put('turn', `a build session opened with ${event.tools.length} tools`);
				break;
			case 'block':
				chatEngine.block(live, session, event.at, event.block);
				break;
			case 'context':
				session.heard({ heard: 'context', usage: event.usage });
				break;
			case 'ended':
				session.writingTurn = null;
				live.turns = live.turns.slice(-MAX_TURNS_PER_SESSION);
				void this.#keepFor(live, { turns: [...live.turns] });
				session.heard({
					heard: 'ended',
					...(event.spent === undefined ? {} : { spent: event.spent })
				});
				break;
			case 'over': {
				const said = event.said;
				whatHappened.put(
					said === undefined ? 'turn' : 'trouble',
					said === undefined ? 'a build session is over' : 'a build session could not go on'
				);
				void this.#keepFor(live, { turns: [...live.turns] });
				this.#letSessionGoIn(live, session);
				session.heard({ heard: 'over', ...(said === undefined ? {} : { said }) });
				break;
			}
		}
	}

	/** One act of a build's session, done and answered to the agent. */
	async #serveIn(live: Live, session: Session, call: SloppyToolCall): Promise<ChatToolAnswer> {
		const done = await this.#actIn(session, call);
		live.done.set(call.call, done);
		return { said: done.said, ...(done.trouble === undefined ? {} : { trouble: done.trouble }) };
	}

	async #actIn(session: Session, call: SloppyToolCall): Promise<ChatActDone> {
		if (!toolsForRole(session.role).includes(call.act))
			return { said: NOT_THIS_SESSION, trouble: true };
		whatHappened.put('act', `${doingIn(call.act)} began`, call.call);
		try {
			const done = isChatToolCall(call)
				? await serveChatCall(this.#buildFiles(session), call)
				: await session.serve(call);
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

	/** Where a build session's acts land: the copy of the project it works in,
	 *  and never the folder in front of the person. */
	#buildFiles(session: Session): Files {
		const files = seam().chat()?.builds?.files(session.cwd);
		if (!files) throw new PlaceRefused(NO_BUILD_WORK);
		return files;
	}

	/** The record of the thread in front of somebody. */
	get #reading(): Live | undefined {
		const id = this.#current?.id;
		return id === undefined ? undefined : chatEngine.live(id);
	}

	#liveFor(thread: ChatThread): Live {
		return chatEngine.liveFor(thread);
	}

	/** What went wrong, in words meant for the person: on the thread in front of
	 *  them, or on the chat itself where there is no thread yet. */
	#tell(words: string | null): void {
		const live = this.#reading;
		if (live) live.trouble = words;
		else this.#trouble = words;
	}

	/**
	 * The thread being left behind. **The one rule**: its conversation waits for
	 * the person who left it — ended here, and picked up again by the next thing
	 * they say — unless they asked for chats to go on answering wherever they
	 * are. What was said is kept on the thread either way.
	 *
	 * Its record is kept only while something is still coming, so a thread read
	 * and left behind holds nothing of this run.
	 */
	#leave(live: Live): void {
		const listened = chatEngine.listened(live.thread.id);
		if (!prefs.current.chatInBackground && !listened) {
			this.#letSessionGo(live);
			this.#letBuildGo(live);
		}
		if (!live.standing && live.sessions.size === 0 && !listened) chatEngine.forget(live.thread.id);
	}

	#letGoOutOfSight(live: Live): void {
		chatEngine.letGoOutOfSight(live);
	}

	#letSessionGo(live: Live): void {
		chatEngine.letSessionGo(live);
	}

	/** Whether the thread in front of somebody holds them there: it is being
	 *  answered and leaving it would end that, throwing away the answer being
	 *  written. Where chats go on answering, nothing holds anybody. */
	get #held(): boolean {
		return this.running && !prefs.current.chatInBackground;
	}

	/** The chats about this project, and the one most recently written to
	 *  picked up where there is nothing already being read. */
	async #readThreads(): Promise<void> {
		const threads = runtime.threads();
		const graph = this.#of;
		if (!threads || graph === null) return;
		this.#project = (await runtime.project().catch(() => undefined))?.root ?? null;
		const project = this.#project;
		if (project === null) return;
		try {
			const held = await threads.list();
			this.#threads = held.filter((one) => one.graph === graph && one.project === project);
		} catch (error) {
			whatHappened.put('trouble', `the chats were not looked up: ${troubleIn(error)}`);
			return;
		}
		if (this.#current === null) await this.#readNext();
	}

	/** The chat most recently written to, or none where this project has none
	 *  left — what somebody is reading once the one they were is gone. */
	async #readNext(): Promise<void> {
		void this.#unwrittenGoes(this.#letThreadGo());
		const [newest] = this.threads;
		if (newest) await this.#pickUp(newest);
		else await chatDraft.standingFor();
	}

	async #pickUp(thread: ChatThread): Promise<void> {
		const live = this.#liveFor(thread);
		this.#current = live.thread;
		this.#places = live.thread.places;
		await chatDraft.standingFor(live.thread.id);
	}

	/** The thread these words belong to: the one being read, one minted where
	 *  none is, and written down here where this device holds no record of it
	 *  yet. **Only a thread not yet written down is named from what was said**;
	 *  one this device already holds keeps the name it carries, which is its
	 *  person's. */
	async #threadSaying(said: string): Promise<ChatThread> {
		const held = this.#current ?? (await this.#mint(threadNameFrom(said)));
		if (this.#unwritten === held.id) await this.#keepCurrent({ name: threadNameFrom(said) });
		return this.#current ?? held;
	}

	/** The thread anything written here belongs to, which is one by the time
	 *  anything is. REJECTS in words the agent reads. */
	async #threadNow(): Promise<ChatThread> {
		return this.#current ?? (await this.#mint(threadNameFrom('')));
	}

	async #mint(name: string): Promise<ChatThread> {
		const graph = this.#of;
		if (graph === null) throw new Error(NO_GRAPH);
		const project = this.#project ?? (await runtime.project())?.root;
		if (project === undefined || project === '') throw new Error(NO_PROJECT);
		this.#project = project;
		const at = new Date().toISOString();
		const thread: ChatThread = {
			id: ulid(),
			name,
			graph,
			project,
			created_at: at,
			updated_at: at,
			places: [...this.#places],
			turns: []
		};
		chatEngine.liveFor(thread);
		this.#current = thread;
		this.#unwritten = thread.id;
		return thread;
	}

	/** The chat being read, changed and kept. */
	async #keepCurrent(changed: Partial<ChatThread>): Promise<void> {
		const live = this.#reading;
		if (live === undefined) return;
		await this.#keepFor(live, changed);
	}

	/** One thread's own record, changed and kept. */
	async #keepFor(live: Live, changed: Partial<ChatThread>): Promise<void> {
		await chatEngine.keepFor(live, changed);
	}

	async #keep(thread: ChatThread): Promise<void> {
		await chatEngine.keep(thread);
	}

	/** A thread as it is kept: listed where it is about the folder in front of
	 *  somebody, wherever it was said into. */
	#listed(thread: ChatThread): void {
		// A thread answering about another folder is kept all the same; what is
		// LISTED is the folder in front of somebody.
		if (thread.graph === this.#of && thread.project === this.#project)
			this.#threads = [thread, ...this.#threads.filter((one) => one.id !== thread.id)];
		if (this.#current?.id === thread.id) this.#current = thread;
		if (this.#unwritten === thread.id) this.#unwritten = null;
	}

	async #placesNow(places: readonly ChatPlace[]): Promise<void> {
		this.#places = places;
		await this.#keepCurrent({ places: [...places] });
		const live = this.#reading;
		if (live?.standing === true) {
			this.#letSessionGo(live);
			live.says = PLACES_MOVED;
		}
	}

	/** The thread's own record gone. False is one still there, with
	 *  {@link trouble} saying so. */
	async #threadGoes(id: Ulid): Promise<boolean> {
		try {
			await runtime.threads()?.remove(id);
			return true;
		} catch (error) {
			whatHappened.put('trouble', `the chat was not deleted: ${troubleIn(error)}`);
			this.#tell(wordsFor(error) ?? UNDELETED);
			return false;
		}
	}

	/** What becomes of a thread's draft as the thread goes. False is a draft
	 *  that could not be settled, with {@link trouble} saying what to do. */
	async #draftGoes(id: Ulid, draft: DraftOnDelete): Promise<boolean> {
		if (!chatDraft.keeps) return true;
		if ((await chatDraft.standingFor(id)) === null) return true;
		if (draft === 'discard') {
			if (await chatDraft.discard()) return true;
			this.#tell(chatDraft.says ?? UNDELETED);
			return false;
		}
		await chatDraft.review();
		if ((chatDraft.read?.conflicts.length ?? 0) > 0) {
			this.#tell(SETTLE_FIRST);
			return false;
		}
		if (await chatDraft.merge()) return true;
		this.#tell(chatDraft.says ?? UNDELETED);
		return false;
	}

	/** A chat this device holds no record of goes when it stops being the one
	 *  in front of somebody: nothing reaches it again, so the draft it was
	 *  given somewhere to write would be a copy nobody could read or throw
	 *  away. */
	async #unwrittenGoes(id: Ulid | null): Promise<void> {
		if (id === null) return;
		if ((await chatDraft.standingFor(id)) !== null) await chatDraft.discard();
	}

	/** Nothing in front of somebody, with the thread that was left to `#leave`.
	 *  Answers the chat this device holds no record of where that is the one let
	 *  go of. */
	#letThreadGo(): Ulid | null {
		const unwritten = this.#unwritten;
		const live = this.#reading;
		if (live) this.#leave(live);
		this.#current = null;
		this.#unwritten = null;
		this.#places = [];
		this.#trouble = null;
		return unwritten;
	}
}

export const chat = new ChatStore();
