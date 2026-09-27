/**
 * A chat with an agent about the project in front of somebody — what has been
 * said, what is arriving now, and the act waiting on the person's answer.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * Nothing here parses what arrives: the seam parses in both directions and
 * rejects with the words this store shows.
 */

import { ATTACHED_DIR, CONTAINER_DIR } from '@sloppy/local';
import {
	CHAT_ASKED_MAX,
	CHAT_ATTACHED_NAME_MAX,
	CHAT_ATTACHMENT_MAX,
	type ChatActDone,
	type ChatAgent,
	type ChatAttachment,
	type ChatBlock,
	type ChatCallId,
	type ChatEvent,
	type ChatModel,
	chatModels,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatToolName,
	chatToolWrites,
	type ChatTurn,
	MOST_ATTACHED_PER_TURN,
	type OwnedRef,
	ulid,
	type WriteNoteArguments
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { serveChatCall } from '../chat-acts.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { wordsFor } from './errors.js';
import { graphs } from './graphs.svelte.js';
import { prefs } from './prefs.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNSAID = 'Sloppy could not send that just now. Try again.';
const UNKEPT = 'Sloppy could not keep that just now. Try again.';
const UNATTACHED = 'Sloppy could not put that where the chat can read it. Try again.';
const TOO_MANY = `You can put ${MOST_ATTACHED_PER_TURN} things in front of it at once.`;

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';

/** Where what somebody attached is written: the chat's own folder inside the
 *  project, which is where the agent reads it from. */
const ATTACHED_AT = `${CONTAINER_DIR}/${ATTACHED_DIR}`;

/** What a file with no name of its own is called. */
const UNNAMED = 'A file';

/** The agents this device has. `null` is a device nobody has asked, and
 *  `'untold'` one whose answer did not arrive — which is not the answer a
 *  device with no agent gives. */
export type ChatAgents = readonly ChatAgent[] | 'untold' | null;

/** One act waiting on the person. `arguments` is carried untouched; a surface
 *  parses it against the act's own schema before drawing any of it. */
export interface ChatAsking {
	call: ChatCallId;
	act: ChatToolName;
	arguments: unknown;
}

/** An answer somebody asked to keep as a note, waiting on their say-so. It is
 *  the person's own act, so nothing the agent's turn does answers it. */
export interface ChatKeeping extends ChatAsking {
	/** Where the turn whose answer it would keep stands. */
	at: number;
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

/** A name a file keeps wherever it lands: what a person called it, with
 *  anything a path cannot carry turned into a dash. */
function filed(name: string): string {
	const held = name
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[-.]+/, '')
		.slice(0, CHAT_ATTACHED_NAME_MAX);
	return held === '' ? 'file' : held;
}

class ChatStore {
	#of = $state.raw<OwnedRef | null>(null);
	/** Unasked until somebody opens the chat: asking sooner would look for a
	 *  program nobody asked for. */
	#agents = $state.raw<ChatAgents>(null);
	#turns = $state.raw<readonly ChatTurn[]>([]);
	#standing = $state(false);
	#running = $state(false);
	#asking = $state.raw<ChatAsking | null>(null);
	#settling = $state(false);
	#keeping = $state.raw<ChatKeeping | null>(null);
	#keepSettling = $state(false);
	#stopping = $state(false);
	/** What each of Sloppy's own acts came to, for the person — the agent read
	 *  its own half and this is the rest of it. */
	readonly #done = new SvelteMap<ChatCallId, ChatActDone>();
	/** What came of keeping a turn's answer, by where that turn stands. */
	readonly #kept = new SvelteMap<number, ChatActDone>();
	/** The notes the acts so far left different, and whether one of them left
	 *  the canvas nothing to go on. */
	#touched: OwnedRef[] = [];
	#blind = false;
	/** Whether everything the reply underway writes has been allowed at once.
	 *  It goes with that reply: the next one asks again. */
	#allowedThisTurn = $state(false);
	#attached = $state.raw<readonly ChatAttachment[]>([]);
	#trouble = $state.raw<string | null>(null);
	/** Which model the standing session was opened with, so a person who picks
	 *  another is told the one in front of them still answers. */
	#openedWith = $state.raw<string | undefined>(undefined);
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

	/** The agent this chat is with. Absent until this device has said it has
	 *  one. */
	get agent(): ChatAgent | undefined {
		const held = this.#agents;
		return Array.isArray(held) ? held[0] : undefined;
	}

	get turns(): readonly ChatTurn[] {
		return this.#turns;
	}

	/** Whether the agent is answering the last thing it was told. */
	get running(): boolean {
		return this.#running;
	}

	/** The agent's act waiting on the person, or `null` while none is. */
	get asking(): ChatAsking | null {
		return this.#asking;
	}

	/** Whether their answer has been given and has not landed yet. */
	get settling(): boolean {
		return this.#settling;
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

	/** Whether what this reply writes has been allowed already, so the rest of
	 *  it lands without asking again. */
	get allowedThisTurn(): boolean {
		return this.#allowedThisTurn;
	}

	/** Whether writes land without being asked about at all. It is the person's
	 *  standing answer, kept across chats until they take it back. */
	get writesWithoutAsking(): boolean {
		return prefs.current.writesWithoutAsking;
	}

	askBeforeWriting(asking: boolean): void {
		prefs.set('writesWithoutAsking', !asking);
	}

	/** Whether an end has been asked for and has not landed yet. */
	get stopping(): boolean {
		return this.#stopping;
	}

	/** What went wrong, in words meant for the person. */
	get trouble(): string | null {
		return this.#trouble;
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
	 * conversation, so what is held is let go of; the same one is picked up
	 * where it was left.
	 */
	async opened(graph: OwnedRef): Promise<void> {
		if (this.#of !== null && this.#of !== graph) this.clear();
		this.#of = graph;
		const held = this.#agents;
		if (held === null || held === 'untold') await this.lookForAgents();
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
		} catch {
			this.#agents = 'untold';
		}
	}

	/**
	 * Say something, which begins a turn — starting the session where none
	 * stands. Nothing is said while the agent is still answering the last turn,
	 * nor while a question of the agent's stands: the turn it would begin could
	 * raise a second one over the first, and the answer to that one would go
	 * nowhere. Neither is the empty string with nothing attached.
	 */
	async say(words: string): Promise<void> {
		const access = seam().chat();
		const said = words.trim();
		const attached = this.#attached;
		if (!access || (said === '' && attached.length === 0) || this.#running) return;
		if (this.#asking !== null) return;
		const epoch = this.#epoch;
		this.#trouble = null;
		this.#running = true;
		this.#writing = false;
		this.#attached = [];
		const blocks: ChatBlock[] = [
			...(said === '' ? [] : [{ kind: 'said' as const, said }]),
			...(attached.length === 0 ? [] : [{ kind: 'attached' as const, attached: [...attached] }])
		];
		this.#turns = [...this.#turns, { from: 'person', blocks, at: new Date().toISOString() }];
		if (!this.#standing) {
			const agent = this.agent;
			const model = this.model;
			try {
				await access.open(
					{
						...(agent === undefined ? {} : { agent }),
						...(model === undefined ? {} : { model })
					},
					(event) => this.#heard(epoch, event),
					(call) => this.#serve(call)
				);
			} catch (error) {
				if (epoch !== this.#epoch) return;
				this.#trouble = wordsFor(error) ?? UNSTARTED;
				this.#running = false;
				return;
			}
			if (epoch !== this.#epoch) return;
			this.#standing = true;
			this.#openedWith = model;
		}
		try {
			await access.say(withAttached(said, attached));
		} catch (error) {
			if (epoch !== this.#epoch) return;
			this.#trouble = wordsFor(error) ?? UNSAID;
			this.#running = false;
		}
	}

	/**
	 * Put files in front of the agent, which writes them inside the project so
	 * that it reads them where it reads everything else. What comes back is
	 * what to tell the person where one of them did not go, and `null` where
	 * they all did.
	 */
	async attach(files: readonly File[]): Promise<string | null> {
		const project = await runtime.project();
		if (!project || files.length === 0) return null;
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
			const path = `${ATTACHED_AT}/${ulid()}-${filed(file.name)}`;
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
		const project = await runtime.project();
		await project?.remove(path).catch(() => {});
	}

	/**
	 * Keep the answer in the turn at `at` as a note. It is the person's own
	 * write, so it goes through the act the agent's writes go through and stands
	 * behind the same card — where they read what would land and turn it down.
	 * It is asked whatever {@link ChatStore.writesWithoutAsking} says, because
	 * that answer is about what the AGENT writes unasked.
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
			this.#readAgain();
		}
	}

	/**
	 * The person's answer to an act of the agent's that would write. Its
	 * question closes on being told it has settled, never on this act alone.
	 *
	 * `andTheRest` allows everything else the reply underway writes, so a person
	 * documenting thirty files answers once rather than thirty times.
	 */
	async settle(call: ChatCallId, allowed: boolean, andTheRest = false): Promise<void> {
		if (this.#settling) return;
		const access = seam().chat();
		if (!access) return;
		if (allowed && andTheRest) this.#allowedThisTurn = true;
		this.#settling = true;
		try {
			await access.settle(call, allowed);
		} finally {
			this.#settling = false;
		}
	}

	/** End the turn underway. The conversation stands, and the next thing said
	 *  goes on with it. */
	async stop(): Promise<void> {
		const access = seam().chat();
		if (!access || this.#stopping) return;
		this.#stopping = true;
		try {
			await access.stop();
		} finally {
			this.#stopping = false;
		}
	}

	/** Let this conversation go and begin another, on the same graph. */
	startAgain(): void {
		this.#letGo();
		this.#turns = [];
	}

	/** Another graph has not had this one's conversation. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		this.#letGo();
		this.#of = null;
		this.#agents = null;
		this.#turns = [];
	}

	#letGo(): void {
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
		this.#asking = null;
		this.#settling = false;
		this.#keeping = null;
		this.#keepSettling = false;
		this.#allowedThisTurn = false;
		this.#done.clear();
		this.#kept.clear();
		this.#touched = [];
		this.#blind = false;
		this.#letAttachedGo();
		this.#openedWith = undefined;
		this.#trouble = null;
	}

	/** What was put in front of a conversation that is being let go was never
	 *  said, so nothing reads it again and it comes off the project with it. */
	#letAttachedGo(): void {
		const held = this.#attached;
		this.#attached = [];
		if (held.length === 0) return;
		void runtime
			.project()
			.then((project) => Promise.all(held.map((one) => project?.remove(one.path))))
			.catch(() => {});
	}

	#heard(epoch: number, event: ChatEvent): void {
		if (epoch !== this.#epoch) return;
		switch (event.event) {
			case 'started':
				this.#standing = true;
				break;
			case 'block':
				this.#block(event.at, event.block);
				break;
			case 'asking':
				// A question already answered — for this reply, or standingly — is
				// answered rather than put in front of somebody again.
				if (this.#allowedThisTurn || prefs.current.writesWithoutAsking) {
					void this.settle(event.call, true);
					break;
				}
				this.#asking = { call: event.call, act: event.act, arguments: event.arguments };
				break;
			case 'settled':
				if (this.#asking?.call === event.call) this.#asking = null;
				break;
			case 'ended':
				this.#running = false;
				this.#writing = false;
				this.#allowedThisTurn = false;
				// A question the turn ended under is one nobody can answer now.
				this.#asking = null;
				this.#readAgain();
				break;
			case 'over':
				this.#standing = false;
				this.#running = false;
				this.#writing = false;
				this.#allowedThisTurn = false;
				this.#asking = null;
				this.#openedWith = undefined;
				this.#readAgain();
				this.#trouble = event.said ?? null;
				break;
		}
	}

	/** A block already at this place in the turn underway is that block grown. */
	#block(at: number, block: ChatBlock): void {
		const turns = this.#writing ? [...this.#turns] : [...this.#turns, agentTurn()];
		this.#writing = true;
		const turn = turns[turns.length - 1];
		const blocks = [...turn.blocks];
		if (at < blocks.length) blocks[at] = block;
		else blocks.push(block);
		turns[turns.length - 1] = { ...turn, blocks };
		this.#turns = turns;
	}

	/** What the acts left different, read off the device again — a note they
	 *  wrote is one somebody can open only once the canvas has it. An act that
	 *  named nothing leaves the whole folder to be read. */
	#readAgain(): void {
		const touched = this.#touched;
		const blind = this.#blind;
		this.#touched = [];
		this.#blind = false;
		if (blind) void graphs.readFolderAgain().catch(() => {});
		else if (touched.length > 0) void graphs.readTheseAgain(touched).catch(() => {});
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
		const project = await runtime.project();
		if (!project) throw new Error(NO_PROJECT);
		const done: ChatActDone = await serveChatCall(project, call);
		if (chatToolWrites(call.act)) {
			if (done.touched === undefined) this.#blind = true;
			else this.#touched = [...this.#touched, ...done.touched];
		}
		return done;
	}
}

export const chat = new ChatStore();
