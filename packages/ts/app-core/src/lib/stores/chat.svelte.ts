/**
 * A chat with an agent about the project in front of somebody — what has been
 * said, what is arriving now, and the act waiting on the person's answer.
 * docs/ARCHITECTURE.md § "Asking a tool to write the notes".
 *
 * Nothing here parses what arrives: the seam parses in both directions and
 * rejects with the words this store shows.
 */

import {
	type ChatAgent,
	type ChatBlock,
	type ChatCallId,
	type ChatEvent,
	type ChatToolAnswer,
	type ChatToolCall,
	type ChatToolName,
	type ChatTurn,
	type OwnedRef
} from '@sloppy/types';
import { serveChatCall } from '../chat-acts.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { wordsFor } from './errors.js';
import { graphs } from './graphs.svelte.js';

const UNSTARTED = 'Sloppy could not start a chat just now. Try again.';
const UNSAID = 'Sloppy could not send that just now. Try again.';

/** Words for the AGENT, which reads a rejection rather than being left
 *  waiting on it. */
const NO_PROJECT = 'There is no project open here, so there are no notes to work on.';

/** The agents this device has. `null` is a device nobody has asked, and
 *  `'untold'` one whose answer did not arrive — which is not the answer a
 *  device with no agent gives. */
export type ChatAgents = readonly ChatAgent[] | 'untold' | null;

/** One of Sloppy's own acts, waiting on the person. `arguments` is carried
 *  untouched; a surface parses it against the act's own schema before drawing
 *  any of it. */
export interface ChatAsking {
	call: ChatCallId;
	act: ChatToolName;
	arguments: unknown;
}

function personTurn(said: string): ChatTurn {
	return { from: 'person', blocks: [{ kind: 'said', said }], at: new Date().toISOString() };
}

function agentTurn(): ChatTurn {
	return { from: 'agent', blocks: [], at: new Date().toISOString() };
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
	#stopping = $state(false);
	/** Whether a write was allowed in the turn underway, which is what the
	 *  canvas has not read yet when it ends. */
	#wrote = false;
	#trouble = $state.raw<string | null>(null);
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

	get turns(): readonly ChatTurn[] {
		return this.#turns;
	}

	/** Whether the agent is answering the last thing it was told. */
	get running(): boolean {
		return this.#running;
	}

	/** The act waiting on the person, or `null` while none is. */
	get asking(): ChatAsking | null {
		return this.#asking;
	}

	/** Whether their answer has been given and has not landed yet. */
	get settling(): boolean {
		return this.#settling;
	}

	/** Whether an end has been asked for and has not landed yet. */
	get stopping(): boolean {
		return this.#stopping;
	}

	/** What went wrong, in words meant for the person. */
	get trouble(): string | null {
		return this.#trouble;
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
	 * and neither is the empty string.
	 */
	async say(words: string): Promise<void> {
		const access = seam().chat();
		const said = words.trim();
		if (!access || said === '' || this.#running) return;
		const epoch = this.#epoch;
		this.#trouble = null;
		this.#running = true;
		this.#writing = false;
		this.#turns = [...this.#turns, personTurn(said)];
		if (!this.#standing) {
			try {
				await access.open(
					{},
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
		}
		try {
			await access.say(said);
		} catch (error) {
			if (epoch !== this.#epoch) return;
			this.#trouble = wordsFor(error) ?? UNSAID;
			this.#running = false;
		}
	}

	/** The person's answer to an act that would write. The question closes on
	 *  being told it has settled, never on this act alone. */
	async settle(call: ChatCallId, allowed: boolean): Promise<void> {
		const access = seam().chat();
		if (!access || this.#settling) return;
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

	/** Another graph has not had this one's conversation. */
	forget(graph: OwnedRef): void {
		if (this.#of !== null && this.#of !== graph) this.clear();
	}

	clear(): void {
		if (this.#standing) {
			void seam()
				.chat()
				?.close()
				.catch(() => {});
		}
		this.#epoch += 1;
		this.#of = null;
		this.#agents = null;
		this.#turns = [];
		this.#standing = false;
		this.#running = false;
		this.#writing = false;
		this.#asking = null;
		this.#settling = false;
		this.#wrote = false;
		this.#trouble = null;
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
				this.#asking = { call: event.call, act: event.act, arguments: event.arguments };
				break;
			case 'settled':
				if (event.allowed) this.#wrote = true;
				if (this.#asking?.call === event.call) this.#asking = null;
				break;
			case 'ended':
				this.#running = false;
				this.#writing = false;
				// A question the turn ended under is one nobody can answer now.
				this.#asking = null;
				this.#readTheFolderAgain();
				break;
			case 'over':
				this.#standing = false;
				this.#running = false;
				this.#writing = false;
				this.#asking = null;
				this.#readTheFolderAgain();
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

	/** A note a turn wrote is one somebody can open, which it is not until the
	 *  canvas has read the folder it landed in. */
	#readTheFolderAgain(): void {
		if (!this.#wrote) return;
		this.#wrote = false;
		void graphs.readFolderAgain().catch(() => {});
	}

	/** One of Sloppy's own acts, done here and answered to the agent. */
	async #serve(call: ChatToolCall): Promise<ChatToolAnswer> {
		const project = await runtime.project();
		if (!project) throw new Error(NO_PROJECT);
		return await serveChatCall(project, call);
	}
}

export const chat = new ChatStore();
