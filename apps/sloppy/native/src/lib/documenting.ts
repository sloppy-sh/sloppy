/**
 * This shell's half of `DocumentingAccess` in `@sloppy/app-core`, which
 * declares every act, what its answer means, and what this side is obliged to
 * parse. The tool is started by `src-tauri/src/documenting.rs`; what it is
 * asked is `documenting-tool.ts` and what comes back lands through
 * `documenting-notes.ts`.
 */

import type { DocumentingAccess } from '@sloppy/app-core';
import type { Files } from '@sloppy/local';
import {
	DOCUMENTING_TOOLS,
	DocumentingIntentSchema,
	DocumentingPlanSchema,
	DocumentingProgressSchema,
	documentingToolName,
	MAX_PLACES_PER_RUN,
	placesAreDistinct,
	progressFits,
	ProposedPlaceSchema,
	type DocumentingIntent,
	type DocumentingPlan,
	type DocumentingProgress,
	type DocumentingTool,
	type PlaceDone,
	type ProposedPlace
} from '@sloppy/types';
import { Channel, invoke } from '@tauri-apps/api/core';
import { notePrompt, noteSaid, placesSaid, surveyPrompt } from './documenting-tool';
import {
	containerApi,
	noteAbout,
	noteAsWritten,
	notesHere,
	pathsWritten,
	standingNote,
	writeNote,
	type NoteHere
} from './documenting-notes';
import type { Invoke } from './files';

/** The commands `src-tauri` answers. */
const TOOLS = 'documenting_tools';
const ASK = 'documenting_ask';
const STOP = 'documenting_stop';

const ALREADY = 'Sloppy is already reading this project. Wait for it to finish, or stop it.';
const NO_PROJECT = 'Open the project these notes are about first.';
const UNREADABLE = 'Sloppy could not read what came back. Try again.';
const DIDNT_WORK = 'That did not work. Try again.';

/** The project a run works in: the folder holding the code, and this device's
 *  files, which the notes inside it are reached through. */
export interface ProjectHere {
	root: string;
	files: Files;
}

/** A refusal whose words are already the ones a person reads. */
class Refusal extends Error {}

function refuse(said: string): Refusal {
	return new Refusal(said);
}

/** What a person is told about a run that could not go on. */
function why(thrown: unknown): string {
	return thrown instanceof Refusal ? thrown.message : DIDNT_WORK;
}

/** A shape held to, refusing in the words that shape carries for a person. */
function checked<T>(read: () => T): T {
	try {
		return read();
	} catch (thrown) {
		const issues = (thrown as { issues?: { message?: string }[] }).issues;
		throw refuse(issues?.[0]?.message ?? UNREADABLE);
	}
}

function nothingToAsk(): string {
	const known = DOCUMENTING_TOOLS.map(documentingToolName).join(' or ');
	return `Sloppy has nothing on this computer to read the project with. Install ${known} and try again.`;
}

/** What a tool's answer is streamed back over — `Channel` in `@tauri-apps/api`
 *  is the one a running app uses. */
export interface Lines {
	onmessage: (line: string) => void;
}

class TauriDocumenting implements DocumentingAccess {
	/** What is underway here, settling once that act has. */
	private underway?: { done: Promise<void> };
	/** Whether somebody asked for what is underway to end. */
	private asked = false;

	constructor(
		private readonly here: () => Promise<ProjectHere | undefined>,
		private readonly call: Invoke,
		private readonly lines: () => Lines
	) {}

	async tools(): Promise<DocumentingTool[]> {
		const held = await this.call<string[]>(TOOLS);
		return DOCUMENTING_TOOLS.filter((tool) => held.includes(tool));
	}

	async survey(intent: DocumentingIntent): Promise<ProposedPlace[]> {
		const asked = checked(() => DocumentingIntentSchema.parse(intent));
		const where = await this.project();
		const tool = await this.toolFor(asked);
		return this.holding(async () => {
			const notes = await notesHere(containerApi(where.root, where.files));
			const said = await this.ask(tool, where, surveyPrompt(asked, pathsWritten(notes)));
			return said === undefined ? [] : proposed(said, notes);
		});
	}

	async run(
		plan: DocumentingPlan,
		watch: (progress: DocumentingProgress) => void
	): Promise<DocumentingProgress> {
		const asked = checked(() => DocumentingPlanSchema.parse(plan));
		if (!placesAreDistinct(asked.places)) {
			throw refuse('That list names a place twice. Take one of them out.');
		}
		const where = await this.project();
		const tool = await this.toolFor(asked.intent);
		return this.holding(async () => {
			const api = containerApi(where.root, where.files);
			const notes = await notesHere(api);
			const places: PlaceDone[] = [];
			const told = telling(watch);
			told({ stage: 'reading', places: [] });
			for (const place of asked.places) {
				if (this.asked) return told({ stage: 'stopped', places: [...places] });
				told({ stage: 'writing', at: place.path, places: [...places] });
				let done: PlaceDone;
				try {
					const standing = await standingNote(api, notes, place);
					const said = await this.ask(
						tool,
						where,
						notePrompt(asked.intent, place, standing && (await noteAsWritten(api, standing)))
					);
					if (said === undefined) return told({ stage: 'stopped', places: [...places] });
					const answer = noteSaid(said);
					if (answer === undefined) throw refuse(UNREADABLE);
					const note = await writeNote(api, notes, place, standing, answer);
					done = { path: place.path, ...(note === undefined ? {} : { note }) };
				} catch (thrown) {
					return told({ stage: 'stopped', places: [...places], trouble: why(thrown) });
				}
				places.push(done);
			}
			return told({ stage: 'done', places: [...places] });
		});
	}

	async stop(): Promise<void> {
		const held = this.underway;
		if (!held) return;
		this.asked = true;
		await this.call<void>(STOP);
		await held.done;
	}

	/** Start the tool and hear it out, or nothing where somebody stopped it. */
	private async ask(
		tool: DocumentingTool,
		where: ProjectHere,
		prompt: string
	): Promise<string | undefined> {
		const heard: string[] = [];
		const said = this.lines();
		said.onmessage = (line) => heard.push(line);
		const answer = await this.call<{ stopped: boolean }>(ASK, {
			tool,
			root: where.root,
			prompt,
			said
		}).catch((reason) => {
			throw refuse(typeof reason === 'string' ? reason : DIDNT_WORK);
		});
		return answer.stopped ? undefined : heard.join('\n');
	}

	private async project(): Promise<ProjectHere> {
		const where = await this.here();
		if (!where) throw refuse(NO_PROJECT);
		return where;
	}

	private async toolFor(intent: DocumentingIntent): Promise<DocumentingTool> {
		const held = await this.tools();
		if (intent.tool !== undefined) {
			if (held.includes(intent.tool)) return intent.tool;
			throw refuse(
				`${documentingToolName(intent.tool)} is not on this computer. Install it and try again.`
			);
		}
		const [first] = held;
		if (first === undefined) throw refuse(nothingToAsk());
		return first;
	}

	/** One thing at a time here, counting both, and `stop` resolves only once
	 *  that thing's own promise has. */
	private async holding<T>(doing: () => Promise<T>): Promise<T> {
		if (this.underway) throw refuse(ALREADY);
		let settle!: () => void;
		this.underway = { done: new Promise<void>((resolve) => (settle = resolve)) };
		this.asked = false;
		try {
			return await doing();
		} finally {
			this.underway = undefined;
			settle();
		}
	}
}

/** Every progress a page is told, held to its own shape and to `progressFits`
 *  before anybody sees it. */
function telling(
	watch: (progress: DocumentingProgress) => void
): (progress: DocumentingProgress) => DocumentingProgress {
	return (progress) => {
		const held = checked(() => DocumentingProgressSchema.parse(progress));
		if (!progressFits(held)) throw refuse(DIDNT_WORK);
		watch(held);
		return held;
	};
}

/** What a survey answers with: each place once, no more of them than a plan
 *  may carry, every one of them parsed, and the note it already has beside it. */
function proposed(said: string, notes: readonly NoteHere[]): ProposedPlace[] {
	const places = placesSaid(said);
	if (places === undefined) throw refuse(UNREADABLE);
	const held = new Map<string, ProposedPlace>();
	for (const one of places) {
		if (held.has(one.path)) continue;
		const note = noteAbout(notes, one.path);
		held.set(
			one.path,
			checked(() => ProposedPlaceSchema.parse({ ...one, ...(note === undefined ? {} : { note }) }))
		);
		if (held.size === MAX_PLACES_PER_RUN) break;
	}
	return [...held.values()];
}

export function tauriDocumenting(
	here: () => Promise<ProjectHere | undefined>,
	call: Invoke = invoke,
	lines: () => Lines = () => new Channel<string>()
): DocumentingAccess {
	return new TauriDocumenting(here, call, lines);
}
