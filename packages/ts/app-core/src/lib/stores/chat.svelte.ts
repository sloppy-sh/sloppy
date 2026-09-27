/**
 * A chat with an agent about the project in front of somebody — what has been
 * said, and what is arriving now. docs/ARCHITECTURE.md § "Asking a tool to
 * write the notes".
 *
 * Every act LANDS: the session works in a draft of the notes, so nothing here
 * waits on the person and nothing of theirs changes while it runs.
 * `stores/chat-draft.svelte.ts` is the draft, and what a person does with one.
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
	type ChatAttachment,
	type ChatBlock,
	type ChatCallId,
	type ChatEvent,
	type ChatModel,
	chatModels,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatToolName,
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
import { chatDraft } from './chat-draft.svelte.js';
import { wordsFor } from './errors.js';
import { prefs } from './prefs.svelte.js';
import { doingIn, troubleIn, whatHappened } from './what-happened.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNSAID = 'Sloppy could not send that just now. Try again.';
const UNKEPT = 'Sloppy could not keep that just now. Try again.';
const UNATTACHED = 'Sloppy could not put that where the chat can read it. Try again.';
const TOO_MANY = `You can put ${MOST_ATTACHED_PER_TURN} things in front of it at once.`;

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';
const NO_DRAFT = 'There is no draft of the notes to write into.';

/** What a file with no name of its own is called. */
const UNNAMED = 'A file';

/** The agents this device has. `null` is a device nobody has asked, and
 *  `'untold'` one whose answer did not arrive — which is not the answer a
 *  device with no agent gives. */
export type ChatAgents = readonly ChatAgent[] | 'untold' | null;

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

class ChatStore {
	#of = $state.raw<OwnedRef | null>(null);
	/** Unasked until somebody opens the chat: asking sooner would look for a
	 *  program nobody asked for. */
	#agents = $state.raw<ChatAgents>(null);
	#turns = $state.raw<readonly ChatTurn[]>([]);
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
		await chatDraft.look();
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
				// The agent runs where the draft is, so the copy exists before the
				// session that works in it.
				await this.#writesInto();
				await access.open(
					{
						...(agent === undefined ? {} : { agent }),
						...(model === undefined ? {} : { model })
					},
					(event) => this.#heard(epoch, event),
					(call) => this.#serve(call)
				);
			} catch (error) {
				whatHappened.put('trouble', `the chat would not start: ${troubleIn(error)}`);
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

	/** Let this conversation go and begin another, on the same graph. */
	startAgain(): void {
		this.#letGo();
		this.#done.clear();
		this.#kept.clear();
		this.#turns = [];
	}

	/**
	 * The draft is gone, taken in or thrown away. The session ran WHERE the
	 * draft was, so it is over with it; what was said stays on screen, and the
	 * next thing said opens another session in another draft.
	 */
	draftGone(): void {
		if (this.#standing) this.#letGo();
	}

	/** Another graph has not had this one's conversation. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		this.#letGo();
		this.#done.clear();
		this.#kept.clear();
		chatDraft.clear();
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
		this.#keeping = null;
		this.#keepSettling = false;
		this.#letAttachedGo();
		this.#openedWith = undefined;
		this.#trouble = null;
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
				break;
			}
			case 'block':
				this.#block(event.at, event.block);
				break;
			case 'ended':
				whatHappened.put(
					'turn',
					event.stopped === true ? 'the turn was stopped' : 'the turn ended'
				);
				this.#running = false;
				this.#writing = false;
				void chatDraft.keepWhatTheTurnWrote();
				break;
			case 'over':
				if (event.said === undefined) whatHappened.put('turn', 'the chat is over');
				else whatHappened.put('trouble', 'the chat could not go on');
				this.#standing = false;
				this.#running = false;
				this.#writing = false;
				this.#openedWith = undefined;
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

	/**
	 * Where the chat's acts and the files put in front of it are written: the
	 * draft this device keeps one in, and the project itself where it keeps
	 * none. A turn beginning is what starts a draft, so this starts one where
	 * none stands. REJECTS in words the agent reads.
	 */
	async #writesInto(): Promise<Files> {
		if (!chatDraft.keeps) {
			const project = await runtime.project();
			if (!project) throw new Error(NO_PROJECT);
			return project;
		}
		if (!chatDraft.standing) await chatDraft.start();
		const files = chatDraft.files();
		if (!files) throw new Error(NO_DRAFT);
		return files;
	}

	/** The same folder, for taking something back off it: a draft that is not
	 *  standing holds nothing to take off, so this starts none. */
	async #written(): Promise<Files | undefined> {
		return chatDraft.keeps ? chatDraft.files() : await runtime.project();
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
			const done: ChatActDone = await serveChatCall(await this.#writesInto(), call);
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
			throw error;
		}
	}
}

export const chat = new ChatStore();
