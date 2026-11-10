// What an agent did on a run, as a list of steps, read from the transcript bench/README.md
// § "What a run was sent, and what it did" describes; bench/backends/claude-code.mjs parseStream is
// the reference reader.
import type { Step } from '$lib/questions/types';
import { transcriptOf } from './runs';

interface Block {
	type: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: unknown;
}
interface Event {
	type: string;
	parent_tool_use_id?: string | null;
	message?: { content?: Block[] | string };
}

const HANDLE = 40;

const short = (s: string) => {
	const line = s.replace(/\s+/g, ' ').trim();
	return line.length > HANDLE ? `${line.slice(0, HANDLE - 1)}…` : line;
};

const basename = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path;

const text = (v: unknown): string =>
	typeof v === 'string'
		? v
		: Array.isArray(v)
			? v.map(text).join(' ')
			: v && typeof v === 'object' && 'text' in v
				? text(v.text)
				: '';

/** "mcp__sloppy__find_code" reads "Sloppy · find code". */
function toolName(name: string) {
	const m = name.match(/^mcp__(.+?)__(.+)$/);
	if (!m) return name;
	const server = m[1].charAt(0).toUpperCase() + m[1].slice(1);
	return `${server} · ${m[2].replace(/_/g, ' ')}`;
}

/** A note's title from what reading it returned, where the result names one. */
function titleIn(result: string): string | undefined {
	const quoted = result.match(/"title":("(?:[^"\\]|\\.)*")/)?.[1];
	try {
		return quoted ? (JSON.parse(quoted) as string) : undefined;
	} catch {
		return undefined;
	}
}

function aboutOf(name: string, input: Record<string, unknown>, result: string): string {
	const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
	if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) {
		const path = str('file_path') ?? str('notebook_path');
		return path ? basename(path) : '';
	}
	if (name === 'Grep' || name === 'Glob') return short(str('pattern') ?? '');
	if (name === 'Bash') return short(str('command') ?? '');
	if (name === 'Task' || name === 'Agent') return short(str('description') ?? '');
	if (name.startsWith('mcp__')) {
		const handle =
			str('words') ?? str('query') ?? titleIn(result) ?? str('path') ?? str('commit') ?? str('ref');
		if (handle) return short(handle);
	}
	const first = Object.values(input).find((v): v is string => typeof v === 'string');
	return first ? short(first) : '';
}

interface Trace {
	steps: Step[];
	/** How many of `steps`, from the start, a handoff's first session made. */
	firstSession: number;
	subagentCalls: number;
}

function sessionOf(lines: { event?: Event }[]): Omit<Trace, 'firstSession'> {
	const events = lines.map((l) => l.event).filter((e): e is Event => !!e);
	const results = new Map<string, string>();
	for (const e of events)
		if (e.type === 'user' && Array.isArray(e.message?.content))
			for (const b of e.message.content)
				if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, text(b.content));

	const steps: Step[] = [];
	const seen = new Set<string>();
	let subagentCalls = 0;
	for (const e of events) {
		if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
		for (const b of e.message.content) {
			if (b.type !== 'tool_use' || !b.name) continue;
			if (b.id && seen.has(b.id)) continue;
			if (b.id) seen.add(b.id);
			if (e.parent_tool_use_id) subagentCalls++;
			else
				steps.push({
					tool: toolName(b.name),
					about: aboutOf(b.name, b.input ?? {}, results.get(b.id ?? '') ?? '')
				});
		}
	}
	return { steps, subagentCalls };
}

type Lines = { event?: Event }[] | null;

/** The agent's own tool calls in order, a handoff's first session first; null with no transcript. */
export function traceOf(runId: string): Trace | null {
	const second = transcriptOf(runId) as Lines;
	if (!second) return null;
	const firstLines = transcriptOf(`${runId}.a`) as Lines;
	const first = firstLines ? sessionOf(firstLines) : { steps: [], subagentCalls: 0 };
	const rest = sessionOf(second);
	return {
		steps: [...first.steps, ...rest.steps],
		firstSession: first.steps.length,
		subagentCalls: first.subagentCalls + rest.subagentCalls
	};
}
