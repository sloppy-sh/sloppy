/**
 * What a line the agent writes out MEANS — the one place in this shell that
 * knows an agent's dialect, so another costs nothing above this file
 * (docs/ARCHITECTURE.md § "Asking a tool to write the notes").
 *
 * **Nothing here refuses a line.** An event kind, a block kind or a field this
 * build knows nothing about is carried or passed over, and a line that is not
 * JSON at all says nothing — an agent that grows a dialect must not end a chat.
 */

import {
	CHAT_ID_MAX,
	CHAT_MODEL_MAX,
	CHAT_SAID_MAX,
	CHAT_SHOWN_MAX,
	CHAT_TOOL_NAME_MAX,
	CHAT_TOOLS,
	CONTEXT_PART_KINDS,
	CONTEXT_PART_NAME_MAX,
	ChatBlockSchema,
	MAX_BLOCKS_PER_TURN,
	MAX_TOOLS_LISTED,
	MOST_CONTEXT_PARTS,
	argumentsFit,
	type ChatBlock,
	type ChatEvent,
	type ChatSpend,
	type ChatToolName,
	type ContextPart,
	type ContextPartKind,
	type ContextUsage,
	type ToolCallBlock,
	type ToolResultBlock
} from '@sloppy/types';

/** What one line came to. `ended` is the line that ends the turn underway;
 *  whether somebody STOPPED it is the seam's to say, so the `ended` event is
 *  composed there. `spent` is what that line said the turn cost, where it said.
 *  `answered` is the ask a line answered, where it answered one, and `refused`
 *  says that answer carried no breakdown — an agent to ask in words instead. */
export interface Heard {
	events: ChatEvent[];
	ended: boolean;
	spent?: ChatSpend;
	answered?: string;
	refused?: true;
}

const NOTHING: Heard = { events: [], ended: false };

/** How far the window has to move between one breakdown and the next before
 *  the page is told again, as a share of what the window holds. Under it the
 *  bar would redraw on every message and read as noise. */
const MOVED_BY = 0.02;

/**
 * Which of Sloppy's own acts a call is, read off the name it arrived under.
 * That name is the agent's own spelling — it prefixes what the endpoint
 * advertised with whatever it calls the endpoint — so the act is what the name
 * ends at. Nothing else is one of ours.
 */
function actIn(tool: string): ChatToolName | undefined {
	return CHAT_TOOLS.find((act) => tool === act || tool.endsWith(`__${act}`));
}

/** Where one of the agent's messages stands in the turn. */
interface Message {
	/** The place its first block takes. */
	base: number;
	/** How many of its blocks have settled, which is the one the next settled
	 *  block is. They settle in the order they were started. */
	settled: number;
}

/** What a block that is still arriving holds so far. */
interface Growing {
	kind: 'said' | 'thinking';
	said: string;
}

/**
 * The agent's stream, read one line at a time. It holds where the blocks of the
 * turn underway stand, so that a block arriving again arrives at the place it
 * already has and the page draws it growing rather than twice.
 */
export class AgentStream {
	/** How many places the turn underway has handed out. */
	private placed = 0;
	private messages = new Map<string, Message>();
	private underway?: Message;
	/** Where a call's answer stands, by the call it answers. */
	private results = new Map<string, number>();
	private growing = new Map<number, Growing>();
	/** When each call was made, by call: the clock for how long it took. */
	private called = new Map<string, { at: string; ms: number }>();
	/** Tokens the agent wrote in its last whole message, which stand between
	 *  that message's window and the next one's with the answers in between. */
	private lastAnswered = 0;
	/** Answers whose cost is not yet known: the agent's next request says it. */
	private pending: {
		at: number;
		block: ToolResultBlock;
		before: number;
		answered: number;
	}[] = [];
	/** What the window holds, which only the agent says — nothing here guesses
	 *  one, so until it has said, no count is drawn. */
	private limit?: number;
	/** What the agent's last request carried, which is the window as of now. */
	private live = 0;
	/** The count the page was last told, so the bar redraws on a real move. */
	private told?: number;
	/** Where the agent says it will make room, kept across the counts that
	 *  carry no breakdown. */
	private compactsAt?: number;
	/** What the agent is answering as, for reading the window it answers in. */
	private model?: string;

	/** A turn begins, and its blocks stand from 0 again. */
	turned(): void {
		this.placed = 0;
		this.messages.clear();
		this.results.clear();
		this.growing.clear();
		this.called.clear();
		this.pending = [];
		this.underway = undefined;
	}

	read(line: string): Heard {
		const held = parsed(line);
		switch (field(held, 'type')) {
			case 'system':
				return this.aboutItself(held);
			case 'stream_event':
				return { events: this.grew(field(held, 'event')), ended: false };
			case 'assistant': {
				const message = field(held, 'message');
				this.model = text(field(message, 'model'), CHAT_MODEL_MAX) ?? this.model;
				return {
					events: [
						...this.settled(message),
						...this.saidInWords(field(held, 'context_usage')),
						...this.filled(field(message, 'usage'), true)
					],
					ended: false
				};
			}
			case 'user':
				return { events: this.answered(field(held, 'message')), ended: false };
			case 'control_response':
				return this.askedFor(field(held, 'response'));
			case 'result': {
				this.windowIn(held);
				const spent = spentIn(held);
				return { events: [], ended: true, ...(spent === undefined ? {} : { spent }) };
			}
			default:
				return NOTHING;
		}
	}

	/** What the agent says about itself rather than about the turn. */
	private aboutItself(held: unknown): Heard {
		switch (field(held, 'subtype')) {
			case 'init':
				this.model = text(field(held, 'model'), CHAT_MODEL_MAX) ?? this.model;
				return { events: started(held), ended: false };
			case 'compact_boundary':
				return { events: this.madeRoom(held), ended: false };
			default:
				return NOTHING;
		}
	}

	/**
	 * What the agent answered the ask on its own channel with. An answer this
	 * cannot read a breakdown out of is `refused`, which is what has the agent
	 * asked in words instead — a refusal in so many words, and a success with
	 * nothing countable in it, cost the same nothing and are worth the same
	 * second try.
	 */
	private askedFor(response: unknown): Heard {
		const answered = text(field(response, 'request_id'), CHAT_ID_MAX);
		const asked = answered === undefined ? {} : { answered };
		const events = this.breakdownIn(field(response, 'response'));
		return events === undefined
			? { events: [], ended: false, ...asked, refused: true }
			: { events, ended: false, ...asked };
	}

	/**
	 * The breakdown the agent was asked for, which is the one line that says
	 * what each part of the window is holding. `undefined` is an answer with no
	 * breakdown in it.
	 *
	 * A part's `kind` is the agent's own and is kept as it arrived; one spelled
	 * in a way this build knows nothing about counts as being IN the window,
	 * where a part nobody can classify does the least harm — it is drawn and
	 * counted rather than silently left out of a total.
	 */
	private breakdownIn(inside: unknown): ChatEvent[] | undefined {
		const categories = field(inside, 'categories');
		if (!Array.isArray(categories)) return undefined;
		const limit = count(field(inside, 'rawMaxTokens')) ?? count(field(inside, 'maxTokens'));
		if (limit !== undefined && limit >= 1) this.limit = limit;
		if (this.limit === undefined) return undefined;
		this.live = count(field(inside, 'totalTokens')) ?? this.live;
		this.compactsAt =
			field(inside, 'isAutoCompactEnabled') === false
				? undefined
				: (count(field(inside, 'autoCompactThreshold')) ?? this.compactsAt);
		return this.counts(categories.flatMap(partIn));
	}

	/**
	 * The same breakdown where the agent was asked in words instead, which it
	 * answers beside its message rather than inside it, and in its other
	 * spelling. Read by its own code, so that neither spelling has to bend to
	 * the other.
	 *
	 * This spelling says nothing about where the agent will make room, so where
	 * it will is left as the last answer that did say put it.
	 */
	private saidInWords(said: unknown): ChatEvent[] {
		const categories = field(said, 'categories');
		if (!Array.isArray(categories)) return [];
		const limit = count(field(said, 'raw_max_tokens'));
		if (limit !== undefined && limit >= 1) this.limit = limit;
		if (this.limit === undefined) return [];
		this.live = count(field(said, 'total_tokens')) ?? this.live;
		return this.counts(categories.flatMap(partIn));
	}

	/** The window as the agent's own request carried it, which is what it holds
	 *  going into that answer. `whole` is a message that has finished, whose
	 *  output count is final. */
	private filled(usage: unknown, whole = false): ChatEvent[] {
		const sent = count(field(usage, 'input_tokens'));
		if (sent === undefined) return [];
		this.live =
			sent +
			(count(field(usage, 'cache_read_input_tokens')) ?? 0) +
			(count(field(usage, 'cache_creation_input_tokens')) ?? 0);
		const measured = this.measured(this.live);
		if (whole) this.lastAnswered = count(field(usage, 'output_tokens')) ?? this.lastAnswered;
		return [...measured, ...this.moved()];
	}

	/** What the answers waiting to be costed added to the window: what the
	 *  agent's next request carries, less what it held going into the message
	 *  that asked and what that message wrote. Shared evenly among them. */
	private measured(after: number): ChatEvent[] {
		const waiting = this.pending;
		if (waiting.length === 0) return [];
		this.pending = [];
		const first = waiting[0];
		const gap = Math.max(0, after - first.before - first.answered);
		const each = Math.floor(gap / waiting.length);
		return waiting.flatMap((one, index) =>
			this.block(one.at, {
				...one.block,
				tokens: each + (index === 0 ? gap - each * waiting.length : 0)
			})
		);
	}

	/** The window after the agent made room for itself. What it held before is
	 *  the count that goes with it; the parts are left behind, because every
	 *  one of them was counted against what is no longer there. */
	private madeRoom(held: unknown): ChatEvent[] {
		const about = field(held, 'compact_metadata');
		this.live = count(field(about, 'post_tokens')) ?? count(field(held, 'post_tokens')) ?? 0;
		return this.counts([], { from: count(field(about, 'pre_tokens')) ?? this.told ?? 0 });
	}

	/** How much the window holds, as the line ending a turn says it for the
	 *  model that answered — and the widest it names where it does not say for
	 *  that one. */
	private windowIn(result: unknown): void {
		const byModel = field(result, 'modelUsage');
		if (typeof byModel !== 'object' || byModel === null) return;
		const held = byModel as Record<string, unknown>;
		const mine =
			this.model === undefined ? undefined : count(field(held[this.model], 'contextWindow'));
		const widest = Math.max(
			0,
			...Object.values(held).map((one) => count(field(one, 'contextWindow')) ?? 0)
		);
		const limit = mine ?? widest;
		if (limit >= 1) this.limit = limit;
	}

	/** The window as of now, where it has moved far enough to be worth
	 *  redrawing. */
	private moved(): ChatEvent[] {
		if (this.limit === undefined) return [];
		if (this.told !== undefined && Math.abs(this.live - this.told) <= this.limit * MOVED_BY)
			return [];
		return this.counts([]);
	}

	private counts(parts: ContextPart[], compacted?: { from: number }): ChatEvent[] {
		if (this.limit === undefined) return [];
		this.told = this.live;
		const usage: ContextUsage = {
			total: this.live,
			limit: this.limit,
			parts: parts.slice(0, MOST_CONTEXT_PARTS),
			at: new Date().toISOString(),
			...(this.compactsAt === undefined ? {} : { compactsAt: this.compactsAt }),
			...(compacted === undefined ? {} : { compacted })
		};
		return [{ event: 'context', usage }];
	}

	/** A block as it arrives, which is what draws writing appearing. */
	private grew(event: unknown): ChatEvent[] {
		switch (field(event, 'type')) {
			case 'message_start': {
				const message = { base: this.placed, settled: 0 };
				const started = field(event, 'message');
				const id = text(field(started, 'id'), CHAT_ID_MAX);
				if (id !== undefined) this.messages.set(id, message);
				this.underway = message;
				this.model = text(field(started, 'model'), CHAT_MODEL_MAX) ?? this.model;
				return this.filled(field(started, 'usage'));
			}
			case 'content_block_start': {
				const at = this.place(field(event, 'index'));
				if (at === undefined) return [];
				const opening = field(event, 'content_block');
				const kind = growingKind(field(opening, 'type'));
				if (kind !== undefined) this.growing.set(at, { kind, said: '' });
				return this.block(at, this.stamped(spoken(opening)));
			}
			case 'content_block_delta': {
				const at = this.place(field(event, 'index'));
				const held = at === undefined ? undefined : this.growing.get(at);
				if (at === undefined || held === undefined) return [];
				const more = grown(held.kind, field(event, 'delta'));
				if (more === '') return [];
				held.said = cut(held.said + more, CHAT_SAID_MAX);
				return this.block(at, { kind: held.kind, said: held.said });
			}
			default:
				return [];
		}
	}

	/** The blocks of one of the agent's messages, whole. They arrive as each
	 *  finishes rather than all at once, so each takes the next place that
	 *  message has not settled. */
	private settled(message: unknown): ChatEvent[] {
		const content = field(message, 'content');
		if (!Array.isArray(content)) return [];
		const held = this.messageOf(text(field(message, 'id'), CHAT_ID_MAX));
		const events: ChatEvent[] = [];
		for (const one of content) {
			const at = this.taken(held.base + held.settled);
			held.settled += 1;
			this.growing.delete(at);
			events.push(...this.block(at, this.stamped(spoken(one))));
		}
		return events;
	}

	/** What the agent's own tools came to, which it is handed as a turn of the
	 *  person's and which the thread draws beside the call. */
	private answered(message: unknown): ChatEvent[] {
		const content = field(message, 'content');
		if (!Array.isArray(content)) return [];
		const events: ChatEvent[] = [];
		for (const one of content) {
			if (field(one, 'type') !== 'tool_result') continue;
			const call = text(field(one, 'tool_use_id'), CHAT_ID_MAX);
			if (call === undefined) continue;
			const at = this.results.get(call) ?? this.taken(this.placed);
			this.results.set(call, at);
			const made = this.called.get(call);
			const block: ToolResultBlock = {
				kind: 'tool_result',
				call,
				said: cut(saidIn(field(one, 'content')), CHAT_SHOWN_MAX),
				...(field(one, 'is_error') === true ? { trouble: true } : {}),
				...(made === undefined ? {} : { took: Math.max(0, Date.now() - made.ms) })
			};
			this.pending.push({ at, block, before: this.live, answered: this.lastAnswered });
			events.push(...this.block(at, block));
		}
		return events;
	}

	/** A call carries the moment it was made, the first time it is seen; a
	 *  block arriving again keeps that moment rather than the later one. */
	private stamped(block: ChatBlock | undefined): ChatBlock | undefined {
		if (block === undefined || block.kind !== 'tool_call') return block;
		const call = block as ToolCallBlock;
		const made = this.called.get(call.call) ?? { at: new Date().toISOString(), ms: Date.now() };
		this.called.set(call.call, made);
		return { ...call, at: made.at };
	}

	private messageOf(id: string | undefined): Message {
		const held = id === undefined ? this.underway : this.messages.get(id);
		if (held) return held;
		const message = { base: this.placed, settled: 0 };
		if (id !== undefined) this.messages.set(id, message);
		this.underway = message;
		return message;
	}

	private place(index: unknown): number | undefined {
		if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined;
		return this.taken((this.underway ?? this.messageOf(undefined)).base + index);
	}

	private taken(at: number): number {
		this.placed = Math.max(this.placed, at + 1);
		return at;
	}

	/** One block at its place, held to its own shape before a page sees it. */
	private block(at: number, block: ChatBlock | undefined): ChatEvent[] {
		if (block === undefined || at >= MAX_BLOCKS_PER_TURN) return [];
		const held = ChatBlockSchema.safeParse(block);
		return held.success ? [{ event: 'block', at, block: held.data }] : [];
	}
}

/**
 * What the line that ends a turn says it spent. The counts on it are the
 * turn's own; the cost is the conversation's so far, which is why it is read
 * as it is and never added to an earlier one. Nothing here is required: a
 * result that says nothing about spend is a turn nobody is told about.
 */
function spentIn(held: unknown): ChatSpend | undefined {
	const usage = field(held, 'usage');
	const sent = count(field(usage, 'input_tokens'));
	const answered = count(field(usage, 'output_tokens'));
	if (sent === undefined || answered === undefined) return undefined;
	const recalled = count(field(usage, 'cache_read_input_tokens'));
	const kept = count(field(usage, 'cache_creation_input_tokens'));
	const thought = count(field(field(usage, 'output_tokens_details'), 'thinking_tokens'));
	const cost = costIn(held);
	return {
		sent,
		answered,
		...(recalled === undefined ? {} : { recalled }),
		...(kept === undefined ? {} : { kept }),
		...(thought === undefined ? {} : { thought }),
		...(cost === undefined ? {} : { cost })
	};
}

function costIn(held: unknown): number | undefined {
	const total = field(held, 'total_cost_usd');
	if (typeof total === 'number' && Number.isFinite(total) && total >= 0) return total;
	const byModel = field(held, 'modelUsage');
	if (typeof byModel !== 'object' || byModel === null) return undefined;
	let sum = 0;
	let any = false;
	for (const one of Object.values(byModel as Record<string, unknown>)) {
		const cost = field(one, 'costUSD');
		if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) continue;
		sum += cost;
		any = true;
	}
	return any ? sum : undefined;
}

function count(held: unknown): number | undefined {
	return typeof held === 'number' && Number.isInteger(held) && held >= 0 ? held : undefined;
}

/** One part of what the agent is holding, named and counted as the agent gave
 *  it. A part missing either is one nothing can be drawn of. */
function partIn(one: unknown): ContextPart[] {
	const name = text(field(one, 'name'), CONTEXT_PART_NAME_MAX);
	const tokens = count(field(one, 'tokens'));
	if (name === undefined || tokens === undefined) return [];
	return [{ name, tokens, kind: kindOf(field(one, 'kind')) }];
}

function kindOf(held: unknown): ContextPartKind {
	return CONTEXT_PART_KINDS.includes(held as ContextPartKind) ? (held as ContextPartKind) : 'used';
}

function started(held: unknown): ChatEvent[] {
	const session = text(field(held, 'session_id'), CHAT_ID_MAX);
	if (session === undefined) return [];
	const model = text(field(held, 'model'), CHAT_MODEL_MAX);
	return [
		{
			event: 'started',
			session,
			tools: names(field(held, 'tools')),
			...(model === undefined ? {} : { model })
		}
	];
}

/** One block of an agent's message as a thread holds it. A kind this build has
 *  no renderer for is carried whole, so long as it is small enough to be. */
function spoken(one: unknown): ChatBlock | undefined {
	const kind = field(one, 'type');
	switch (kind) {
		case 'text':
			return { kind: 'said', said: cut(stringIn(field(one, 'text')), CHAT_SAID_MAX) };
		case 'thinking':
			return { kind: 'thinking', said: cut(stringIn(field(one, 'thinking')), CHAT_SAID_MAX) };
		case 'tool_use': {
			const call = text(field(one, 'id'), CHAT_ID_MAX);
			const tool = text(field(one, 'name'), CHAT_TOOL_NAME_MAX);
			if (call === undefined || tool === undefined) return undefined;
			const act = actIn(tool);
			const held = field(one, 'input');
			return {
				kind: 'tool_call',
				call,
				tool,
				...(act === undefined ? {} : { act }),
				...(held === undefined || !argumentsFit(held) ? {} : { arguments: held })
			};
		}
		default:
			return typeof kind === 'string' && carriable(one) ? { ...(one as object), kind } : undefined;
	}
}

/** Whether a block of a kind this build knows nothing about is small enough to
 *  carry. Its shape bounds nothing, being unread. */
function carriable(one: unknown): boolean {
	try {
		const encoded = JSON.stringify(one);
		return encoded !== undefined && encoded.length <= CHAT_SAID_MAX;
	} catch {
		return false;
	}
}

function growingKind(kind: unknown): Growing['kind'] | undefined {
	if (kind === 'text') return 'said';
	return kind === 'thinking' ? 'thinking' : undefined;
}

function grown(kind: Growing['kind'], delta: unknown): string {
	const said = field(delta, kind === 'said' ? 'text' : 'thinking');
	return typeof said === 'string' ? said : '';
}

/** What a call came to, as text. It arrives as words or as pieces of them, and
 *  a piece that is not words is one the thread shows nothing of. */
function saidIn(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((one) => (field(one, 'type') === 'text' ? stringIn(field(one, 'text')) : ''))
		.filter((said) => said !== '')
		.join('\n');
}

function names(held: unknown): string[] {
	if (!Array.isArray(held)) return [];
	return held
		.filter((one): one is string => typeof one === 'string' && one !== '')
		.map((one) => one.slice(0, CHAT_TOOL_NAME_MAX))
		.slice(0, MAX_TOOLS_LISTED);
}

function text(held: unknown, max: number): string | undefined {
	return typeof held === 'string' && held !== '' ? held.slice(0, max) : undefined;
}

function stringIn(held: unknown): string {
	return typeof held === 'string' ? held : '';
}

function cut(said: string, max: number): string {
	return said.length <= max ? said : said.slice(0, max);
}

function field(held: unknown, name: string): unknown {
	return typeof held === 'object' && held !== null
		? (held as Record<string, unknown>)[name]
		: undefined;
}

function parsed(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}
