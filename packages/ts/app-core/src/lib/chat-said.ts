/**
 * What a chat's tool calls read as in the thread — the act, what it is about,
 * and what it came to. A call is composed by a program reading somebody's
 * checked-out tree, so nothing is drawn here that has not been read against
 * the act's own shape first.
 */

import {
	CHAT_BLOCK_KINDS,
	CHAT_TOOL_SPECS,
	type ChatActDone,
	type ChatBlock,
	type ChatBlockKind,
	type ChatCallId,
	type ChatCard,
	type ChatSpend,
	type ChatToolCall,
	ChatToolCallSchema,
	type ChatToolName,
	type ChatTurn,
	type OwnedRef,
	type ToolCallBlock
} from '@sloppy/types';

/** Past this a line in the thread is something to scroll rather than read. */
const SHOWN_MAX = 120;

/** One of Sloppy's own acts as a surface reads it. `null` is a call that does
 *  not fit the act it names, which is drawn by its act alone. */
export function readCall(call: ChatCallId, act: ChatToolName, args: unknown): ChatToolCall | null {
	const read = ChatToolCallSchema.safeParse({ call, act, arguments: args ?? {} });
	return read.success ? read.data : null;
}

/** A note as somebody cites it, where the surface asking has seen it: the
 *  address they navigate by and what it is called. */
export type NameOf = (note: OwnedRef) => string | undefined;

/** What one block of a turn is drawn as. A kind this build has no row for is
 *  carried by the shapes and drawn by nobody, which is what keeps the set of
 *  blocks open. */
export type ThreadRow =
	| { kind: 'said'; key: string; said: string }
	| { kind: 'thinking'; key: string; said: string }
	| { kind: 'call'; key: string; call: ToolCallBlock; answer?: ToolAnswer }
	| { kind: 'answer'; key: string; answer: ToolAnswer };

/** What a call came to, as the thread was told it. */
export interface ToolAnswer {
	said: string;
	trouble?: boolean;
}

/** One turn as rows to draw, each answer folded into the call it answers. */
export function threadRows(turn: ChatTurn): ThreadRow[] {
	const rows: ThreadRow[] = [];
	for (const [at, block] of turn.blocks.entries()) {
		const key = String(at);
		const known = knownBlock(block);
		if (!known) continue;
		switch (known.kind) {
			case 'said':
			case 'thinking':
				rows.push({ kind: known.kind, key, said: known.said });
				break;
			case 'tool_call':
				rows.push({ kind: 'call', key, call: known });
				break;
			case 'tool_result': {
				const answer: ToolAnswer = {
					said: known.said,
					...(known.trouble === undefined ? {} : { trouble: known.trouble })
				};
				const asked = callRow(rows, known.call);
				if (asked) asked.answer = answer;
				else rows.push({ kind: 'answer', key, answer });
				break;
			}
		}
	}
	return rows;
}

/** A block of a kind this build draws. The shapes cannot narrow to one: the
 *  arm carrying an unknown kind is a loose object, and what keeps it off the
 *  kinds below is a refinement rather than the type. */
type KnownBlock = Extract<ChatBlock, { kind: ChatBlockKind }>;

function knownBlock(block: ChatBlock): KnownBlock | undefined {
	return (CHAT_BLOCK_KINDS as readonly string[]).includes(block.kind)
		? (block as KnownBlock)
		: undefined;
}

/** What a person said in one of their turns, which is the whole of what one
 *  carries. */
export function saidIn(rows: readonly ThreadRow[]): string {
	return rows.flatMap((row) => (row.kind === 'said' ? [row.said] : [])).join('\n');
}

function callRow(
	rows: readonly ThreadRow[],
	call: ChatCallId
): (ThreadRow & { kind: 'call' }) | undefined {
	for (let at = rows.length - 1; at >= 0; at -= 1) {
		const row = rows[at];
		if (row.kind === 'call' && row.call.call === call) return row;
	}
	return undefined;
}

/** One tool call as a line: what is being done, and what to. */
export interface ToolLine {
	doing: string;
	/** Absent where the call names nothing a person would recognise. */
	subject?: string;
	/** The note it is about, for a surface that reads a title off one. */
	note?: OwnedRef;
}

export function toolLine(block: ToolCallBlock): ToolLine {
	if (block.act === undefined) {
		const subject = firstString(block.arguments);
		return { doing: block.tool, ...(subject === undefined ? {} : { subject }) };
	}
	const doing = CHAT_TOOL_SPECS[block.act].label;
	const held = readCall(block.call, block.act, block.arguments);
	if (!held) return { doing };
	switch (held.act) {
		case 'list_notes':
			return { doing };
		case 'search_notes':
			return { doing, subject: held.arguments.words };
		case 'read_note':
		case 'move_note':
		case 'link_notes':
		case 'style_edge':
		case 'style_note':
		case 'delete_note':
			return { doing, note: held.arguments.note };
		case 'write_note':
			return { doing, subject: held.arguments.about };
		case 'number_note': {
			const subject = held.arguments.address;
			return { doing, ...(subject === undefined ? {} : { subject }), note: held.arguments.note };
		}
		case 'tag_note': {
			// What comes OFF is said in the question the person answers, not here.
			const subject = (held.arguments.tags ?? []).join(', ');
			return { doing, ...(subject === '' ? {} : { subject }), note: held.arguments.note };
		}
	}
}

/** What one call came to, as the thread draws it. */
export interface CallOutcome {
	said?: string;
	trouble?: boolean;
	card?: ChatCard;
}

/** What an act that came to nothing says where it laid out no words of its
 *  own for the person. */
const DIDNT_HAPPEN = 'That did not happen.';

/** What one of Sloppy's own acts came to, for the person. */
export function actOutcome(done: ChatActDone): CallOutcome {
	const said = done.told ?? (done.trouble === true ? DIDNT_HAPPEN : undefined);
	return {
		...(said === undefined ? {} : { said }),
		...(done.trouble === undefined ? {} : { trouble: done.trouble }),
		...(done.card === undefined ? {} : { card: done.card })
	};
}

/**
 * What one call came to, in the words a person reads. Sloppy's own acts answer
 * the AGENT in machine text and the person in `ChatActDone`, so a row for one
 * draws what the act laid out and never what was handed back. A tool of the
 * agent's own has nothing but its own writing, cut to a line.
 */
export function callOutcome(
	call: ToolCallBlock,
	answer: ToolAnswer | undefined,
	done: ChatActDone | undefined
): CallOutcome {
	if (done) return actOutcome(done);
	if (call.act !== undefined) {
		return answer?.trouble === true ? { said: DIDNT_HAPPEN, trouble: true } : {};
	}
	if (!answer) return {};
	return {
		said: shortly(answer.said),
		...(answer.trouble === undefined ? {} : { trouble: answer.trouble })
	};
}

/** The first string a call carries, which is what a tool of the agent's own is
 *  about often enough to be worth showing and never worth guessing past. */
function firstString(args: unknown): string | undefined {
	if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined;
	for (const held of Object.values(args as Record<string, unknown>)) {
		if (typeof held === 'string' && held.trim() !== '') return shortly(held);
	}
	return undefined;
}

function shortly(said: string): string {
	const line = said.split('\n')[0].trim();
	return line.length > SHOWN_MAX ? `${line.slice(0, SHOWN_MAX - 1)}…` : line;
}

/** Tokens as somebody reads them: `812`, `12.4k`, `1.2M`. */
export function tokensSaid(count: number): string {
	if (count < 1000) return String(count);
	const short = (value: number, unit: string) =>
		`${value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, '')}${unit}`;
	return count < 1_000_000 ? short(count / 1000, 'k') : short(count / 1_000_000, 'M');
}

/** What the chat has spent, in one quiet line: the turn, the conversation,
 *  and the cost only where the agent says one. */
export function spentSaid(spent: { turn?: ChatSpend; session?: ChatSpend }): string {
	const parts: string[] = [];
	if (spent.turn) parts.push(`${tokensSaid(spent.turn.sent + spent.turn.answered)} this turn`);
	if (spent.session)
		parts.push(`${tokensSaid(spent.session.sent + spent.session.answered)} in this chat`);
	const cost = spent.session?.cost ?? spent.turn?.cost;
	if (cost !== undefined) parts.push(cost > 0 && cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`);
	return parts.join(' · ');
}

/** How much of an earlier conversation is carried to an agent that was not
 *  there for it, in characters. The most recent is what matters, so the head
 *  goes first. */
export const CARRIED_MAX = 24_000;

/**
 * What was said so far, for an agent taking over the conversation: each turn
 * as who said it and what, the agent's tool calls as one line each. Bounded to
 * {@link CARRIED_MAX} from the end. Empty where nothing was said.
 */
export function carriedOver(turns: readonly ChatTurn[]): string {
	const lines = turns.flatMap((turn) => {
		const rows = threadRows(turn);
		const said = rows.flatMap((row) => {
			if (row.kind === 'said') return [row.said];
			if (row.kind === 'call') {
				const line = toolLine(row.call);
				return [`(${line.doing}${line.subject === undefined ? '' : ` ${line.subject}`})`];
			}
			return [];
		});
		if (said.length === 0) return [];
		return [`${turn.from === 'person' ? 'Person' : 'Assistant'}: ${said.join('\n')}`];
	});
	const whole = lines.join('\n\n');
	return whole.length <= CARRIED_MAX ? whole : `…${whole.slice(-CARRIED_MAX)}`;
}

/** What a person's words become where an earlier conversation is carried
 *  into a new session with them. */
export function withCarried(carried: string, said: string): string {
	if (carried === '') return said;
	return `Earlier in this conversation, answered by another assistant:\n\n${carried}\n\n---\n\n${said}`;
}
