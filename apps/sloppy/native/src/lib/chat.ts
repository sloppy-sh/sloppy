/**
 * This shell's half of `ChatAccess` in `@sloppy/app-core`, which declares every
 * act, what its answer means, and what this side is obliged to parse. The agent
 * is started by `src-tauri/src/chat.rs`; what a line it writes MEANS is
 * `chat-stream.ts`. Sloppy's own acts are the page's, which hands this the
 * `serve` a call is done through.
 */

import { troubleIn, whatHappened, type ChatAccess, type ChatAsked } from '@sloppy/app-core';
import {
	advertisedChatTools,
	argumentsFit,
	CHAT_AGENTS,
	CHAT_ASKED_MAX,
	chatAgentName,
	ChatEventSchema,
	ChatToolAnswerSchema,
	ChatToolCallSchema,
	chatToolWrites,
	ulid,
	type ChatAgent,
	type ChatCallId,
	type ChatEvent,
	type ChatToolAnswer,
	type ChatToolCall
} from '@sloppy/types';
import { chatBrief } from '@sloppy/local';
import { Channel, invoke } from '@tauri-apps/api/core';
import { AgentStream } from './chat-stream';
import type { Invoke } from './files';

/** The commands `src-tauri` answers. */
const AGENTS = 'chat_agents';
const OPEN = 'chat_open';
const SAY = 'chat_say';
const ANSWER = 'chat_answer';
const CLOSE = 'chat_close';

const NO_PROJECT = 'Open the project these notes are about first.';
const NO_CHAT = 'That chat is over. Start another one.';
const ANSWERING = 'Wait for the answer, or stop it, before saying the next thing.';
const SAY_SOMETHING = 'Say what you want written about.';
const TOO_MUCH = 'That is too long to send in one go. Shorten it and try again.';
const DIDNT_WORK = 'That did not work. Try again.';

/** What an act that could not be read or was turned down tells the AGENT, which
 *  reads these and acts on them. */
const UNREADABLE_CALL = 'Sloppy could not read that call.';
const TURNED_DOWN =
	'The person turned that down. Do not try it again as it stands — ask them what they want instead.';
const DIDNT_ANSWER = 'Sloppy could not do that.';

/** What a session is told, as `src-tauri/src/chat.rs` writes it. */
export type Told =
	| { from: 'said'; line: string }
	| { from: 'called'; call: string; act: string; arguments: unknown }
	| { from: 'over'; stopped: boolean; trouble: string | null };

/** What a session is told over — `Channel` in `@tauri-apps/api` is the one a
 *  running app uses. */
export interface Telling {
	onmessage: (told: Told) => void;
}

/** The page doing one of Sloppy's own acts and answering for it, as
 *  `ChatAccess.open` hands it over. */
type Serving = (call: ChatToolCall) => Promise<ChatToolAnswer>;

/** A rejection whose message is already the words a person reads. */
function refuse(said: string): Error {
	return new Error(said);
}

/** What `src-tauri` rejected with, which is already words for the person. */
function said(reason: unknown): string {
	return typeof reason === 'string' && reason !== '' ? reason : DIDNT_WORK;
}

function nothingToChatWith(): string {
	const known = CHAT_AGENTS.map(chatAgentName).join(' or ');
	return `Sloppy has nothing on this computer to chat with. Install ${known} and try again.`;
}

interface Settling {
	done: Promise<void>;
	ends: () => void;
}

function settling(): Settling {
	let ends!: () => void;
	const done = new Promise<void>((resolve) => (ends = resolve));
	return { done, ends };
}

/** The turn underway. `stopped` is a person who ended it, which is theirs to
 *  know and is not trouble. */
interface Turn extends Settling {
	stopped: boolean;
}

/** One session, held so that what it is told reaches the page that opened it
 *  and nothing else — a session another was opened over is let go of here
 *  while its own program is still being reaped. */
class Session {
	readonly stream = new AgentStream();
	/** Every call waiting on the person, by the answer that closes the question
	 *  in the thread. */
	readonly asking = new Map<ChatCallId, (allowed: boolean) => void>();
	readonly over = settling();
	turn?: Turn;
	gone = false;

	constructor(
		readonly hear: (event: ChatEvent) => void,
		readonly serve: Serving
	) {}

	/** Every event a page sees, held to its own shape first. */
	tell(event: ChatEvent): void {
		const held = ChatEventSchema.safeParse(event);
		if (held.success) this.hear(held.data);
	}

	/** The turn underway is over, however it ended. */
	ends(): void {
		const turn = this.turn;
		if (!turn) return;
		this.turn = undefined;
		this.tell({ event: 'ended', ...(turn.stopped ? { stopped: true } : {}) });
		turn.ends();
	}

	/** The session is over: nothing it was doing goes on, and every call waiting
	 *  on the person is answered by its ending. */
	letGo(trouble?: string): void {
		if (this.gone) return;
		this.gone = true;
		for (const [call, answer] of [...this.asking]) {
			this.asking.delete(call);
			answer(false);
		}
		this.ends();
		this.tell({ event: 'over', ...(trouble === undefined ? {} : { said: trouble }) });
		this.over.ends();
	}
}

class TauriChat implements ChatAccess {
	private held?: Session;

	constructor(
		private readonly here: () => Promise<string | undefined>,
		private readonly call: Invoke,
		private readonly telling: () => Telling
	) {}

	async agents(): Promise<ChatAgent[]> {
		const held = await this.call<string[]>(AGENTS);
		return CHAT_AGENTS.filter((agent) => held.includes(agent));
	}

	async open(asked: ChatAsked, hear: (event: ChatEvent) => void, serve: Serving): Promise<void> {
		const agent = await this.agentFor(asked.agent);
		const root = await this.project();
		this.replaces();
		const session = new Session(hear, serve);
		const told = this.telling();
		told.onmessage = (one) => this.told(session, one);
		this.held = session;
		await this.call<void>(OPEN, {
			asked: {
				agent,
				root,
				tools: advertisedChatTools(),
				brief: chatBrief(),
				...(asked.model === undefined ? {} : { model: asked.model })
			},
			heard: told
		}).catch((reason) => {
			if (this.held === session) this.held = undefined;
			// Nothing started, so the page that asked is told by the rejection and
			// never by an `over` for a session it never saw.
			session.gone = true;
			throw refuse(said(reason));
		});
	}

	async say(asked: string): Promise<void> {
		const session = this.standing();
		if (session.turn) throw refuse(ANSWERING);
		const asking = asked.trim();
		if (asking === '') throw refuse(SAY_SOMETHING);
		if (asking.length > CHAT_ASKED_MAX) throw refuse(TOO_MUCH);
		session.stream.turned();
		const turn: Turn = { stopped: false, ...settling() };
		session.turn = turn;
		await this.call<void>(SAY, { line: JSON.stringify(aTurn(asking)) }).catch((reason) => {
			if (session.turn === turn) session.turn = undefined;
			turn.ends();
			throw refuse(said(reason));
		});
	}

	async settle(call: ChatCallId, allowed: boolean): Promise<void> {
		const answer = this.held?.asking.get(call);
		if (!answer) return;
		this.held?.asking.delete(call);
		answer(allowed);
	}

	async stop(): Promise<void> {
		const session = this.held;
		const turn = session?.turn;
		if (!session || !turn) return;
		turn.stopped = true;
		await this.call<void>(SAY, { line: JSON.stringify(anInterrupt()) }).catch(() => {
			session.ends();
		});
		await turn.done;
	}

	async close(): Promise<void> {
		const session = this.held;
		if (!session) return;
		this.held = undefined;
		await this.call<void>(CLOSE).catch(() => session.letGo());
		await session.over.done;
	}

	/** Let go of the session that stood, so that a page waiting on its end is
	 *  not left waiting on a program this one is about to replace. */
	private replaces(): void {
		const standing = this.held;
		this.held = undefined;
		standing?.letGo();
	}

	private told(session: Session, one: Told): void {
		if (session.gone) return;
		switch (one.from) {
			case 'said': {
				const heard = session.stream.read(one.line);
				for (const event of heard.events) session.tell(event);
				if (heard.ended) session.ends();
				return;
			}
			case 'called':
				void this.does(session, one);
				return;
			case 'over':
				session.letGo(one.trouble ?? undefined);
				return;
		}
	}

	/**
	 * One of Sloppy's own acts, from the call arriving to the agent being told
	 * what it came to. A call whose arguments the act's own shape refuses is
	 * never served; the agent is told what it was refused for so that it can
	 * call again.
	 */
	private async does(
		session: Session,
		one: { call: string; act: string; arguments: unknown }
	): Promise<void> {
		const held = ChatToolCallSchema.safeParse({
			call: one.call,
			act: one.act,
			arguments: one.arguments
		});
		if (!held.success) {
			const refused = held.error.issues[0]?.message ?? UNREADABLE_CALL;
			// The page never sees this one, so the record is the only place it
			// leaves a mark.
			whatHappened.put('trouble', `${one.act} was refused before it ran: ${refused}`, one.call);
			await this.answers(one.call, { said: refused, trouble: true });
			return;
		}
		const call = held.data;
		if (chatToolWrites(call.act)) {
			session.tell({
				event: 'asking',
				call: call.call,
				act: call.act,
				...(argumentsFit(one.arguments) ? { arguments: one.arguments } : {})
			});
			const allowed = await new Promise<boolean>((resolve) =>
				session.asking.set(call.call, (answer) => {
					// Told before anything else the answer sets off, so that a page
					// closes the question ahead of a session ending under it.
					session.tell({ event: 'settled', call: call.call, allowed: answer });
					resolve(answer);
				})
			);
			if (!allowed) {
				await this.answers(one.call, { said: TURNED_DOWN, trouble: true });
				return;
			}
		}
		try {
			await this.answers(one.call, await session.serve(call));
		} catch {
			// An act says what it could not do in its own answer, so nothing
			// thrown past that has words the agent could act on.
			await this.answers(one.call, { said: DIDNT_ANSWER, trouble: true });
		}
	}

	/** What the act answered, held to its shape on the way out to the agent. */
	private async answers(call: string, answer: ChatToolAnswer): Promise<void> {
		const held = ChatToolAnswerSchema.safeParse(answer);
		const said = held.success
			? held.data
			: { said: held.error.issues[0]?.message ?? DIDNT_ANSWER, trouble: true };
		await this.call<void>(ANSWER, {
			call,
			said: said.said,
			trouble: said.trouble ?? false
		}).catch((reason) => {
			// The session is over, so nothing is waiting on this answer — but an
			// agent left waiting on one that never arrived is exactly what a person
			// keeping a record is trying to find out about.
			whatHappened.put('trouble', `the answer did not reach the agent: ${troubleIn(reason)}`, call);
		});
	}

	private standing(): Session {
		const session = this.held;
		if (!session || session.gone) throw refuse(NO_CHAT);
		return session;
	}

	private async project(): Promise<string> {
		const root = await this.here();
		if (!root) throw refuse(NO_PROJECT);
		return root;
	}

	private async agentFor(asked?: ChatAgent): Promise<ChatAgent> {
		const held = await this.agents();
		if (asked !== undefined) {
			if (held.includes(asked)) return asked;
			throw refuse(`${chatAgentName(asked)} is not on this computer. Install it and try again.`);
		}
		const [first] = held;
		if (first === undefined) throw refuse(nothingToChatWith());
		return first;
	}
}

/** The agent's own dialect, and the only two lines this shell writes in it:
 *  what somebody said, and an end to what it is doing now. */
function aTurn(said: string): unknown {
	return { type: 'user', message: { role: 'user', content: [{ type: 'text', text: said }] } };
}

function anInterrupt(): unknown {
	return { type: 'control_request', request_id: ulid(), request: { subtype: 'interrupt' } };
}

/** `here` is the folder holding the code the notes are about, which is where
 *  the agent is started. */
export function tauriChat(
	here: () => Promise<string | undefined>,
	call: Invoke = invoke,
	telling: () => Telling = () => new Channel<Told>()
): ChatAccess {
	return new TauriChat(here, call, telling);
}
