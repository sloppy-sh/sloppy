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
 * draft, so nothing of it lands in the thread somebody is reading.
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
	CHAT_ASKED_MAX,
	CHAT_ATTACHED_NAME_MAX,
	CHAT_ATTACHMENT_MAX,
	type ChatActDone,
	type ChatAgent,
	chatAgentName,
	type ChatAttachment,
	type ChatBlock,
	type ChatCallId,
	type ChatEvent,
	type ChatModel,
	chatModels,
	type ChatPlace,
	type ChatSessionId,
	type ChatSpend,
	type ChatThread,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatToolName,
	chatToolWrites,
	type ChatTurn,
	type ContextUsage,
	contextTogether,
	MAX_TURNS_PER_SESSION,
	MOST_ATTACHED_PER_TURN,
	MOST_PLACES,
	type OwnedRef,
	placeNamed,
	spentTogether,
	type StandingDraft,
	threadNameFrom,
	ulid,
	type Ulid,
	type WriteNoteArguments
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { serveChatCall } from '../chat-acts.js';
import { carriedOver, placesKey, threadAsMarkdown, withCarried, withPlaces } from '../chat-said.js';
import { runtime, type ChatLive } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { chatDraft } from './chat-draft.svelte.js';
import { wordsFor } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { doingIn, troubleIn, whatHappened } from './what-happened.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNSAID = 'Sloppy could not send that just now. Try again.';
const MODEL_UNKNOWN = "That model isn't one this assistant knows. Pick another.";
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

/** Said once, quietly, where a conversation goes on without what came before
 *  it: the agent's own session was not there to pick up. */
const PICKED_UP = 'The assistant is going on from a summary of this thread.';

/** And where the places changed under a conversation that is standing. */
const PLACES_MOVED =
	'The next thing you say starts the assistant again, so it can read what you changed.';

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';
const NO_GRAPH = 'There are no notes open here to work on.';
const NO_PLACE =
	'There is no place here by that name. Name one you were given, or leave it out to read this project.';
const PLACE_UNREAD = 'That place cannot be read from here.';
const NO_NOTES_THERE = 'There are no notes in that place. Read its files with your own tools.';

/** A reading act asked for a place it cannot have. The agent reads these
 *  words and acts on them, so one is answered rather than thrown past the
 *  shell, which has no words of its own for what went wrong. */
class PlaceRefused extends Error {}

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

/**
 * An answer somebody asked to keep as a note, waiting on their say-so. It is
 * the person's own act, so nothing the agent's turn does answers it.
 *
 * `arguments` is carried untouched; a surface parses it against the act's own
 * schema before drawing any of it.
 */
export interface ChatKeeping {
	call: ChatCallId;
	act: ChatToolName;
	arguments: unknown;
	/** Where the turn whose answer it would keep stands. */
	at: number;
}

/** The words of a person's turn, without what was attached. */
function saidOf(turn: ChatTurn): string {
	return turn.blocks.flatMap((block) => (block.kind === 'said' ? [block.said] : [])).join('\n');
}

function agentTurn(): ChatTurn {
	return { from: 'agent', blocks: [], at: new Date().toISOString() };
}

/** What the agent is told about what was put in front of it, which is where to
 *  read it. */
function withAttached(said: string, attached: readonly ChatAttachment[]): string {
	if (attached.length === 0) return said;
	const lines = attached.map((one) => `- ${one.name} — ${one.path}`).join('\n');
	const says = `Attached, in this project:\n${lines}`;
	return said === '' ? says : `${said}\n\n${says}`;
}

/** What the attachment lines take of what one turn carries, so the composer
 *  can only be typed as far as the rest of it. */
function roomTaken(attached: readonly ChatAttachment[]): number {
	return withAttached('', attached).length;
}

/** What an act came to, for the record: whether it worked and how much it left
 *  different — never what it read, wrote or answered with. */
function cameTo(done: ChatActDone): string {
	if (done.trouble === true)
		return `did not work${done.told === undefined ? '' : `: ${done.told}`}`;
	const left = done.touched?.length ?? 0;
	return left === 0 ? 'is done' : `is done, leaving ${left} note${left === 1 ? '' : 's'} different`;
}

/** The same thread, out of the archive. */
function liveAgain(thread: ChatThread): ChatThread {
	const held = { ...thread };
	delete held.archived_at;
	return held;
}

/**
 * One thread's conversation and everything arriving in it. A thread read again
 * is read off its own record, so a thread answering while somebody is
 * elsewhere goes on filling its own.
 */
class Live {
	/** The thread as it was last kept, which every write to it is made from. */
	thread: ChatThread;
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
	/** Whether the turn at the end is the agent's and still being written into. */
	writing = false;
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
	readonly #live = new SvelteMap<Ulid, Live>();
	/** What went wrong where there is no thread to say it about. */
	#trouble = $state.raw<string | null>(null);
	/** The writes to the chats this device holds, in the order they were asked
	 *  for. */
	#writes: Promise<void> = Promise.resolve();

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
		return id !== this.#current?.id && this.#live.get(id)?.running === true;
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
		const live = this.#live.get(id);
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
			this.#live.delete(id);
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
		const epoch = live.epoch;
		live.trouble = null;
		live.says = null;
		live.failed = null;
		live.running = true;
		live.writing = false;
		live.attached = [];
		const blocks: ChatBlock[] = [
			...(said === '' ? [] : [{ kind: 'said' as const, said }]),
			...(attached.length === 0 ? [] : [{ kind: 'attached' as const, attached: [...attached] }])
		];
		const before = live.turns;
		live.turns = [...live.turns, { from: 'person', blocks, at: new Date().toISOString() }];
		const opening = !live.standing;
		if (opening) {
			const agent = this.agent;
			const model = this.model;
			live.places = [...this.#places];
			try {
				// The agent runs where the draft is, so the copy exists before the
				// conversation that works in it.
				await this.#writesInto(live);
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
						...(carried === undefined ? {} : { carried })
					},
					(event) => this.#heard(live, epoch, event),
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
			await this.#keepFor(live, {
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
			project = await this.#writesInto(live);
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
		const project = await this.#written(live);
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
			const done = await this.#act(live, {
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
		if (!live?.handle || live.stopping) return;
		whatHappened.put('turn', 'an end to the turn was asked for');
		live.stopping = true;
		try {
			await live.handle.stop();
		} finally {
			live.stopping = false;
		}
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
	 *  still answering finishes first and is let go of as its turn ends. */
	leaveTheOthers(): void {
		const reading = this.#current?.id;
		for (const live of [...this.#live.values()]) {
			if (live.thread.id === reading || live.running) continue;
			this.#letGoOutOfSight(live);
		}
	}

	/** Another graph has not had this one's conversations. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		void this.#unwrittenGoes(this.#letThreadGo());
		for (const live of [...this.#live.values()]) this.#leave(live);
		this.#threads = [];
		chatDraft.clear();
		this.#of = null;
		this.#project = null;
		this.#agents = null;
		this.#trouble = null;
	}

	/** The record of the thread in front of somebody. */
	get #reading(): Live | undefined {
		const id = this.#current?.id;
		return id === undefined ? undefined : this.#live.get(id);
	}

	/** The thread's own record, made where it has none. */
	#liveFor(thread: ChatThread): Live {
		const held = this.#live.get(thread.id);
		if (held) return held;
		const live = new Live(thread);
		this.#live.set(thread.id, live);
		return live;
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
		if (!prefs.current.chatInBackground) this.#letSessionGo(live);
		if (!live.standing) this.#live.delete(live.thread.id);
	}

	/** A thread nobody is reading that has nothing left to answer: its
	 *  conversation let go of, and its record with it. */
	#letGoOutOfSight(live: Live): void {
		this.#letSessionGo(live);
		this.#live.delete(live.thread.id);
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
		this.#live.set(thread.id, new Live(thread));
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

	/** One thread's own record, changed and kept — which is what an event
	 *  arriving in a thread nobody is reading writes through. */
	async #keepFor(live: Live, changed: Partial<ChatThread>): Promise<void> {
		await this.#keep({ ...live.thread, ...changed, updated_at: new Date().toISOString() });
	}

	/** One at a time, in the order they were asked for: two of them are a turn
	 *  ending and a session saying what it is, and the later write carries what
	 *  the earlier one did. */
	async #keep(thread: ChatThread): Promise<void> {
		const live = this.#live.get(thread.id);
		if (live) live.thread = thread;
		// A thread answering about another folder is kept all the same; what is
		// LISTED is the folder in front of somebody.
		if (thread.graph === this.#of && thread.project === this.#project)
			this.#threads = [thread, ...this.#threads.filter((one) => one.id !== thread.id)];
		if (this.#current?.id === thread.id) this.#current = thread;
		if (this.#unwritten === thread.id) this.#unwritten = null;
		const threads = runtime.threads();
		if (!threads) return;
		this.#writes = this.#writes
			.then(() => threads.write(thread))
			.catch((error: unknown) => {
				whatHappened.put('trouble', `the chat was not kept: ${troubleIn(error)}`);
			});
		await this.#writes;
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

	#letSessionGo(live: Live): void {
		if (live.standing) {
			void live.handle?.close().catch(() => {});
			// A turn cut off part way through has what arrived so far on screen,
			// and the thread is where somebody finds it again.
			if (live.running) void this.#keepFor(live, { turns: [...live.turns] });
		}
		live.epoch += 1;
		live.handle = null;
		live.standing = false;
		live.running = false;
		live.writing = false;
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
		void this.#written(live)
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

	#heard(live: Live, epoch: number, event: ChatEvent): void {
		if (epoch !== live.epoch) return;
		switch (event.event) {
			case 'started': {
				live.standing = true;
				const named = this.models.find((one) => one.model === event.model)?.name;
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
				void this.#keepFor(live, { session: event.session });
				break;
			}
			case 'block':
				this.#block(live, event.at, event.block);
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
				live.writing = false;
				if (event.spent !== undefined) {
					live.spentTurn = event.spent;
					live.spentSession = spentTogether(live.spentSession, event.spent);
				}
				live.turns = live.turns.slice(-MAX_TURNS_PER_SESSION);
				void this.#keepFor(live, {
					turns: [...live.turns],
					...(live.spentSession === undefined ? {} : { spent: live.spentSession })
				});
				void chatDraft.keepWhatTheTurnWrote(live.draft ?? undefined);
				// A thread answering out of sight was left to finish, and it has:
				// what it said is on the thread, and the next thing said there
				// picks the conversation up by its session.
				if (live.thread.id !== this.#current?.id) this.#letGoOutOfSight(live);
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
				if (live.running) void this.#keepFor(live, { turns: [...live.turns] });
				live.handle = null;
				live.standing = false;
				live.running = false;
				live.writing = false;
				live.openedWith = undefined;
				live.openedAs = undefined;
				live.answered = false;
				live.asked = undefined;
				live.introduced = false;
				live.trouble = refusedModel ? MODEL_UNKNOWN : (event.said ?? null);
				break;
			}
		}
	}

	/** A block already at this place in the turn underway is that block grown. */
	#block(live: Live, at: number, block: ChatBlock): void {
		live.answered = true;
		const turns = live.writing ? [...live.turns] : [...live.turns, agentTurn()];
		live.writing = true;
		const turn = turns[turns.length - 1];
		const blocks = [...turn.blocks];
		if (at < blocks.length) blocks[at] = block;
		else blocks.push(block);
		turns[turns.length - 1] = { ...turn, blocks };
		live.turns = turns;
	}

	/**
	 * Where this thread's acts and the files put in front of it are written: the
	 * draft it keeps one in, and the project itself where this device keeps
	 * none. A turn beginning is what starts a draft, so this starts one where
	 * the thread has none. REJECTS in words the agent reads.
	 */
	async #writesInto(live: Live): Promise<Files> {
		const drafts = seam().chat()?.drafts;
		if (!drafts) {
			const project = await runtime.project();
			if (!project) throw new Error(NO_PROJECT);
			return project;
		}
		// The draft somebody is looking at is the thread in front of them; a
		// thread answering out of their sight writes into its own and moves
		// nothing of theirs.
		const reading = live.thread.id === this.#current?.id;
		const draft =
			live.draft ??
			(await (reading ? chatDraft.start(live.thread.id) : chatDraft.started(live.thread.id)));
		live.draft = draft;
		return drafts.files(draft);
	}

	/** The same folder, for taking something back off it: a draft that is not
	 *  standing holds nothing to take off, so this starts none. */
	async #written(live: Live): Promise<Files | undefined> {
		const drafts = seam().chat()?.drafts;
		if (!drafts) return await runtime.project();
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
		if (!place) return { files: await this.#writesInto(live), reading: false };
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
	async #serve(live: Live, call: ChatToolCall): Promise<ChatToolAnswer> {
		const done = await this.#act(live, call);
		live.done.set(call.call, done);
		return { said: done.said, ...(done.trouble === undefined ? {} : { trouble: done.trouble }) };
	}

	async #act(live: Live, call: ChatToolCall): Promise<ChatActDone> {
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

export const chat = new ChatStore();
