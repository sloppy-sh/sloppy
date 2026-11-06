// One run as a reader downloads it: the record, what it was sent, its transcript where one was
// kept, and its grades, read from bench/results at build. bench/README.md § "What a run was sent,
// and what it did" is the layout read here. Only the runs the summary shows are read, and never a
// private subject's.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { HIDDEN, unnamed } from './private';
import { loadSummary } from './summary';

/** The builds run from this package's folder. */
const RESULTS = resolve(process.cwd(), '../../../bench/results');

/** A system prompt longer than this is served once on its own and named by the runs that were sent it. */
const INLINE_SYSTEM = 20_000;

type Json = Record<string, unknown>;

const readJsonl = (dir: string): Json[] =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => f.endsWith('.jsonl'))
				.sort()
				.flatMap((f) =>
					readFileSync(join(dir, f), 'utf8')
						.split('\n')
						.filter((l) => l.trim())
						.map((l) => JSON.parse(l) as Json)
				)
		: [];

/** The runs the summary's curves link to. */
const shownRuns = () =>
	new Set(loadSummary(true).summary.curves.flatMap((c) => c.points.map((p) => p.run_id)));

let cache: { records: Map<string, Json>; grades: Json[] } | undefined;
function load() {
	if (cache) return cache;
	const shown = shownRuns();
	return (cache = {
		records: new Map(
			readJsonl(RESULTS)
				.filter(
					(r) =>
						shown.has(r.run_id as string) &&
						!HIDDEN.has((r.subject as { name?: string }).name ?? '')
				)
				.map((r) => [r.run_id as string, r])
		),
		grades: readJsonl(join(RESULTS, 'grades'))
	});
}

export const runIds = () => [...load().records.keys()];

export const recordOf = (runId: string) => load().records.get(runId);

export const gradesOf = (runId: string) => load().grades.filter((g) => g.run_id === runId);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function sentOf(record: Json): { sent: Json; system: string } | undefined {
	if (record.sent) {
		const { system, ...rest } = record.sent as Json & { system: string };
		return { sent: { ...rest, reconstructed: false }, system: unnamed(system) };
	}
	const file = join(RESULTS, 'prompts', `${record.run_id}.json`);
	if (!existsSync(file)) return undefined;
	const kept = JSON.parse(readFileSync(file, 'utf8')) as { sent: Json; from: Json };
	const { system_file, ...rest } = kept.sent as Json & { system_file: string };
	const system = unnamed(
		gunzipSync(readFileSync(join(RESULTS, 'prompts', system_file))).toString('utf8')
	);
	return { sent: { ...rest, reconstructed: true, from: kept.from }, system };
}

let long: Map<string, string> | undefined;

/** Every system prompt too long to carry inline, by its sha256. */
export function longSystems(): Map<string, string> {
	if (long) return long;
	const out = (long = new Map<string, string>());
	for (const record of load().records.values()) {
		const got = sentOf(record);
		if (got && got.system.length > INLINE_SYSTEM) out.set(sha256(got.system), got.system);
	}
	return out;
}

function transcriptOf(runId: string): unknown[] | null {
	const file = join(RESULTS, 'transcripts', `${runId}.jsonl.gz`);
	if (!existsSync(file)) return null;
	return gunzipSync(readFileSync(file))
		.toString('utf8')
		.split('\n')
		.filter((l) => l.trim())
		.map((l) => JSON.parse(l));
}

export function runBundle(runId: string): Json | undefined {
	const { records, grades } = load();
	const record = records.get(runId);
	if (!record) return undefined;
	const rest = { ...record };
	delete rest.sent;
	const got = sentOf(record);
	const sent = got
		? got.system.length > INLINE_SYSTEM
			? {
					...got.sent,
					system_chars: got.system.length,
					system_url: `/runs/systems/${sha256(got.system)}.txt`
				}
			: { ...got.sent, system: got.system }
		: null;
	const transcript = transcriptOf(runId);
	const bundle = {
		run_id: runId,
		record: rest,
		sent,
		answer: (record.output as Json | undefined)?.text ?? '',
		grades: grades.filter((g) => g.run_id === runId),
		transcript,
		...(transcript ? {} : { transcript_note: 'This run was made before transcripts were kept.' })
	};
	return JSON.parse(unnamed(JSON.stringify(bundle))) as Json;
}
