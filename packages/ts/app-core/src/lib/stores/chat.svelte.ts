/**
 * The chats with an agent about the project in front of somebody: the threads
 * this device holds, the one being read, and what is arriving in it now.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * Every act LANDS: a thread works in a draft of the notes that is its own, so
 * nothing here waits on the person and nothing of theirs changes while it
 * runs. `stores/chat-draft.svelte.ts` is the draft, and what a person does
 * with one.
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
	threadNameFrom,
	ulid,
	type Ulid,
	type WriteNoteArguments
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { serveChatCall } from '../chat-acts.js';
import { carriedOver, placesKey, threadAsMarkdown, withCarried, withPlaces } from '../chat-said.js';
import { runtime } from '../runtime.js';
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
const UNREACHED_PLACE = 'Sloppy cannot read that folder from here. Open it and try again.';
const SETTLE_FIRST =
	'Some of what that thread wrote has to be settled against your own notes first. Read the draft.';

/** Said once, quietly, where a conversation goes on without what came before
 *  it: the agent's own session was not there to pick up. */
const PICKED_UP = 'The assistant is going on from a summary of this thread.';

/** And where the places changed under a conversation that is standing. */
const PLACES_MOVED =
	'The next thing you say starts the assistant again, so it can read what you changed.';

/** How long a session has to say which conversation answered before the words
 *  that opened it go out anyway. A program that has started and not introduced
 *  itself is not one to hold somebody's turn behind. */
const INTRODUCES_WITHIN = 10_000;

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';
const NO_DRAFT = 'There is no draft of the notes to write into.';
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
	#turns = $state.raw<readonly ChatTurn[]>([]);
	#places = $state.raw<readonly ChatPlace[]>([]);
	#context = $state.raw<ContextUsage | null>(null);
	#standing = $state(false);
	#running = $state(false);
	#keeping = $state.raw<ChatKeeping | null>(null);
	#keepSettling = $state(false);
	#stopping = $state(false);
	/** What each of Sloppy's own acts came to, for the person — the agent read
	 *  its own half and this is the rest of it. */
	readonly #done = new SvelteMap<ChatCallId, ChatActDone>();
	/** What came of keeping a turn's answer, by where that turn stands. */
	readonly #kept = new SvelteMap<number, ChatActDone>();
	#attached = $state.raw<readonly ChatAttachment[]>([]);
	#trouble = $state.raw<string | null>(null);
	#says = $state.raw<string | null>(null);
	/** Which model the standing session was opened with, so a person who picks
	 *  another is told the one in front of them still answers. */
	#openedWith = $state.raw<string | undefined>(undefined);
	/** Which agent the standing session was opened with. */
	#openedAs: ChatAgent | undefined = undefined;
	/** Whether the agent has written anything in the standing session, which
	 *  is what tells a model it refused from any other way a session dies. */
	#answered = false;
	/** An earlier conversation to carry into the next session, where the
	 *  person moved it to another agent. */
	#carrying: string | null = null;
	/** The places the standing session has been told it may read, as
	 *  {@link placesKey}; `null` is a session that has not been told. */
	#placesTold: string | null = null;
	/** The writes to the chats this device holds, in the order they were asked
	 *  for. */
	#writes: Promise<void> = Promise.resolve();
	/** The session this thread asked to be picked up, and the conversation to
	 *  hand over where it was not — `started` is what says which happened. The
	 *  words that OPENED the session wait on that, because a conversation that
	 *  was not picked up goes over with them rather than after them. */
	#asked: ChatSessionId | undefined = undefined;
	#carryIfUnpicked: string | null = null;
	#introduced: (() => void) | null = null;
	/** The agent and model the last session died under, for the person to be
	 *  offered another. */
	#failed = $state.raw<{ agent: ChatAgent; model?: string } | null>(null);
	#spentTurn = $state.raw<ChatSpend | undefined>(undefined);
	#spentSession = $state.raw<ChatSpend | undefined>(undefined);
	/** An event that lands after this chat was let go of, or after another
	 *  graph's was opened, is not an event about what is on screen. */
	#epoch = 0;
	/** Whether the turn at the end is the agent's and still being written into. */
	#writing = false;

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

	/** What the chat has spent, where the agent says: the last turn, and the
	 *  conversation with this agent so far. */
	get spent(): { turn?: ChatSpend; session?: ChatSpend } {
		return {
			...(this.#spentTurn === undefined ? {} : { turn: this.#spentTurn }),
			...(this.#spentSession === undefined ? {} : { session: this.#spentSession })
		};
	}

	/** How full the agent's window is, as the agent last said. `null` is a
	 *  conversation nothing has been said about yet. */
	get context(): ContextUsage | null {
		return this.#context;
	}

	/** Whether this device can ask the agent how full its window is at all. */
	get asksContext(): boolean {
		return seam().chat()?.context !== undefined;
	}

	/** Whether this device can read a place beside the project at all. */
	get readsPlaces(): boolean {
		return seam().placeFiles() !== undefined;
	}

	/** The places this chat may read besides its own project. */
	get places(): readonly ChatPlace[] {
		return this.#places;
	}

	/** Where the last session died: which agent and model, for the person to
	 *  be offered another route. */
	get failedRoute(): { agent: ChatAgent; model?: string } | null {
		return this.#failed;
	}

	/**
	 * Answer with this agent and model from here on. Another agent takes the
	 * conversation so far with it: the session standing is let go of, and what
	 * was said is carried into the next one as the earlier conversation.
	 */
	pick(agent: ChatAgent, model: string | undefined): void {
		const held = { ...prefs.current.chatModel };
		if (model === undefined) delete held[agent];
		else held[agent] = model;
		prefs.set('chatModel', held);
		prefs.set('chatAgent', agent);
		if (this.#standing && this.#openedAs !== undefined && this.#openedAs !== agent) {
			whatHappened.put('turn', `the conversation moved to ${chatAgentName(agent)}`);
			this.#carrying = carriedOver(this.#turns);
			this.#letSessionGo();
		}
	}

	/** Say the last thing again, to another agent, with the conversation before
	 *  it carried over. */
	async retryWith(agent: ChatAgent): Promise<void> {
		const last = [...this.#turns].reverse().find((turn) => turn.from === 'person');
		const words = last ? saidOf(last) : '';
		const before = last ? this.#turns.slice(0, this.#turns.lastIndexOf(last)) : this.#turns;
		this.#carrying = carriedOver(before);
		this.#failed = null;
		if (this.#standing) this.#letSessionGo();
		this.pick(agent, prefs.current.chatModel[agent]);
		this.#turns = before;
		await this.say(words);
	}

	get turns(): readonly ChatTurn[] {
		return this.#turns;
	}

	/** Whether the agent is answering the last thing it was told. */
	get running(): boolean {
		return this.#running;
	}

	/** The answer somebody asked to keep, waiting on their say-so. */
	get keeping(): ChatKeeping | null {
		return this.#keeping;
	}

	/** Whether the note they asked to keep is being written and has not landed
	 *  yet. */
	get keepSettling(): boolean {
		return this.#keepSettling;
	}

	/** Whether an end has been asked for and has not landed yet. */
	get stopping(): boolean {
		return this.#stopping;
	}

	/** What went wrong, in words meant for the person. */
	get trouble(): string | null {
		return this.#trouble;
	}

	/** One quiet line about the conversation itself, which is not trouble. */
	get says(): string | null {
		return this.#says;
	}

	/** What one of Sloppy's own acts came to, for the person. */
	done(call: ChatCallId): ChatActDone | undefined {
		return this.#done.get(call);
	}

	/** What came of keeping the answer in the turn at `at`. */
	kept(at: number): ChatActDone | undefined {
		return this.#kept.get(at);
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
		const opened = this.#openedWith;
		if (!this.#standing || opened === this.model) return undefined;
		if (opened === undefined) return 'its own';
		return this.models.find((one) => one.model === opened);
	}

	/** What somebody has put in front of the agent alongside what they are
	 *  saying. */
	get attached(): readonly ChatAttachment[] {
		return this.#attached;
	}

	/** How much of a turn is left to type, once what is attached has its say. */
	get roomToSay(): number {
		return CHAT_ASKED_MAX - roomTaken(this.#attached);
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

	/** Read one of the chats about this project, letting the session standing
	 *  go. Switching while the agent is answering is refused. */
	async openThread(id: Ulid): Promise<void> {
		if (this.#current?.id === id) return;
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return;
		}
		const thread = this.#threads.find((one) => one.id === id);
		if (!thread) {
			this.#trouble = NO_SUCH_THREAD;
			return;
		}
		this.#letSessionGo();
		await this.#unwrittenGoes(this.#letThreadGo());
		await this.#pickUp(thread);
	}

	/** Begin another chat about this project. It takes an id and a name the
	 *  first time anything is said into it, and whatever is standing is let go
	 *  of — which is the way out of a conversation that is going nowhere. */
	async startThread(): Promise<void> {
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return;
		}
		this.#letSessionGo();
		await this.#unwrittenGoes(this.#letThreadGo());
		await chatDraft.standingFor();
	}

	// TODO(chat panel): the header's "Start again", which the three-dots menu
	// replaces. Delete with that button.
	startAgain(): void {
		void this.startThread();
	}

	/** Call the chat being read something else. Nothing is what
	 *  {@link threadNameFrom} makes of nothing. */
	async rename(name: string): Promise<void> {
		await this.#keepCurrent({ name: threadNameFrom(name) });
	}

	/** Put the chat being read aside. Its draft stands untouched, and the chat
	 *  most recently written to takes its place. */
	async archive(): Promise<void> {
		if (this.#current === null) return;
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return;
		}
		this.#letSessionGo();
		await this.#keepCurrent({ archived_at: new Date().toISOString() });
		await this.#readNext();
	}

	/** Take one back out of the archive. */
	async putBack(id: Ulid): Promise<void> {
		const thread = this.#threads.find((one) => one.id === id);
		if (!thread) {
			this.#trouble = NO_SUCH_THREAD;
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
			this.#trouble = NO_SUCH_THREAD;
			return false;
		}
		const reading = this.#current?.id === id;
		// One draft is read and settled at a time, so settling one while a turn
		// writes into another would settle whichever of the two is in hand.
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return false;
		}
		if (reading) this.#letSessionGo();
		// The draft goes first: a thread deleted with its draft still standing
		// leaves writing nothing can reach.
		const gone = (await this.#draftGoes(id, draft)) && (await this.#threadGoes(id));
		if (gone) this.#threads = this.#threads.filter((one) => one.id !== id);
		if (gone && reading) await this.#readNext();
		else await chatDraft.standingFor(this.#current?.id);
		return gone;
	}

	/** Add a place this thread may read besides its own project. A folder
	 *  already there is no second place, and a name already taken is held apart
	 *  from the place that has it — {@link placeNamed}. */
	async addPlace(place: ChatPlace): Promise<void> {
		if (this.#places.some((one) => one.root === place.root)) return;
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return;
		}
		if (this.#places.length >= MOST_PLACES) {
			this.#trouble = TOO_MANY_PLACES;
			return;
		}
		if (seam().placeFiles()?.(place.root) === undefined) {
			this.#trouble = UNREACHED_PLACE;
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
		if (this.#running) {
			this.#trouble = STILL_ANSWERING;
			return;
		}
		await this.#placesNow(this.#places.filter((one) => one.root !== root));
	}

	/** Ask the agent how full its window is; the answer arrives as an event.
	 *  Nothing standing has nothing to ask. */
	async askContext(detail: 'summary' | 'full' = 'summary'): Promise<void> {
		const access = seam().chat();
		if (!access?.context || !this.#standing) return;
		try {
			await access.context(detail);
		} catch (error) {
			whatHappened.put('trouble', `how full the window is was not said: ${troubleIn(error)}`);
		}
	}

	/** The whole chat being read, as markdown somebody can keep. Empty where
	 *  nothing has been said. */
	copyAsMarkdown(): string {
		const thread = this.#current;
		if (thread === null) return '';
		return threadAsMarkdown({ ...thread, turns: [...this.#turns] });
	}

	/**
	 * Say something, which begins a turn — starting the session where none
	 * stands, and the draft it works in where none stands either. Nothing is
	 * said while the agent is still answering the last turn, nor is the empty
	 * string with nothing attached.
	 */
	async say(words: string): Promise<void> {
		const access = seam().chat();
		const said = words.trim();
		const attached = this.#attached;
		if (!access || (said === '' && attached.length === 0) || this.#running) return;
		const epoch = this.#epoch;
		whatHappened.put(
			'turn',
			attached.length === 0
				? 'a turn began'
				: `a turn began, with ${attached.length} file${attached.length === 1 ? '' : 's'} in front of it`
		);
		this.#trouble = null;
		this.#says = null;
		this.#failed = null;
		this.#running = true;
		this.#writing = false;
		this.#attached = [];
		const first = this.#turns.length === 0;
		const blocks: ChatBlock[] = [
			...(said === '' ? [] : [{ kind: 'said' as const, said }]),
			...(attached.length === 0 ? [] : [{ kind: 'attached' as const, attached: [...attached] }])
		];
		const before = this.#turns;
		this.#turns = [...this.#turns, { from: 'person', blocks, at: new Date().toISOString() }];
		const opening = !this.#standing;
		if (opening) {
			const agent = this.agent;
			const model = this.model;
			let thread: ChatThread;
			try {
				thread = await this.#threadSaying(said, first);
				// The agent runs where the draft is, so the copy exists before the
				// session that works in it.
				await this.#writesInto();
			} catch (error) {
				whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
				if (epoch !== this.#epoch) return;
				this.#trouble = wordsFor(error) ?? UNSTARTED;
				this.#running = false;
				return;
			}
			const session =
				thread.session !== undefined && thread.agent === agent ? thread.session : undefined;
			this.#asked = session;
			this.#placesTold = this.#placesOpenedWith(session);
			this.#carryIfUnpicked = session === undefined ? null : carriedOver(before);
			if (session === undefined && before.length > 0) this.#carrying ??= carriedOver(before);
			const introduced = session === undefined ? null : this.#introduces();
			try {
				await access.open(
					{
						...(agent === undefined ? {} : { agent }),
						...(model === undefined ? {} : { model }),
						thread: {
							id: thread.id,
							...(session === undefined ? {} : { session }),
							places: [...this.#places]
						}
					},
					(event) => this.#heard(epoch, event),
					(call) => this.#serve(call)
				);
			} catch (error) {
				whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
				this.#introduced?.();
				if (epoch !== this.#epoch) return;
				this.#trouble = wordsFor(error) ?? UNSTARTED;
				this.#running = false;
				return;
			}
			if (epoch !== this.#epoch) return;
			this.#standing = true;
			this.#openedWith = model;
			this.#openedAs = agent;
			await this.#keepCurrent({
				...(agent === undefined ? {} : { agent }),
				...(model === undefined ? {} : { model })
			});
			if (introduced !== null) {
				await introduced;
				if (epoch !== this.#epoch) return;
			}
		}
		const carried = this.#carrying ?? '';
		this.#carrying = null;
		try {
			await access.say(withCarried(carried, this.#namingPlaces(withAttached(said, attached))));
		} catch (error) {
			whatHappened.put('trouble', `the agent was not told: ${troubleIn(error)}`);
			if (epoch !== this.#epoch) return;
			this.#trouble = wordsFor(error) ?? UNSAID;
			this.#running = false;
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
		let project: Files;
		try {
			project = await this.#writesInto();
		} catch (error) {
			return wordsFor(error) ?? UNATTACHED;
		}
		let trouble: string | null = null;
		const held = [...this.#attached];
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
		this.#attached = held;
		return trouble;
	}

	/** Take one of them back off what is about to be said. */
	async takeOff(path: string): Promise<void> {
		this.#attached = this.#attached.filter((one) => one.path !== path);
		const project = await this.#written();
		await project?.remove(path).catch(() => {});
	}

	/**
	 * Keep the answer in the turn at `at` as a note. It goes through the act the
	 * agent's writes go through, so it lands in the same draft and is read again
	 * in the same review; the card in front of it is where they read what it
	 * would be called before saying so.
	 */
	keep(at: number, asked: WriteNoteArguments): void {
		if (this.#keeping !== null || this.#keepSettling) return;
		this.#kept.delete(at);
		this.#keeping = { call: ulid(), act: 'write_note', arguments: asked, at };
	}

	/** Their answer to keeping it. */
	async keepIt(allowed: boolean): Promise<void> {
		const keeping = this.#keeping;
		if (keeping === null || this.#keepSettling) return;
		this.#keeping = null;
		if (!allowed) return;
		this.#keepSettling = true;
		try {
			const done = await this.#act({
				call: keeping.call,
				act: 'write_note',
				arguments: keeping.arguments as WriteNoteArguments
			});
			this.#kept.set(keeping.at, done);
		} catch (error) {
			this.#kept.set(keeping.at, { said: '', trouble: true, told: wordsFor(error) ?? UNKEPT });
		} finally {
			this.#keepSettling = false;
		}
	}

	/** End the turn underway. The conversation stands, and the next thing said
	 *  goes on with it. */
	async stop(): Promise<void> {
		const access = seam().chat();
		if (!access || this.#stopping) return;
		whatHappened.put('turn', 'an end to the turn was asked for');
		this.#stopping = true;
		try {
			await access.stop();
		} finally {
			this.#stopping = false;
		}
	}

	/**
	 * The draft is gone, taken in or thrown away. The session ran WHERE the
	 * draft was, so it is over with it; what was said stays on screen, and the
	 * next thing said opens another session in another draft.
	 */
	draftGone(): void {
		if (this.#standing) this.#letSessionGo();
	}

	/** Another graph has not had this one's conversations. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		this.#letSessionGo();
		void this.#unwrittenGoes(this.#letThreadGo());
		this.#threads = [];
		chatDraft.clear();
		this.#of = null;
		this.#project = null;
		this.#agents = null;
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
		this.#current = thread;
		this.#turns = thread.turns;
		this.#places = thread.places;
		this.#spentSession = thread.spent;
		this.#done.clear();
		this.#kept.clear();
		await chatDraft.standingFor(thread.id);
	}

	/** The thread these words belong to: the one being read, one minted where
	 *  none is, and named from the first thing said in it — which is where a
	 *  chat is first written down. */
	async #threadSaying(said: string, first: boolean): Promise<ChatThread> {
		const name = threadNameFrom(said);
		const held = this.#current ?? (await this.#mint(name));
		if (first) await this.#keepCurrent({ name });
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
		this.#current = thread;
		this.#unwritten = thread.id;
		return thread;
	}

	/** The chat being read, changed and kept. */
	async #keepCurrent(changed: Partial<ChatThread>): Promise<void> {
		const thread = this.#current;
		if (thread === null) return;
		await this.#keep({ ...thread, ...changed, updated_at: new Date().toISOString() });
	}

	/** One at a time, in the order they were asked for: two of them are a turn
	 *  ending and a session saying what it is, and the later write carries what
	 *  the earlier one did. */
	async #keep(thread: ChatThread): Promise<void> {
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
		if (this.#standing) {
			this.#letSessionGo();
			this.#says = PLACES_MOVED;
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
			this.#trouble = wordsFor(error) ?? UNDELETED;
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
			this.#trouble = chatDraft.says ?? UNDELETED;
			return false;
		}
		await chatDraft.review();
		if ((chatDraft.read?.conflicts.length ?? 0) > 0) {
			this.#trouble = SETTLE_FIRST;
			return false;
		}
		if (await chatDraft.merge()) return true;
		this.#trouble = chatDraft.says ?? UNDELETED;
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

	/** Nothing in front of somebody, answering the chat this device holds no
	 *  record of where that is the one let go of. */
	#letThreadGo(): Ulid | null {
		const unwritten = this.#unwritten;
		this.#current = null;
		this.#unwritten = null;
		this.#turns = [];
		this.#places = [];
		this.#spentSession = undefined;
		this.#done.clear();
		this.#kept.clear();
		return unwritten;
	}

	/** Settled where the agent says which session answered, and where it says
	 *  nothing for {@link INTRODUCES_WITHIN}: nothing said is nothing known, so
	 *  the conversation is handed over rather than risked on a session that may
	 *  not have been picked up, and the person is told nothing either way. */
	#introduces(): Promise<void> {
		return new Promise((settle) => {
			const waited = setTimeout(() => {
				this.#introduced = null;
				const carry = this.#carryIfUnpicked;
				this.#carryIfUnpicked = null;
				if (carry !== null && carry !== '') this.#carrying = carry;
				settle();
			}, INTRODUCES_WITHIN);
			this.#introduced = () => {
				clearTimeout(waited);
				this.#introduced = null;
				settle();
			};
		});
	}

	#letSessionGo(): void {
		if (this.#standing) {
			void seam()
				.chat()
				?.close()
				.catch(() => {});
		}
		this.#epoch += 1;
		this.#standing = false;
		this.#running = false;
		this.#writing = false;
		this.#keeping = null;
		this.#keepSettling = false;
		this.#letAttachedGo();
		this.#openedWith = undefined;
		this.#openedAs = undefined;
		this.#answered = false;
		this.#asked = undefined;
		this.#carryIfUnpicked = null;
		this.#introduced?.();
		this.#spentTurn = undefined;
		this.#context = null;
		this.#placesTold = null;
		this.#trouble = null;
		this.#says = null;
	}

	/** What was put in front of a conversation that is being let go was never
	 *  said, so nothing reads it again and it comes off where it was put. */
	#letAttachedGo(): void {
		const held = this.#attached;
		this.#attached = [];
		if (held.length === 0) return;
		void this.#written()
			.then((project) => Promise.all(held.map((one) => project?.remove(one.path))))
			.catch(() => {});
	}

	/** What the conversation now standing has been told about its places: the
	 *  set the brief names for a session Sloppy OPENED, and nothing for one
	 *  picked up, which never reads that brief. */
	#placesOpenedWith(session: ChatSessionId | undefined): string | null {
		return session === undefined ? placesKey(this.#places) : null;
	}

	/** What is said, with the places this thread reads named to the agent where
	 *  what its conversation was told is not the set in front of the person. */
	#namingPlaces(said: string): string {
		const key = placesKey(this.#places);
		if (key === this.#placesTold) return said;
		this.#placesTold = key;
		return this.#places.length === 0 ? said : withPlaces(this.#places, said);
	}

	#heard(epoch: number, event: ChatEvent): void {
		if (epoch !== this.#epoch) return;
		switch (event.event) {
			case 'started': {
				this.#standing = true;
				const named = this.models.find((one) => one.model === event.model)?.name;
				whatHappened.put(
					'turn',
					`the chat opened with ${named ?? 'whatever the agent answers with'}, and the agent has ${event.tools.length} tools`
				);
				// A compaction arrives as another `started` for the same session,
				// so only the first of them decides whether it was picked up.
				const carry = this.#carryIfUnpicked;
				this.#carryIfUnpicked = null;
				if (carry !== null && this.#asked !== event.session) {
					whatHappened.put('turn', 'the conversation was not picked up where it was left');
					this.#says = PICKED_UP;
					if (carry !== '') this.#carrying = carry;
				}
				this.#introduced?.();
				this.#placesTold = this.#placesOpenedWith(this.#asked);
				void this.#keepCurrent({ session: event.session });
				break;
			}
			case 'block':
				this.#block(event.at, event.block);
				break;
			case 'context':
				this.#context = contextTogether(this.#context ?? undefined, event.usage);
				break;
			case 'ended':
				whatHappened.put(
					'turn',
					event.stopped === true ? 'the turn was stopped' : 'the turn ended'
				);
				this.#running = false;
				this.#writing = false;
				if (event.spent !== undefined) {
					this.#spentTurn = event.spent;
					this.#spentSession = spentTogether(this.#spentSession, event.spent);
				}
				this.#turns = this.#turns.slice(-MAX_TURNS_PER_SESSION);
				void this.#keepCurrent({
					turns: [...this.#turns],
					...(this.#spentSession === undefined ? {} : { spent: this.#spentSession })
				});
				void chatDraft.keepWhatTheTurnWrote();
				break;
			case 'over': {
				if (event.said === undefined) whatHappened.put('turn', 'the chat is over');
				else whatHappened.put('trouble', 'the chat could not go on');
				const refusedModel =
					event.said !== undefined && !this.#answered && this.#openedWith !== undefined;
				if (event.said !== undefined && this.#openedAs !== undefined) {
					this.#failed = {
						agent: this.#openedAs,
						...(this.#openedWith === undefined ? {} : { model: this.#openedWith })
					};
				}
				this.#standing = false;
				this.#running = false;
				this.#writing = false;
				this.#openedWith = undefined;
				this.#openedAs = undefined;
				this.#answered = false;
				this.#asked = undefined;
				this.#carryIfUnpicked = null;
				this.#introduced?.();
				this.#context = null;
				this.#trouble = refusedModel ? MODEL_UNKNOWN : (event.said ?? null);
				break;
			}
		}
	}

	/** A block already at this place in the turn underway is that block grown. */
	#block(at: number, block: ChatBlock): void {
		this.#answered = true;
		const turns = this.#writing ? [...this.#turns] : [...this.#turns, agentTurn()];
		this.#writing = true;
		const turn = turns[turns.length - 1];
		const blocks = [...turn.blocks];
		if (at < blocks.length) blocks[at] = block;
		else blocks.push(block);
		turns[turns.length - 1] = { ...turn, blocks };
		this.#turns = turns;
	}

	/**
	 * Where the chat's acts and the files put in front of it are written: the
	 * draft this thread keeps one in, and the project itself where this device
	 * keeps none. A turn beginning is what starts a draft, so this starts one
	 * where the thread has none. REJECTS in words the agent reads.
	 */
	async #writesInto(): Promise<Files> {
		if (!chatDraft.keeps) {
			const project = await runtime.project();
			if (!project) throw new Error(NO_PROJECT);
			return project;
		}
		const thread = await this.#threadNow();
		if (chatDraft.standing?.id !== thread.id) await chatDraft.start(thread.id);
		const files = chatDraft.files();
		if (!files) throw new Error(NO_DRAFT);
		return files;
	}

	/** The same folder, for taking something back off it: a draft that is not
	 *  standing holds nothing to take off, so this starts none. */
	async #written(): Promise<Files | undefined> {
		return chatDraft.keeps ? chatDraft.files() : await runtime.project();
	}

	/**
	 * Where one act reads or writes, and whether that folder is one this chat
	 * only reads. A writing act lands in this thread's own draft, whatever it
	 * says; a reading act answers for the place it names, and for this project
	 * where it names none. A place it cannot have is answered in words the
	 * agent reads.
	 */
	async #filesFor(call: ChatToolCall): Promise<{ files: Files; reading: boolean }> {
		const place = chatToolWrites(call.act) ? undefined : this.#placeNamed(call);
		if (!place) return { files: await this.#writesInto(), reading: false };
		if (place.graph === undefined) throw new PlaceRefused(NO_NOTES_THERE);
		const files = seam().placeFiles()?.(place.root);
		if (!files) throw new PlaceRefused(PLACE_UNREAD);
		return { files, reading: true };
	}

	/** The place a reading act asks for, or none where it asks for this
	 *  project. A place this thread does not read is answered as such. */
	#placeNamed(call: ChatToolCall): ChatPlace | undefined {
		const named = 'in' in call.arguments ? call.arguments.in : undefined;
		if (named === undefined || named === '') return undefined;
		const place = this.#places.find((one) => one.name === named);
		if (!place) throw new PlaceRefused(NO_PLACE);
		return place;
	}

	/** One of Sloppy's own acts, done here and answered to the agent. What the
	 *  act lays out for the PERSON is held here; the agent reads `said` and
	 *  nothing else. */
	async #serve(call: ChatToolCall): Promise<ChatToolAnswer> {
		const done = await this.#act(call);
		this.#done.set(call.call, done);
		return { said: done.said, ...(done.trouble === undefined ? {} : { trouble: done.trouble }) };
	}

	async #act(call: ChatToolCall): Promise<ChatActDone> {
		whatHappened.put('act', `${doingIn(call.act)} began`, call.call);
		try {
			const where = await this.#filesFor(call);
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
