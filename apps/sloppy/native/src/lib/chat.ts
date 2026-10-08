/**
 * This shell's half of `ChatAccess` in `@sloppy/app-core`, which declares every
 * act, what its answer means, and what this side is obliged to parse. The agent
 * is started by `src-tauri/src/chat.rs`; what a line it writes MEANS is
 * `chat-stream.ts`. Sloppy's own acts are the page's, which hands this the
 * `serve` a call is done through.
 */

import {
	doingIn,
	troubleIn,
	whatHappened,
	type ChatAccess,
	type ChatAsked,
	type ChatLive
} from '@sloppy/app-core';
import {
	advertisedChatTools,
	type AdvertisedTool,
	CHAT_AGENTS,
	CHAT_ASKED_MAX,
	type ChatAgent,
	chatAgentName,
	chatAgentReach,
	type ChatEvent,
	ChatEventSchema,
	type ChatSpend,
	type ChatToolAnswer,
	ChatToolAnswerSchema,
	type ChatToolCall,
	ChatToolCallSchema,
	ulid
} from '@sloppy/types';
import { type AiKeysAccess, chatBrief } from '@sloppy/local';
import { Refusal } from '@sloppy/ui';
import { Channel, invoke } from '@tauri-apps/api/core';
import { AgentStream } from './chat-stream';
import type { DraftAccess } from './draft';
import type { Invoke } from './files';

/** The commands `src-tauri` answers. */
const AGENTS = 'chat_agents';
const OPEN = 'chat_open';
const SAY = 'chat_say';
const ANSWER = 'chat_answer';
const CLOSE = 'chat_close';

/** How long the agent has to answer what is in its window over its own channel
 *  before it is asked in words instead. An agent that does not answer the one
 *  is not one to leave the chart blank over. */
const ANSWERS_WITHIN = 8_000;

const NO_PROJECT = 'Open the project these notes are about first.';
const NO_CHAT = 'That chat is over. Start another one.';
const ANSWERING = 'Wait for the answer, or stop it, before saying the next thing.';
const SAY_SOMETHING = 'Say what you want written about.';
const TOO_MUCH = 'That is too long to send in one go. Shorten it and try again.';
const DIDNT_WORK = 'That did not work. Try again.';

/** What an act that could not be read or could not be done tells the AGENT,
 *  which reads these and acts on them. */
const UNREADABLE_CALL = 'Sloppy could not read that call.';
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
	return new Refusal(said);
}

/** What `src-tauri` rejected with, which is already words for the person. */
function said(reason: unknown): string {
	return typeof reason === 'string' && reason !== '' ? reason : DIDNT_WORK;
}

function nothingToChatWith(): string {
	const programs = CHAT_AGENTS.filter((agent) => chatAgentReach(agent) === 'program')
		.map(chatAgentName)
		.join(' or ');
	return `Sloppy has nothing on this computer to chat with. Install ${programs}, or give it a key in Settings, and try again.`;
}

interface Settling {
	done: Promise<void>;
	ends: () => void;
}

/** Something waited on that may never come: ended, or failed with words. */
interface Awaited {
	done: Promise<void>;
	ends: () => void;
	fails: (said: string) => void;
}

function awaiting(): Awaited {
	let ends!: () => void;
	let fails!: (said: string) => void;
	const done = new Promise<void>((resolve, reject) => {
		ends = resolve;
		fails = (said) => reject(refuse(said));
	});
	// Nothing may ever wait on it, and that is not an unhandled rejection.
	done.catch(() => {});
	return { done, ends, fails };
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

/** What `chat_open` is handed, kept so that a conversation the agent would not
 *  pick up can be opened again as a new one. */
interface Opening {
	agent: ChatAgent;
	root: string;
	/** Which of the person's threads this session is for, which is what every
	 *  later act is keyed by. */
	thread: string;
	tools: AdvertisedTool[];
	brief: string;
	places: string[];
	resume: boolean;
	/** Whether the agent may read the web while it answers. */
	web: boolean;
	model?: string;
	session?: string;
}

/** An ask for what is in the window that has not been answered yet. */
interface Asking {
	id: string;
	waited: ReturnType<typeof setTimeout>;
}

/** One thread's session, held so that what it is told reaches the page that
 *  opened it and nothing else — a session another was opened over is let go of
 *  here while its own program is still being reaped. */
class Session {
	readonly stream = new AgentStream();
	readonly over = settling();
	/** Settled once the agent has said what it is — which, for a conversation
	 *  being picked up, is the moment it is known to have been picked up or to
	 *  have been opened again as its own — and failed where the session ended
	 *  before that. The first thing said into one being picked up waits on it,
	 *  so the words reach the program that answers rather than one about to turn
	 *  the conversation down. */
	readonly ready = awaiting();
	turn?: Turn;
	gone = false;
	/** What this one was opened with, for opening it again as a conversation of
	 *  its own where the agent would not pick the one it was given back up. */
	opening?: Opening;
	/** Whether the agent has said what it is, which is what tells a session it
	 *  turned down from one it is running. */
	introduced = false;
	/** The ask for what is in the window that is still waiting. */
	asking?: Asking;
	/** Whether the agent answers that ask on its own channel. Undefined until
	 *  it has had the chance, false once it has been asked in words instead —
	 *  so no later ask waits the agent out again. */
	answersAsks?: boolean;
	/** Whether the turn underway is the one asking in words. What the agent
	 *  writes in it is the answer to a question nobody typed, so the thread
	 *  shows none of it. */
	reading = false;

	constructor(
		readonly thread: string,
		readonly hear: (event: ChatEvent) => void,
		readonly serve: Serving
	) {}

	/** Every event a page sees, held to its own shape first. */
	tell(event: ChatEvent): void {
		const held = ChatEventSchema.safeParse(event);
		if (held.success) this.hear(held.data);
	}

	/** The turn underway is over, however it ended. */
	ends(spent?: ChatSpend): void {
		const turn = this.turn;
		if (!turn) return;
		this.turn = undefined;
		this.tell({
			event: 'ended',
			...(turn.stopped ? { stopped: true } : {}),
			...(spent === undefined ? {} : { spent })
		});
		turn.ends();
	}

	/** The session is over: nothing it was doing goes on. */
	letGo(trouble?: string): void {
		if (this.gone) return;
		this.gone = true;
		this.ready.fails(trouble ?? NO_CHAT);
		this.waitsNoLonger();
		this.ends();
		this.tell({ event: 'over', ...(trouble === undefined ? {} : { said: trouble }) });
		this.over.ends();
	}

	/** The program this was reading is gone, and another is taking its place:
	 *  nothing it was going to answer is still coming. */
	startsOver(): void {
		this.waitsNoLonger();
		this.reading = false;
		this.stream.turned();
	}

	/** Nothing is waiting on an answer about the window any more. */
	waitsNoLonger(): void {
		if (this.asking === undefined) return;
		clearTimeout(this.asking.waited);
		this.asking = undefined;
	}
}

class TauriChat implements ChatAccess {
	/** The session standing for each thread, by that thread's id. How many of
	 *  them stand at once is the page's rule — `ChatAccess` in
	 *  `@sloppy/app-core` — so this holds whatever it is asked to hold. */
	private readonly held = new Map<string, Session>();

	constructor(
		private readonly here: () => Promise<string | undefined>,
		readonly drafts: DraftAccess | undefined,
		private readonly call: Invoke,
		private readonly telling: () => Telling,
		private readonly keys: AiKeysAccess | undefined
	) {}

	/** The agents this device reaches: the programs it found, and the agents a
	 *  key it holds opens. */
	async agents(): Promise<ChatAgent[]> {
		const programs = await this.call<string[]>(AGENTS);
		const keyed = ((await this.keys?.held().catch(() => [])) ?? []).map((one) => one.provider);
		return CHAT_AGENTS.filter((agent) => programs.includes(agent) || keyed.includes(agent));
	}

	async open(
		asked: ChatAsked,
		hear: (event: ChatEvent) => void,
		serve: Serving
	): Promise<ChatLive> {
		const agent = await this.agentFor(asked.agent);
		// A chat is about a project, so there being none is refused before a copy
		// is taken — and the agent works in the copy, never in the folder itself.
		const here = await this.project();
		const root = (await this.drafts?.start(asked.thread.id))?.root ?? here;
		const of = asked.thread.id;
		this.replaces(of);
		const session = new Session(of, hear, serve);
		this.held.set(of, session);
		await this.starts(session, {
			agent,
			root,
			thread: of,
			tools: advertisedChatTools(),
			brief: chatBrief(asked.thread.places),
			places: asked.thread.places.map((place) => place.root),
			resume: asked.thread.session !== undefined,
			web: asked.reachesWeb ?? true,
			...(asked.model === undefined ? {} : { model: asked.model }),
			...(asked.thread.session === undefined ? {} : { session: asked.thread.session })
		}).catch((reason) => {
			if (this.held.get(of) === session) this.held.delete(of);
			// Nothing started, so the page that asked is told by the rejection and
			// never by an `over` for a session it never saw.
			session.gone = true;
			throw refuse(said(reason));
		});
		return {
			say: (words) => this.says(of, words),
			stop: () => this.stops(of),
			close: () => this.closes(of),
			context: (detail) => this.asks(of, detail)
		};
	}

	/**
	 * Ask the agent what is in its window. The answer reaches the page as its
	 * own event rather than coming back here, because the agent says it on the
	 * channel it says everything else on — and where it does not answer at all,
	 * it is asked in words instead.
	 */
	private async asks(of: string, detail: 'summary' | 'full'): Promise<void> {
		const session = this.held.get(of);
		if (!session || session.gone) return;
		if (session.answersAsks === false) {
			await this.asksInWords(session);
			return;
		}
		session.waitsNoLonger();
		const id = ulid();
		session.asking = {
			id,
			waited: setTimeout(() => {
				if (this.held.get(of) !== session || session.asking?.id !== id) return;
				session.waitsNoLonger();
				session.answersAsks = false;
				void this.asksInWords(session);
			}, ANSWERS_WITHIN)
		};
		await this.call<void>(SAY, {
			thread: of,
			line: JSON.stringify(aboutTheWindow(id, detail))
		}).catch(() => {
			session.waitsNoLonger();
		});
	}

	private async says(of: string, asked: string): Promise<void> {
		const session = this.standing(of);
		if (session.turn) throw refuse(ANSWERING);
		const asking = asked.trim();
		if (asking === '') throw refuse(SAY_SOMETHING);
		if (asking.length > CHAT_ASKED_MAX) throw refuse(TOO_MUCH);
		if (session.opening?.resume && !session.introduced) {
			await session.ready.done;
			if (this.held.get(of) !== session) throw refuse(NO_CHAT);
			if (session.turn) throw refuse(ANSWERING);
		}
		session.stream.turned();
		const turn: Turn = { stopped: false, ...settling() };
		session.turn = turn;
		await this.call<void>(SAY, { thread: of, line: JSON.stringify(aTurn(asking)) }).catch(
			(reason) => {
				if (session.turn === turn) session.turn = undefined;
				turn.ends();
				throw refuse(said(reason));
			}
		);
	}

	private async stops(of: string): Promise<void> {
		const session = this.held.get(of);
		const turn = session?.turn;
		if (!session || !turn) return;
		turn.stopped = true;
		await this.call<void>(SAY, { thread: of, line: JSON.stringify(anInterrupt()) }).catch(() => {
			session.ends();
		});
		await turn.done;
	}

	private async closes(of: string): Promise<void> {
		const session = this.held.get(of);
		if (!session) return;
		this.held.delete(of);
		await this.call<void>(CLOSE, { thread: of }).catch(() => session.letGo());
		await session.over.done;
	}

	/** Start the agent and read what it says into `session`. */
	private async starts(session: Session, opening: Opening): Promise<void> {
		session.opening = opening;
		const told = this.telling();
		told.onmessage = (one) => this.told(session, one);
		await this.call<void>(OPEN, { asked: opening, heard: told });
	}

	/** Let go of the session that stood for this thread, so that a page waiting
	 *  on its end is not left waiting on a program this one is about to replace.
	 *  Every other thread's stands. */
	private replaces(of: string): void {
		const standing = this.held.get(of);
		this.held.delete(of);
		standing?.letGo();
	}

	private told(session: Session, one: Told): void {
		if (session.gone) return;
		switch (one.from) {
			case 'said': {
				const heard = session.stream.read(one.line);
				if (heard.answered !== undefined && heard.answered === session.asking?.id) {
					session.waitsNoLonger();
					session.answersAsks = heard.refused !== true;
					if (heard.refused) void this.asksInWords(session);
				}
				for (const event of heard.events) {
					// What the agent writes while answering a question nobody typed
					// belongs to the chart and not to the thread.
					if (session.reading && event.event === 'block') continue;
					if (event.event === 'started') {
						session.introduced = true;
						session.ready.ends();
						void this.asks(session.thread, 'summary');
					}
					session.tell(event);
				}
				// Results arrive in the order the turns did, so the first after the
				// agent was asked in words is that ask's and ends nothing of the
				// person's.
				if (!heard.ended) return;
				if (session.reading) session.reading = false;
				else if (session.turn) {
					session.ends(heard.spent);
					void this.asks(session.thread, 'summary');
				}
				return;
			}
			case 'called':
				void this.does(session, one);
				return;
			case 'over':
				if (this.opensAsItsOwn(session)) return;
				session.letGo(one.trouble ?? undefined);
				return;
		}
	}

	/**
	 * A conversation the agent would not pick up: the program ended before it
	 * said anything about itself. The chat opens again as a conversation of its
	 * OWN, and the page is told by the `started` that follows — which names one
	 * it did not ask for, and is what has it go on from a summary instead.
	 */
	private opensAsItsOwn(session: Session): boolean {
		const opening = session.opening;
		if (
			opening === undefined ||
			!opening.resume ||
			session.introduced ||
			this.held.get(session.thread) !== session ||
			session.gone
		)
			return false;
		session.startsOver();
		const again: Opening = { ...opening, resume: false };
		delete again.session;
		void this.starts(session, again).catch((reason) => {
			session.letGo(said(reason));
		});
		return true;
	}

	/** Ask what is in the window in words, for an agent that does not answer it
	 *  any other way. Nothing is asked while the agent is answering somebody:
	 *  the next turn to end asks again. */
	private async asksInWords(session: Session): Promise<void> {
		if (
			this.held.get(session.thread) !== session ||
			session.gone ||
			session.turn ||
			session.reading
		)
			return;
		session.reading = true;
		session.stream.turned();
		await this.call<void>(SAY, {
			thread: session.thread,
			line: JSON.stringify(aTurn(THE_WINDOW_IN_WORDS))
		}).catch(() => {
			session.reading = false;
		});
	}

	/**
	 * One of Sloppy's own acts, from the call arriving to the agent being told
	 * what it came to. A call whose arguments the act's own shape refuses is
	 * never served; the agent is told what it was refused for so that it can
	 * call again. **A writing act is served like a reading one** — it lands in
	 * the draft, which is what a person reads before any of it reaches theirs.
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
			whatHappened.put(
				'trouble',
				`${doingIn(one.act)} was refused before it ran: ${refused}`,
				one.call
			);
			await this.answers(session, one.call, { said: refused, trouble: true });
			return;
		}
		try {
			await this.answers(session, one.call, await session.serve(held.data));
		} catch {
			// An act says what it could not do in its own answer, so nothing
			// thrown past that has words the agent could act on.
			await this.answers(session, one.call, { said: DIDNT_ANSWER, trouble: true });
		}
	}

	/** What the act answered, held to its shape on the way out to the agent. */
	private async answers(session: Session, call: string, answer: ChatToolAnswer): Promise<void> {
		const held = ChatToolAnswerSchema.safeParse(answer);
		const said = held.success
			? held.data
			: { said: held.error.issues[0]?.message ?? DIDNT_ANSWER, trouble: true };
		await this.call<void>(ANSWER, {
			thread: session.thread,
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

	private standing(of: string): Session {
		const session = this.held.get(of);
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
			throw refuse(
				chatAgentReach(asked) === 'program'
					? `${chatAgentName(asked)} is not on this computer. Install it and try again.`
					: `There is no key for ${chatAgentName(asked)} on this device. Give it one in Settings and try again.`
			);
		}
		const [first] = held;
		if (first === undefined) throw refuse(nothingToChatWith());
		return first;
	}
}

/** The agent's own dialect, and the only lines this shell writes in it: what
 *  somebody said, an end to what it is doing now, and what is in its window —
 *  asked on its own channel, and asked in words for an agent that answers no
 *  other way. */
function aTurn(said: string): unknown {
	return { type: 'user', message: { role: 'user', content: [{ type: 'text', text: said }] } };
}

function anInterrupt(): unknown {
	return { type: 'control_request', request_id: ulid(), request: { subtype: 'interrupt' } };
}

function aboutTheWindow(id: string, detail: 'summary' | 'full'): unknown {
	return {
		type: 'control_request',
		request_id: id,
		request: {
			subtype: 'get_context_usage',
			...(detail === 'summary' ? { detail } : {})
		}
	};
}

const THE_WINDOW_IN_WORDS = '/context';

/** `here` is the folder holding the code the notes are about, and `drafts` is
 *  where the copy of it the agent is started in comes from. */
export function tauriChat(
	here: () => Promise<string | undefined>,
	drafts?: DraftAccess,
	call: Invoke = invoke,
	telling: () => Telling = () => new Channel<Told>(),
	keys?: AiKeysAccess
): ChatAccess {
	return new TauriChat(here, drafts, call, telling, keys);
}
