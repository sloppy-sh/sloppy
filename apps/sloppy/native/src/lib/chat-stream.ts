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
	ChatBlockSchema,
	MAX_BLOCKS_PER_TURN,
	MAX_TOOLS_LISTED,
	argumentsFit,
	type ChatBlock,
	type ChatEvent,
	type ChatToolName
} from '@sloppy/types';

/** What one line came to. `ended` is the line that ends the turn underway;
 *  whether somebody STOPPED it is the seam's to say, so the `ended` event is
 *  composed there. */
export interface Heard {
	events: ChatEvent[];
	ended: boolean;
}

const NOTHING: Heard = { events: [], ended: false };

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

	/** A turn begins, and its blocks stand from 0 again. */
	turned(): void {
		this.placed = 0;
		this.messages.clear();
		this.results.clear();
		this.growing.clear();
		this.underway = undefined;
	}

	read(line: string): Heard {
		const held = parsed(line);
		switch (field(held, 'type')) {
			case 'system':
				return field(held, 'subtype') === 'init'
					? { events: started(held), ended: false }
					: NOTHING;
			case 'stream_event':
				return { events: this.grew(field(held, 'event')), ended: false };
			case 'assistant':
				return { events: this.settled(field(held, 'message')), ended: false };
			case 'user':
				return { events: this.answered(field(held, 'message')), ended: false };
			case 'result':
				return { events: [], ended: true };
			default:
				return NOTHING;
		}
	}

	/** A block as it arrives, which is what draws writing appearing. */
	private grew(event: unknown): ChatEvent[] {
		switch (field(event, 'type')) {
			case 'message_start': {
				const message = { base: this.placed, settled: 0 };
				const id = text(field(field(event, 'message'), 'id'), CHAT_ID_MAX);
				if (id !== undefined) this.messages.set(id, message);
				this.underway = message;
				return [];
			}
			case 'content_block_start': {
				const at = this.place(field(event, 'index'));
				if (at === undefined) return [];
				const opening = field(event, 'content_block');
				const kind = growingKind(field(opening, 'type'));
				if (kind !== undefined) this.growing.set(at, { kind, said: '' });
				return this.block(at, spoken(opening));
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
			events.push(...this.block(at, spoken(one)));
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
			events.push(
				...this.block(at, {
					kind: 'tool_result',
					call,
					said: cut(saidIn(field(one, 'content')), CHAT_SHOWN_MAX),
					...(field(one, 'is_error') === true ? { trouble: true } : {})
				})
			);
		}
		return events;
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
