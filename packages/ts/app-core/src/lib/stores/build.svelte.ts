/**
 * Building a piece of a project out of the notes that say what it is for: the
 * phases Sloppy runs, the sessions it opens for each one, and the build this
 * device keeps — docs/ARCHITECTURE.md § "Building from the notes",
 * DESIGN.md § "A build".
 *
 * **The phases here are deterministic and the thinking is the assistants'.**
 * Every state change arrives as an act one of them called or an event one of
 * their sessions raised; `#step` is the only thing that decides what runs next,
 * and it decides it off the build alone, so a build read back off the disk
 * tomorrow goes on exactly where it stopped.
 *
 * **One build stands on a project at a time.** `current` is it, whatever state
 * it is in, until somebody discards it.
 */

import { emptySidecars, toMarkdown } from '@sloppy/vault';
import {
	anchorsOf,
	type Build,
	type BuildHandoff,
	type BuildMerge,
	type BuildName,
	BuildNameSchema,
	type BuildNeed,
	BUILD_NAME_NEEDS,
	BUILD_ROUNDS_MOST,
	BUILD_TASKS_AT_ONCE,
	type BuildPlan,
	type BuildReview,
	type BuildRole,
	type BuildSession,
	type BuildSlug,
	type BuildTask,
	type BuildTaskRun,
	type BuildTaskState,
	buildLine,
	chatAgentReach,
	type ContextUsage,
	contextTogether,
	MOST_HANDOFFS,
	MOST_NEEDS,
	MOST_NOTES_PER_TASK,
	MOST_SESSIONS,
	nowIso,
	type OwnedRef,
	splitOwnedRef,
	spentTogether,
	type Ulid,
	ulid
} from '@sloppy/types';
import { SvelteMap } from 'svelte/reactivity';
import { api } from '../api.js';
import { serveBuildCall, type BuildActing, type BuildActTaken } from '../build-acts.js';
import {
	implementerBrief,
	mergerBrief,
	plannerBrief,
	reviewerBrief,
	type BriefNote,
	type BriefOf
} from '../build-brief.js';
import {
	answerNow,
	buildingSaid,
	checkingSaid,
	fixingSaid,
	mergingSaid,
	planningSaid,
	reviewingSaid,
	type NeedAnswered
} from '../build-said.js';
import { runtime } from '../runtime.js';
import { seam } from '../seam.svelte.js';
import { chat, type BuildHeard, type BuildSessionLive } from './chat.svelte.js';
import { wordsFor } from './errors.js';
import { graphHistory } from './history.svelte.js';
import { troubleIn, whatHappened } from './what-happened.svelte.js';

const NO_ASSISTANT = 'Sloppy needs an assistant installed on this device to build anything.';
const WRONG_ASSISTANT =
	'A build runs on an assistant installed on this device. Choose one of those for the chat, then build.';
const UNTOLD = 'Sloppy could not tell what this device can build with. Try again.';
const ONE_AT_A_TIME = 'There is already a build on this project. Read it, or discard it first.';
const NO_PROJECT = 'There is no project open here to build in.';
const NOTHING_KEPT =
	'Keep a version of this folder first, so the build has something to grow from.';
const UNSTARTED = 'Sloppy could not start that just now. Try again.';
const NOT_ANSWERED = 'That question is not one this build is waiting on.';
const NOTHING_HANDED_ON = 'The assistant stopped without saying what it built.';
const NOTHING_PLANNED = 'The assistant stopped without saying what the work is.';

/** What a version kept for a build is called where somebody reads their own
 *  history. It names what it was for and nothing about who asked. */
const KEPT_FOR_A_BUILD = 'Before a build';

/** How full a session is let get before it is asked to hand off, as a part of
 *  where its assistant would make room for itself — short of that, so no
 *  session ever works on a window somebody else has already cut down. */
export const BUILD_HANDS_OFF_AT = 0.9;

/** Whether a session has filled far enough to be replaced. An agent that says
 *  nothing about where it makes room is measured against its window. */
export function fillingUp(usage: ContextUsage): boolean {
	return usage.total >= (usage.compactsAt ?? usage.limit) * BUILD_HANDS_OFF_AT;
}

/** The states a build has sessions in, which are the ones a session that could
 *  not go on stops. */
const RUNNING: readonly Build['state'][] = ['reading', 'building', 'reviewing', 'merging'];

/** A task's state once nothing more will happen to it on its own. */
const SETTLED: readonly BuildTaskState[] = ['built', 'contested', 'merged'];

/** One of a build's sessions while it is running. Nothing here is kept: the
 *  build keeps the ROW ({@link BuildSession}) and never the session. */
interface Running {
	conversation: Ulid;
	role: BuildRole;
	/** The task it is building or reading. Absent is the planner's and the
	 *  merger's. */
	task?: BuildSlug;
	/** The merge it is settling, for a merger session. Absent is the merger
	 *  running the line's checks. */
	settling?: BuildSlug;
	live: BuildSessionLive;
	/** Whether this session has done its job, so it is let go of as its turn
	 *  ends rather than inside the act that answered. */
	over: boolean;
	/** Whether it has been asked to hand off, because its window filled or
	 *  because it asked the person a question. */
	asked: boolean;
	/** Whether that ask has still to be made, the session having been answering
	 *  when it came up. */
	wanted: boolean;
	/** Whether a turn has already ended with nothing answered. A second one is
	 *  a session that is not going to answer. */
	nudged: boolean;
}

/** One question a build is waiting on, and who is waiting: a task, or the
 *  reading session that asked it of the whole build. */
export interface WaitingNeed {
	need: BuildNeed;
	/** The task held on it. Absent is one the plan asks. */
	task?: BuildSlug;
	/** The note the person wrote, where they have answered it. */
	note?: OwnedRef;
	/** Whether they set it aside. */
	dropped: boolean;
}

/** One session as the card reads it: what it is for, and how full its window
 *  is as its assistant last said. */
export interface SessionStanding {
	conversation: Ulid;
	role: BuildRole;
	task?: BuildSlug;
	context?: ContextUsage;
}

class BuildStore {
	#of: OwnedRef | null = null;
	/** The project the build is of, as the platform spells a folder. */
	#project: string | null = null;
	#held = $state.raw<Build | null>(null);
	#says = $state.raw<string | null>(null);
	readonly #running = new SvelteMap<Ulid, Running>();
	readonly #context = new SvelteMap<Ulid, ContextUsage>();
	/** The questions the reading session asked before it answered with a plan.
	 *  They are not kept: the plan is what keeps them, and a build whose reading
	 *  session is gone reads the notes again. */
	#asking: BuildNeed[] = [];
	/** One pass at a time, in the order they were asked for: two passes over one
	 *  build would open two sessions for one task. */
	#steps: Promise<void> = Promise.resolve();
	/** The writes to the build this device holds, in the order they were asked
	 *  for. */
	#writes: Promise<void> = Promise.resolve();
	/** The read-backs, in the order the graph in front of somebody changed. */
	#picking: Promise<void> = Promise.resolve();

	/** Whether the shell this runs in holds the lines and the copies a build
	 *  works in, which is what keeps the act off a browser tab. */
	get reaches(): boolean {
		return seam().chat()?.builds !== undefined;
	}

	/**
	 * Whether a build can run here: **the agent the chat is set to** is a program
	 * on this machine, which is what every session of a build is opened on.
	 * `undefined` is a device that has not said what it has or could not say:
	 * that is not a device with none, and telling somebody to install what they
	 * already have is worse than saying nothing.
	 */
	get assistantHere(): boolean | undefined {
		const held = chat.agents;
		if (!Array.isArray(held)) return undefined;
		const agent = chat.agent;
		return agent !== undefined && chatAgentReach(agent) === 'program';
	}

	/** The one line to put beside the act where a build cannot run on what this
	 *  device is set to, and `null` where it can. */
	get assistantSays(): string | null {
		const held = chat.agents;
		if (!Array.isArray(held)) return UNTOLD;
		if (this.assistantHere === true) return null;
		return held.some((one) => chatAgentReach(one) === 'program') ? WRONG_ASSISTANT : NO_ASSISTANT;
	}

	/** The build standing on this project, whatever state it is in. `null` is a
	 *  project with none, which is where Build is offered. */
	get current(): Build | null {
		return this.#held;
	}

	/**
	 * Whether the act stands in front of somebody: a project with no build on it,
	 * on a device whose shell can run one. **An assistant is not part of this** —
	 * the act stays where the note is and says what it needs, since an act that
	 * vanishes teaches nobody why (DESIGN.md § "A build"). {@link assistantSays}
	 * is the line it says it in.
	 */
	get offered(): boolean {
		return this.reaches && this.#held === null;
	}

	/** What went wrong, in words meant for the person. */
	get says(): string | null {
		return this.#says;
	}

	/** The sessions running now, in the order they opened. */
	get sessions(): readonly SessionStanding[] {
		return [...this.#running.values()].map((one) => {
			const context = this.#context.get(one.conversation);
			return {
				conversation: one.conversation,
				role: one.role,
				...(one.task === undefined ? {} : { task: one.task }),
				...(context === undefined ? {} : { context })
			};
		});
	}

	/** How full one session's window is, as it last said — one that has handed
	 *  off included, so a bar still stands where its turns are. `null` is a
	 *  session that never said, which draws none. */
	contextOf(conversation: Ulid): ContextUsage | null {
		return this.#context.get(conversation) ?? null;
	}

	/** Every question this build has asked — the plan's and the tasks' — with
	 *  how it was answered where it has been. */
	get needs(): readonly WaitingNeed[] {
		const build = this.#held;
		if (!build) return [];
		const answered = (need: BuildNeed, task?: BuildSlug): WaitingNeed => {
			const held = build.answers[need.id];
			return {
				need,
				...(task === undefined ? {} : { task }),
				...(held?.note === undefined ? {} : { note: held.note }),
				dropped: held?.dropped === true
			};
		};
		return [
			...(build.plan?.needs ?? []).map((need) => answered(need)),
			...Object.entries(build.tasks).flatMap(([task, run]) =>
				run.needs.map((need) => answered(need, task))
			)
		];
	}

	/** Which tasks are held on a question nobody has answered yet. */
	get asking(): readonly BuildSlug[] {
		return this.needs
			.filter((one) => one.task !== undefined && one.note === undefined && !one.dropped)
			.map((one) => one.task as BuildSlug);
	}

	/**
	 * Somebody has opened this graph: the build this project has is read back and
	 * picked up where it was left. Another project's build is not this one's, so
	 * what was held is let go of.
	 *
	 * One at a time, and a graph already picked up is not picked up again: a
	 * second pass over one build would open a second session for the phase it is
	 * in.
	 */
	async opened(graph: OwnedRef): Promise<void> {
		this.#picking = this.#picking.then(() => this.#pickUp(graph)).catch(() => {});
		await this.#picking;
	}

	async #pickUp(graph: OwnedRef): Promise<void> {
		const project = (await runtime.project().catch(() => undefined))?.root ?? null;
		if (this.#of === graph && this.#project === project) return;
		this.clear();
		this.#of = graph;
		this.#project = project;
		if (project === null) return;
		const kept = runtime.builds();
		if (!kept) return;
		try {
			const held = await kept.list();
			this.#held =
				held.find(
					(one) => one.graph === graph && one.project === project && one.state !== 'discarded'
				) ?? null;
		} catch (error) {
			whatHappened.put('trouble', `the builds were not looked up: ${troubleIn(error)}`);
			return;
		}
		await this.#resume();
	}

	/** Whether that name is one a line of work already has, which is what makes
	 *  it no name for this build. */
	async nameTaken(name: BuildName): Promise<boolean> {
		const line = buildLine(name);
		if (graphHistory.lines.some((one) => one.name === line)) return true;
		const builds = seam().chat()?.builds;
		const project = this.#project;
		if (!builds || project === null) return false;
		try {
			const standing = await builds.standing(project);
			return standing.some((one) => one.line === line && one.id !== this.#held?.id);
		} catch {
			return false;
		}
	}

	/**
	 * Begin a build of `about` called `name`: the notes are read and a plan is
	 * put in front of the person. **Nothing of theirs is kept or moved here** —
	 * that is Go's.
	 */
	async start(about: readonly OwnedRef[], name: BuildName): Promise<boolean> {
		if (!this.reaches) return false;
		if (this.#held) return this.#tell(ONE_AT_A_TIME);
		if (chat.agents === null) await chat.lookForAgents();
		const trouble = this.assistantSays;
		if (trouble !== null) return this.#tell(trouble);
		const graph = this.#of;
		const project = this.#project;
		if (graph === null || project === null || project === '') return this.#tell(NO_PROJECT);
		if (about.length === 0) return false;
		if (!BuildNameSchema.safeParse(name).success) return this.#tell(BUILD_NAME_NEEDS);
		const from = await graphHistory.versionNow();
		if (from === undefined) return this.#tell(NOTHING_KEPT);
		this.#says = null;
		this.#asking = [];
		const id = ulid();
		await this.#keep({
			id,
			graph,
			project,
			about: [...about],
			name,
			line: buildLine(name),
			from,
			state: 'reading',
			answers: {},
			tasks: {},
			sessions: [],
			merges: [],
			created: nowIso()
		});
		await chat.buildThread({ build: id, name, graph, project });
		await this.#openPlanner();
		return true;
	}

	/**
	 * A question answered by the note somebody wrote for it: the note is theirs,
	 * written where they write any note, and this records which note answered
	 * which question — DESIGN.md § "A build".
	 */
	async answer(need: BuildSlug, note: OwnedRef): Promise<boolean> {
		const build = this.#held;
		const asked = this.needs.find((one) => one.need.id === need);
		if (!build || !asked) return this.#tell(NOT_ANSWERED);
		await this.#keep({ ...build, answers: { ...build.answers, [need]: { note } } });
		await this.#handedOn(asked, note);
		await this.#released(need);
		return true;
	}

	/** And the other answer: the question set aside, and the build goes on
	 *  without it. */
	async drop(need: BuildSlug): Promise<boolean> {
		const build = this.#held;
		if (!build || !this.needs.some((one) => one.need.id === need)) return this.#tell(NOT_ANSWERED);
		await this.#keep({ ...build, answers: { ...build.answers, [need]: { dropped: true } } });
		await this.#released(need);
		return true;
	}

	/** A note added to what one task is built from, before Go. */
	async addNote(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		return this.#notesNow(task, (held) => (held.includes(note) ? held : [...held, note]));
	}

	/** And one taken off it. A task is built from at least one note, so the last
	 *  one does not come off. */
	async takeNote(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		return this.#notesNow(task, (held) =>
			held.length <= 1 ? held : held.filter((one) => one !== note)
		);
	}

	/**
	 * Go: a version of the folder is kept, the build's line opens at it, and the
	 * work starts. False is a build that did not start, with {@link says}
	 * carrying why — and nothing of the person's has moved either way.
	 */
	async go(): Promise<boolean> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build?.plan || build.state !== 'answering') return false;
		if (!builds) return this.#tell(UNSTARTED);
		this.#says = null;
		await graphHistory.keep(KEPT_FOR_A_BUILD);
		const from = await graphHistory.versionNow();
		if (from === undefined) return this.#tell(graphHistory.says ?? NOTHING_KEPT);
		try {
			const line = await builds.start(build.project, build.id, build.name, from);
			await this.#keep({ ...build, from, line: line.line, state: 'building' });
		} catch (error) {
			whatHappened.put('trouble', `the build's line did not open: ${troubleIn(error)}`);
			return this.#tell(wordsFor(error) ?? UNSTARTED);
		}
		await this.#advance();
		return true;
	}

	/** Stop the build. Everything that landed stays, and {@link goOn} takes it
	 *  up again. */
	async stop(): Promise<void> {
		const build = this.#held;
		if (!build) return;
		whatHappened.put('turn', 'a build was stopped');
		await this.#allSessionsGo();
		await this.#keep({ ...build, state: 'stopped' });
		await this.#lineGivenUp(build.id);
	}

	/** Continue: the phase the build is in is read off what it holds, and the
	 *  sessions it needs open again. */
	async goOn(): Promise<void> {
		const build = this.#held;
		if (!build || build.state !== 'stopped') return;
		this.#says = null;
		await this.#keep({ ...build, state: this.#phaseNow(build) });
		await this.#resume();
	}

	/** The build gone: its line, the copies it worked in, its thread and what
	 *  this device kept of it. Nothing of the person's is touched. */
	async discard(): Promise<boolean> {
		const build = this.#held;
		if (!build) return false;
		await this.#allSessionsGo();
		try {
			await seam().chat()?.builds?.discard(build.id);
		} catch (error) {
			whatHappened.put('trouble', `the build's line did not go: ${troubleIn(error)}`);
			return this.#tell(wordsFor(error) ?? UNSTARTED);
		}
		await chat.buildGone(build.id);
		try {
			await runtime.builds()?.remove(build.id);
		} catch (error) {
			whatHappened.put('trouble', `the build was not deleted: ${troubleIn(error)}`);
		}
		this.#held = null;
		this.#context.clear();
		this.#asking = [];
		return true;
	}

	clear(): void {
		for (const running of [...this.#running.values()]) {
			this.#running.delete(running.conversation);
			void running.live.close().catch(() => {});
		}
		this.#context.clear();
		this.#asking = [];
		this.#held = null;
		this.#says = null;
		this.#of = null;
		this.#project = null;
	}

	/** What a build in front of somebody is to go on with, read off what it
	 *  holds rather than off what it last did. */
	#phaseNow(build: Build): Build['state'] {
		if (!build.plan) return 'reading';
		const runs = build.plan.tasks.map((task) => build.tasks[task.id]);
		if (runs.some((run) => run === undefined)) return 'answering';
		if (runs.some((run) => !SETTLED.includes(run.state)))
			return runs.every((run) => run.state === 'reviewing' || SETTLED.includes(run.state))
				? 'reviewing'
				: 'building';
		// Every task has settled. What passed goes into the line BEFORE a contested
		// one is reported, because the person offered "bring in the rest" has to
		// have a rest to bring (DESIGN.md § "A build").
		if (runs.some((run) => run.state === 'built')) return 'merging';
		const brought = runs.some((run) => run.state === 'merged');
		if (brought && build.checked === undefined) return 'merging';
		if (runs.some((run) => run.state === 'contested')) return 'contested';
		return 'built';
	}

	/** The sessions a build in one of the running phases needs, opened again. */
	async #resume(): Promise<void> {
		const build = this.#held;
		if (!build) return;
		if (build.state === 'discarded') return;
		await chat.buildThread({
			build: build.id,
			name: build.name,
			graph: build.graph,
			project: build.project
		});
		if (build.state === 'reading') {
			await this.#openPlanner();
			return;
		}
		await this.#advance();
	}

	async #openPlanner(): Promise<void> {
		const build = this.#held;
		if (!build) return;
		const of = await this.#briefOf(build.about, []);
		// The reading session runs in the project itself, because the build's own
		// copy does not exist until Go keeps a version to fork it from. It is
		// served nothing that writes.
		await this.#open(
			{ role: 'planner', cwd: build.project, brief: plannerBrief(of) },
			planningSaid()
		);
	}

	async #openImplementer(task: BuildTask): Promise<void> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build?.plan || !builds) return;
		const run = build.tasks[task.id];
		if (!run) return;
		const last = run.handoffs[run.handoffs.length - 1];
		const answered = this.#answeredIn(task, run);
		const said =
			run.review !== undefined && !run.review.clean
				? fixingSaid(run.review, last, answered)
				: buildingSaid({ ...(last === undefined ? {} : { handoff: last }), answered });
		let cwd: string;
		try {
			cwd = await builds.taskCheckout(build.id, task.id);
		} catch (error) {
			whatHappened.put('trouble', `a task's copy did not open: ${troubleIn(error)}`);
			await this.#stopped(wordsFor(error) ?? UNSTARTED);
			return;
		}
		await this.#taskNow(task.id, { state: 'building' });
		await this.#open(
			{
				role: 'implementer',
				task: task.id,
				cwd,
				brief: implementerBrief(task, await this.#briefOf(task.notes, build.plan.checks))
			},
			said
		);
	}

	async #openReviewer(task: BuildTask): Promise<void> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build?.plan || !builds) return;
		const run = build.tasks[task.id];
		if (!run) return;
		let cwd: string;
		try {
			cwd = await builds.taskCheckout(build.id, task.id);
		} catch (error) {
			whatHappened.put('trouble', `a task's copy did not open: ${troubleIn(error)}`);
			await this.#stopped(wordsFor(error) ?? UNSTARTED);
			return;
		}
		await this.#open(
			{
				role: 'reviewer',
				task: task.id,
				cwd,
				brief: reviewerBrief(task, await this.#briefOf(task.notes, build.plan.checks))
			},
			reviewingSaid(run.handoffs)
		);
	}

	/** The session that works on the build's own line: settling what two tasks
	 *  left in two versions, or running the line's checks once they are all in. */
	async #openMerger(settling: BuildSlug | undefined, conflicts: readonly string[]): Promise<void> {
		const build = this.#held;
		if (!build?.plan) return;
		const path = await this.#linePath();
		if (path === null) {
			await this.#stopped(this.#says ?? UNSTARTED);
			return;
		}
		const notes = settling === undefined ? build.about : (this.#taskOf(settling)?.notes ?? []);
		await this.#open(
			{
				role: 'merger',
				...(settling === undefined ? {} : { settling }),
				cwd: path,
				brief: mergerBrief(build.plan.tasks, await this.#briefOf(notes, build.plan.checks))
			},
			settling === undefined ? checkingSaid() : mergingSaid(conflicts)
		);
	}

	async #open(
		asked: {
			role: BuildRole;
			cwd: string;
			brief: string;
			task?: BuildSlug;
			settling?: BuildSlug;
		},
		said: string
	): Promise<void> {
		const build = this.#held;
		if (!build) return;
		const conversation = ulid();
		let live: BuildSessionLive;
		try {
			live = await chat.openBuild(
				{
					build: build.id,
					conversation,
					role: asked.role,
					cwd: asked.cwd,
					brief: asked.brief
				},
				(call) => this.#act(conversation, call),
				(what) => this.#heard(conversation, what)
			);
		} catch (error) {
			whatHappened.put('trouble', `a build session would not start: ${troubleIn(error)}`);
			await this.#stopped(wordsFor(error) ?? UNSTARTED);
			return;
		}
		this.#running.set(conversation, {
			conversation,
			role: asked.role,
			...(asked.task === undefined ? {} : { task: asked.task }),
			...(asked.settling === undefined ? {} : { settling: asked.settling }),
			live,
			over: false,
			asked: false,
			wanted: false,
			nudged: false
		});
		await this.#session({
			conversation,
			role: asked.role,
			...(asked.task === undefined ? {} : { task: asked.task })
		});
		try {
			await live.say(said);
		} catch (error) {
			whatHappened.put('trouble', `a build session was not told: ${troubleIn(error)}`);
			await this.#stopped(wordsFor(error) ?? UNSTARTED);
		}
	}

	async #act(conversation: Ulid, call: Parameters<typeof serveBuildCall>[1]) {
		const running = this.#running.get(conversation);
		if (!running) return { said: NOT_ANSWERED, trouble: true };
		return await serveBuildCall(this.#acting(running), call);
	}

	#acting(running: Running): BuildActing {
		return {
			role: running.role,
			plan: (plan) => this.#plan(running, plan),
			raise: (need) => this.#raise(running, need),
			handOff: (handoff) => this.#handOff(running, handoff),
			review: (review) => this.#review(running, review)
		};
	}

	async #plan(running: Running, plan: BuildPlan): Promise<BuildActTaken> {
		const build = this.#held;
		if (!build || build.plan !== undefined) return 'already';
		const needs = [...plan.needs];
		for (const held of this.#asking) {
			if (needs.length >= MOST_NEEDS) break;
			needs.push({ ...held, id: this.#freeNeedId(held.id, needs) });
		}
		this.#asking = [];
		const tasks: Record<string, BuildTaskRun> = {};
		for (const task of plan.tasks)
			tasks[task.id] = { state: 'waiting', handoffs: [], needs: [], rounds: 0 };
		await this.#keep({ ...build, plan: { ...plan, needs }, tasks, state: 'answering' });
		running.over = true;
		return 'taken';
	}

	async #raise(running: Running, need: BuildNeed): Promise<BuildActTaken> {
		const build = this.#held;
		if (!build) return 'full';
		if (running.role === 'planner') {
			if (this.#asking.length >= MOST_NEEDS) return 'full';
			this.#asking = [...this.#asking, { ...need, id: this.#freeNeedId(need.id, this.#asking) }];
			return 'taken';
		}
		const task = running.task;
		const run = task === undefined ? undefined : build.tasks[task];
		if (task === undefined || !run) return 'full';
		if (run.needs.length >= MOST_NEEDS) return 'full';
		const held = {
			...need,
			id: this.#freeNeedId(
				need.id,
				this.needs.map((one) => one.need)
			)
		};
		await this.#taskNow(task, { state: 'asking', needs: [...run.needs, held] });
		running.asked = true;
		running.wanted = true;
		return 'taken';
	}

	async #handOff(running: Running, handoff: BuildHandoff): Promise<BuildActTaken> {
		const build = this.#held;
		if (!build) return 'full';
		if (running.task === undefined) {
			await this.#merged(running, handoff);
			running.over = true;
			return 'taken';
		}
		const run = build.tasks[running.task];
		if (!run) return 'full';
		if (run.handoffs.length >= MOST_HANDOFFS) {
			await this.#taskNow(running.task, { state: 'contested' });
			running.over = true;
			return 'full';
		}
		const handoffs = [...run.handoffs, handoff];
		const state: BuildTaskState =
			run.state === 'asking' ? 'asking' : handoff.finished ? 'reviewing' : 'building';
		if (handoff.finished) await this.#commit(running.task, build);
		await this.#taskNow(running.task, { handoffs, state });
		running.over = true;
		return 'taken';
	}

	async #review(running: Running, review: BuildReview): Promise<BuildActTaken> {
		const build = this.#held;
		const task = running.task;
		const run = task === undefined ? undefined : build?.tasks[task];
		if (!build || task === undefined || !run) return 'already';
		if (run.state !== 'reviewing') return 'already';
		const again = !review.clean && run.rounds < BUILD_ROUNDS_MOST;
		await this.#taskNow(task, {
			review,
			rounds: again ? run.rounds + 1 : run.rounds,
			state: review.clean ? 'built' : again ? 'building' : 'contested'
		});
		running.over = true;
		return 'taken';
	}

	/** What one task wrote, kept as a version of the copy it worked in. */
	async #commit(task: BuildSlug, build: Build): Promise<void> {
		const builds = seam().chat()?.builds;
		const title = this.#taskOf(task)?.title ?? task;
		if (!builds) return;
		try {
			const path = await builds.taskCheckout(build.id, task);
			await builds.commit(path, title);
		} catch (error) {
			whatHappened.put('trouble', `what a task built was not kept: ${troubleIn(error)}`);
		}
	}

	/** A merger session's hand-off: the conflict it settled, or the checks it
	 *  ran on the whole line. */
	async #merged(running: Running, handoff: BuildHandoff): Promise<void> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build || !builds) return;
		const settling = running.settling;
		if (settling === undefined) {
			const checked = { ...build, checked: [...handoff.checks] };
			await this.#keep({ ...checked, state: this.#phaseNow(checked) });
			await this.#lineGivenUp(build.id);
			return;
		}
		const path = await this.#linePath();
		if (path !== null) {
			try {
				await builds.commit(path, `Settle ${this.#taskOf(settling)?.title ?? settling}`);
			} catch (error) {
				whatHappened.put('trouble', `a merge was not kept: ${troubleIn(error)}`);
			}
		}
		await this.#settledMerge(settling);
	}

	/** One merge done, and the task it brought in finished with. */
	async #settledMerge(task: BuildSlug): Promise<void> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build) return;
		const held = build.merges.find((one) => one.task === task);
		const merges: BuildMerge[] = [
			...build.merges.filter((one) => one.task !== task),
			{ task, settled: true, conflicts: held?.conflicts ?? [] }
		];
		await this.#keep({ ...build, merges });
		await this.#taskNow(task, { state: 'merged' });
		try {
			await builds?.finishTask(build.id, task);
		} catch (error) {
			whatHappened.put('trouble', `a task's copy was not given up: ${troubleIn(error)}`);
		}
	}

	#heard(conversation: Ulid, what: BuildHeard): void {
		const running = this.#running.get(conversation);
		if (!running) return;
		switch (what.heard) {
			case 'context': {
				const usage = contextTogether(this.#context.get(conversation), what.usage);
				this.#context.set(conversation, usage);
				if (!running.asked && !running.over && fillingUp(usage)) {
					running.asked = true;
					void running.live.say(answerNow(running.role)).catch(() => {
						running.wanted = true;
					});
				}
				break;
			}
			case 'ended':
				if (what.spent !== undefined) void this.#spent(conversation, what.spent);
				void this.#ended(running);
				break;
			case 'over':
				this.#running.delete(conversation);
				if (running.over) void this.#advance();
				else void this.#stopped(what.said);
				break;
		}
	}

	/** A turn of one session ending: the session let go of where it has done its
	 *  job, asked to hand off where it has to, and nudged once where it answered
	 *  with nothing at all. */
	async #ended(running: Running): Promise<void> {
		if (running.over) {
			await this.#sessionGoes(running);
			await this.#advance();
			return;
		}
		void running.live.askContext().catch(() => {});
		if (running.wanted) {
			running.wanted = false;
			try {
				await running.live.say(answerNow(running.role));
				return;
			} catch {
				// Nothing to say it into any more; the next turn's end asks again.
				running.wanted = true;
				return;
			}
		}
		if (running.nudged) {
			await this.#sessionGoes(running);
			if (running.task !== undefined) {
				await this.#taskNow(running.task, { state: 'contested' });
				this.#tell(NOTHING_HANDED_ON);
				await this.#advance();
				return;
			}
			// Nothing else carries the phase a planner or a merger was opened for,
			// so the build stops with what landed and Continue is there — rather
			// than a card that says it is reading and nothing running.
			await this.#stopped(running.role === 'planner' ? NOTHING_PLANNED : NOTHING_HANDED_ON);
			return;
		}
		running.nudged = true;
		try {
			await running.live.say(answerNow(running.role));
		} catch {
			running.wanted = true;
		}
	}

	/** A session that could not go on: the build stops, keeping everything that
	 *  landed, and Continue takes it up again. */
	async #stopped(said: string | undefined): Promise<void> {
		const build = this.#held;
		if (!build) return;
		if (said !== undefined) this.#tell(said);
		await this.#allSessionsGo();
		if (!RUNNING.includes(build.state)) return;
		await this.#keep({ ...(this.#held ?? build), state: 'stopped' });
		await this.#lineGivenUp(build.id);
	}

	/** The line's copy let go of, so the person can work on the line in their
	 *  own folder. {@link goOn} asks for it again, and a line that stands
	 *  answers the same copy rather than a second. */
	async #lineGivenUp(id: Ulid): Promise<void> {
		try {
			await seam().chat()?.builds?.finish(id);
		} catch (error) {
			whatHappened.put('trouble', `the build's copy was not given up: ${troubleIn(error)}`);
		}
	}

	/** One pass at what the build needs next. Every state change calls it, and
	 *  it is the only thing that opens a session. */
	#advance(): Promise<void> {
		this.#steps = this.#steps.then(() => this.#step()).catch(() => {});
		return this.#steps;
	}

	async #step(): Promise<void> {
		const state = this.#held?.state;
		if (state !== 'building' && state !== 'reviewing' && state !== 'merging') return;
		if (state !== 'merging') await this.#tasksOn();
		if (this.#held?.state === 'merging') await this.#merge();
	}

	/** The sessions the tasks need now, and where the whole of them has got to.
	 *  Nothing here opens a pass of its own: this IS the pass. */
	async #tasksOn(): Promise<void> {
		await this.#contestTheBlocked();
		for (const want of ['reviewing', 'building', 'waiting'] as const) {
			for (const task of this.#held?.plan?.tasks ?? []) {
				if (!this.#goingOn()) return;
				const run = this.#held?.tasks[task.id];
				if (run?.state !== want) continue;
				if (this.#sessionFor(task.id) || this.#underway() >= BUILD_TASKS_AT_ONCE) continue;
				if (want === 'waiting' && !this.#ready(task)) continue;
				if (want === 'reviewing') await this.#openReviewer(task);
				else await this.#openImplementer(task);
			}
		}
		await this.#settle();
	}

	/** A task waiting on one nobody could settle cannot be built, so it is said
	 *  rather than left waiting for something that will never come — and so is
	 *  the one waiting on THAT, however deep the chain runs. */
	async #contestTheBlocked(): Promise<void> {
		for (;;) {
			let any = false;
			for (const task of this.#held?.plan?.tasks ?? []) {
				if (this.#held?.tasks[task.id]?.state !== 'waiting') continue;
				const blocked = (task.after ?? []).some(
					(one) => this.#held?.tasks[one]?.state === 'contested'
				);
				if (!blocked) continue;
				await this.#taskNow(task.id, { state: 'contested' });
				any = true;
			}
			if (!any) return;
		}
	}

	/** Where the whole build has got to, once nothing more is running. */
	async #settle(): Promise<void> {
		const build = this.#held;
		if (!build?.plan || !this.#goingOn()) return;
		if (this.#running.size === 0)
			for (const task of this.#goingNowhere(build))
				await this.#taskNow(task, { state: 'contested' });
		const held = this.#held;
		if (!held || !this.#goingOn()) return;
		const state = this.#phaseNow(held);
		if (state !== held.state) await this.#keep({ ...held, state });
	}

	/**
	 * The tasks waiting for something that will never come: every task they wait
	 * on is itself waiting, which is a plan with a ring in it. **One waiting on a
	 * task being built, read or held on a question is not one of these** — that
	 * answer is still coming, and the task behind it goes on afterwards.
	 */
	#goingNowhere(build: Build): BuildSlug[] {
		const waiting = (build.plan?.tasks ?? []).filter(
			(task) => build.tasks[task.id]?.state === 'waiting'
		);
		const alsoWaiting = (id: BuildSlug) => waiting.some((task) => task.id === id);
		let coming: BuildSlug[] = [];
		for (;;) {
			const next = waiting
				.filter((task) =>
					(task.after ?? []).every((one) => !alsoWaiting(one) || coming.includes(one))
				)
				.map((task) => task.id);
			if (next.length === coming.length)
				return waiting.map((task) => task.id).filter((one) => !next.includes(one));
			coming = next;
		}
	}

	/** The tasks into the line, one at a time, and the line's checks once they
	 *  are all in. */
	async #merge(): Promise<void> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build?.plan || !builds) return;
		if (this.#running.size > 0) return;
		for (const task of build.plan.tasks) {
			if (build.tasks[task.id]?.state !== 'built') continue;
			let answer: { merged: boolean; conflicts: string[] };
			try {
				answer = await builds.mergeTask(build.id, task.id);
			} catch (error) {
				whatHappened.put('trouble', `a task was not brought in: ${troubleIn(error)}`);
				await this.#stopped(wordsFor(error) ?? UNSTARTED);
				return;
			}
			if (answer.merged) {
				await this.#settledMerge(task.id);
				continue;
			}
			const held = this.#held;
			if (!held) return;
			await this.#keep({
				...held,
				merges: [
					...held.merges.filter((one) => one.task !== task.id),
					{ task: task.id, settled: false, conflicts: [...answer.conflicts] }
				]
			});
			await this.#openMerger(task.id, answer.conflicts);
			return;
		}
		if (this.#held?.checked === undefined) await this.#openMerger(undefined, []);
	}

	/** Whether every task this one waits for is in. A name no task in the plan
	 *  carries waits for nothing. */
	#ready(task: BuildTask): boolean {
		return (task.after ?? []).every((one) => {
			const run = this.#held?.tasks[one];
			return run === undefined || run.state === 'built' || run.state === 'merged';
		});
	}

	/** Whether the build is still in a phase that runs sessions. A session that
	 *  could not be opened stops it mid-pass, and nothing after that opens a
	 *  second one or reads a phase off a build nobody is running. */
	#goingOn(): boolean {
		const state = this.#held?.state;
		return state !== undefined && RUNNING.includes(state);
	}

	/** How many tasks are being worked on now, which is what
	 *  {@link BUILD_TASKS_AT_ONCE} bounds. */
	#underway(): number {
		return [...this.#running.values()].filter((one) => one.task !== undefined).length;
	}

	#sessionFor(task: BuildSlug): Running | undefined {
		return [...this.#running.values()].find((one) => one.task === task);
	}

	#taskOf(task: BuildSlug): BuildTask | undefined {
		return this.#held?.plan?.tasks.find((one) => one.id === task);
	}

	/** A question answered, and the task that was waiting on it taken up again
	 *  where nothing else holds it. */
	async #released(need: BuildSlug): Promise<void> {
		const holding = this.needs.find((one) => one.need.id === need)?.task;
		if (holding === undefined) return;
		const run = this.#held?.tasks[holding];
		if (!run || run.state !== 'asking') return;
		if (this.asking.includes(holding)) return;
		await this.#taskNow(holding, { state: 'building' });
		await this.#advance();
	}

	/**
	 * What a task's sessions are told of the questions this build has asked and
	 * the person has answered: the ones the task itself raised, and the ones the
	 * plan asked about a note the task is built from or about the feature as a
	 * whole. A question answered for the whole build is one every task it bears
	 * on has to be told, or it guesses the thing that was just written down.
	 */
	#answeredIn(task: BuildTask, run: BuildTaskRun): NeedAnswered[] {
		const build = this.#held;
		if (!build) return [];
		const asked = [
			...(build.plan?.needs ?? []).filter(
				(need) => need.about === undefined || task.notes.includes(need.about)
			),
			...run.needs
		];
		return asked.flatMap((need) => {
			const held = build.answers[need.id];
			if (!held || (held.note === undefined && held.dropped !== true)) return [];
			return [{ question: need.question, ...(held.note === undefined ? {} : { note: held.note }) }];
		});
	}

	/**
	 * The note that answered a question the PLAN asked, added to the notes of
	 * every task it bears on, so the session reads it whole among its own rather
	 * than being sent to find it. The person may still take it off before Go,
	 * which is the curation the card already offers them.
	 */
	async #handedOn(asked: WaitingNeed, note: OwnedRef): Promise<void> {
		const build = this.#held;
		if (!build?.plan || asked.task !== undefined || build.state !== 'answering') return;
		const about = asked.need.about;
		const tasks = build.plan.tasks.map((one) =>
			(about === undefined || one.notes.includes(about)) &&
			!one.notes.includes(note) &&
			one.notes.length < MOST_NOTES_PER_TASK
				? { ...one, notes: [...one.notes, note] }
				: one
		);
		await this.#keep({ ...build, plan: { ...build.plan, tasks } });
	}

	async #notesNow(
		task: BuildSlug,
		held: (notes: readonly OwnedRef[]) => readonly OwnedRef[]
	): Promise<boolean> {
		const build = this.#held;
		if (!build?.plan || build.state !== 'answering') return false;
		const standing = this.#taskOf(task);
		if (!standing) return false;
		const notes = held(standing.notes);
		if (
			notes.length === standing.notes.length &&
			notes.every((one, at) => one === standing.notes[at])
		)
			return false;
		await this.#keep({
			...build,
			plan: {
				...build.plan,
				tasks: build.plan.tasks.map((one) =>
					one.id === task ? { ...one, notes: [...notes] } : one
				)
			}
		});
		return true;
	}

	/** An id no question of this build already has, so one answer can never
	 *  reach two questions. */
	#freeNeedId(id: BuildSlug, beside: readonly BuildNeed[]): BuildSlug {
		const taken = new Set([
			...Object.keys(this.#held?.answers ?? {}),
			...this.needs.map((one) => one.need.id),
			...beside.map((one) => one.id)
		]);
		if (!taken.has(id)) return id;
		for (let next = 2; ; next += 1) {
			const held = `${id.slice(0, 60)}-${next}`;
			if (!taken.has(held)) return held;
		}
	}

	/** The line's own copy, which {@link BuildAccess.start} answers with again
	 *  rather than opening a second. */
	async #linePath(): Promise<string | null> {
		const build = this.#held;
		const builds = seam().chat()?.builds;
		if (!build || !builds) return null;
		try {
			return (await builds.start(build.project, build.id, build.name, build.from)).path;
		} catch (error) {
			this.#tell(wordsFor(error) ?? UNSTARTED);
			return null;
		}
	}

	/** The notes a session is handed, read whole out of the graph in front of
	 *  the person. A note that is not there is left out. */
	async #briefOf(notes: readonly OwnedRef[], checks: readonly string[]): Promise<BriefOf> {
		const read: BriefNote[] = [];
		for (const ref of notes) {
			const note = await api.getNode(ref).catch(() => null);
			if (!note) continue;
			const blocks = await api.listBlocks(note.ref).catch(() => []);
			const aside = emptySidecars(splitOwnedRef(note.ref).localId);
			const sections = blocks.map((block) =>
				toMarkdown(block.content, { ...aside, block: splitOwnedRef(block.ref).localId })
			);
			const anchors = [
				...new Set(blocks.flatMap((block) => anchorsOf(block.content).map((one) => one.path)))
			];
			read.push({
				note: note.ref,
				title: note.title,
				...(note.address === undefined ? {} : { address: note.address }),
				sections,
				anchors
			});
		}
		return { notes: read, checks: [...checks] };
	}

	async #taskNow(task: BuildSlug, changed: Partial<BuildTaskRun>): Promise<void> {
		const build = this.#held;
		const run = build?.tasks[task];
		if (!build || !run) return;
		await this.#keep({ ...build, tasks: { ...build.tasks, [task]: { ...run, ...changed } } });
	}

	async #session(row: BuildSession): Promise<void> {
		const build = this.#held;
		if (!build || build.sessions.length >= MOST_SESSIONS) return;
		await this.#keep({ ...build, sessions: [...build.sessions, row] });
	}

	async #spent(conversation: Ulid, spent: BuildSession['spent']): Promise<void> {
		const build = this.#held;
		if (!build || spent === undefined) return;
		await this.#keep({
			...build,
			sessions: build.sessions.map((one) =>
				one.conversation === conversation ? { ...one, spent: spentTogether(one.spent, spent) } : one
			)
		});
	}

	async #sessionGoes(running: Running): Promise<void> {
		this.#running.delete(running.conversation);
		await running.live.close().catch(() => {});
	}

	async #allSessionsGo(): Promise<void> {
		for (const running of [...this.#running.values()]) await this.#sessionGoes(running);
	}

	/** One at a time, in the order they were asked for: two of them are a task
	 *  handing on and another starting, and the later write carries what the
	 *  earlier one did. */
	async #keep(build: Build): Promise<void> {
		this.#held = build;
		const kept = runtime.builds();
		if (!kept) return;
		this.#writes = this.#writes
			.then(() => kept.write(build))
			.catch((error: unknown) => {
				whatHappened.put('trouble', `the build was not kept: ${troubleIn(error)}`);
			});
		await this.#writes;
	}

	#tell(words: string): false {
		this.#says = words;
		return false;
	}
}

export const builds = new BuildStore();
