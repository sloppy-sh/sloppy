/**
 * What a chat's tool calls read as in the thread — the act, what it is about,
 * and what it came to. A call is composed by a program reading somebody's
 * checked-out tree, so nothing is drawn here that has not been read against
 * the act's own shape first.
 */

import {
	CHAT_BLOCK_KINDS,
	CHAT_TOOL_SPECS,
	type ChatBlock,
	type ChatBlockKind,
	type ChatCallId,
	type ChatToolCall,
	ChatToolCallSchema,
	type ChatToolName,
	type ChatTurn,
	ListedNoteSchema,
	NotesFoundSchema,
	NotesListedSchema,
	NoteWrittenSchema,
	type OwnedRef,
	type ToolCallBlock
} from '@sloppy/types';
import type { NoteLanding } from './pages/page-state.js';

/** Past this a line in the thread is something to scroll rather than read. */
const SHOWN_MAX = 120;

/** One of Sloppy's own acts as a surface reads it. `null` is a call that does
 *  not fit the act it names, which is drawn by its act alone. */
export function readCall(call: ChatCallId, act: ChatToolName, args: unknown): ChatToolCall | null {
	const read = ChatToolCallSchema.safeParse({ call, act, arguments: args ?? {} });
	return read.success ? read.data : null;
}

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
			return { doing, note: held.arguments.note };
		case 'write_note':
			return { doing, subject: held.arguments.about };
		case 'tag_note': {
			// What comes OFF is said in the question the person answers, not here.
			const subject = (held.arguments.tags ?? []).join(', ');
			return { doing, ...(subject === '' ? {} : { subject }), note: held.arguments.note };
		}
	}
}

/** What one call came to, as the thread says it. */
export interface ToolOutcome {
	/** Absent where the line above it already says everything. */
	said?: string;
	/** Whether the agent was told this came to nothing it asked for. */
	trouble?: boolean;
	/** The note it left, for a surface offering to open one. */
	note?: OwnedRef;
	/** Where in that note to open. */
	landing?: NoteLanding;
}

export function toolOutcome(
	act: ChatToolName | undefined,
	result: { said: string; trouble?: boolean }
): ToolOutcome {
	if (result.trouble === true) return { said: shortly(result.said), trouble: true };
	switch (act) {
		case undefined:
			return { said: shortly(result.said) };
		case 'list_notes':
			return { said: notesRead(result.said) };
		case 'search_notes':
			return { said: notesFound(result.said) };
		case 'read_note':
		case 'move_note':
		case 'tag_note': {
			const note = noteIn(result.said);
			return note === undefined ? {} : { note };
		}
		case 'write_note': {
			const written = read(result.said, NoteWrittenSchema);
			if (!written) return {};
			return written.done === 'offered'
				? { said: 'A change is offered on it.', note: written.note, landing: 'offers' }
				: { said: 'Written.', note: written.note };
		}
	}
}

function notesRead(said: string): string {
	const listed = read(said, NotesListedSchema);
	if (!listed) return '';
	if (listed.notes.length === 0) return 'Nothing written here yet.';
	const held = listed.notes.length === 1 ? '1 note' : `${listed.notes.length} notes`;
	return listed.more === undefined ? held : `${held}, and more`;
}

function notesFound(said: string): string {
	const found = read(said, NotesFoundSchema);
	if (!found) return '';
	if (found.found.length === 0) return 'Nothing here says that.';
	const held = found.found.length === 1 ? '1 note' : `${found.found.length} notes`;
	return found.more === undefined ? held : `${held}, and more`;
}

function noteIn(said: string): OwnedRef | undefined {
	return read(said, ListedNoteSchema)?.note;
}

/** What this file needs of a shape, so nothing here holds zod itself. */
interface Reads<T> {
	safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function read<T>(said: string, shape: Reads<T>): T | undefined {
	try {
		const held = shape.safeParse(JSON.parse(said));
		return held.success ? held.data : undefined;
	} catch {
		return undefined;
	}
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
