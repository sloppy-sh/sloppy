/**
 * The builds a page suite works over: a {@link BuildFace} that holds one build
 * and records what was asked of it. Nothing here runs a session — the store
 * that does is `stores/build.svelte.ts`.
 */

import {
	buildLine,
	ulid,
	type Build,
	type BuildName,
	type BuildSlug,
	type ContextUsage,
	type OwnedRef,
	type Ulid
} from '@sloppy/types';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { runtime } from '../runtime.js';
import type { BuildFace } from './build-face.svelte.js';

/** Fixed, so a suite's expectations never turn on the clock. */
const WHEN = '2026-10-13T00:00:00.000Z';

export class BuildsStandIn implements BuildFace {
	reaches = true;
	busy = false;
	/** What is already called something here, which a name is held against. */
	readonly lines = new SvelteSet<string>();
	readonly began: { about: readonly OwnedRef[]; name: BuildName }[] = [];
	readonly answered: { need: BuildSlug; note: OwnedRef }[] = [];
	readonly dropped: BuildSlug[] = [];
	readonly read: { task: BuildSlug; note: OwnedRef }[] = [];
	readonly left: { task: BuildSlug; note: OwnedRef }[] = [];
	went = 0;
	stopped = 0;
	carriedOn = 0;
	discarded = 0;
	/** Why the next act does not land. */
	refuses: string | null = null;
	readonly windows = new SvelteMap<Ulid, ContextUsage>();

	#held = $state.raw<Build | null>(null);
	#says = $state.raw<string | null>(null);

	constructor(
		private readonly graph: OwnedRef,
		private readonly project: string
	) {}

	get standing(): Build | null {
		return this.#held;
	}

	get says(): string | null {
		return this.#says;
	}

	of(id: Ulid): Build | undefined {
		return this.#held?.id === id ? this.#held : undefined;
	}

	taken(name: BuildName): Promise<boolean> {
		return Promise.resolve(this.lines.has(buildLine(name)));
	}

	/** A build as the store would have written one, for a card to be read. */
	put(build: Build | null): void {
		this.#held = build;
	}

	/** A build begins and the thread it stands in is written, as the store that
	 *  runs the phases does both — docs/ARCHITECTURE.md § "Building from the
	 *  notes". */
	async begin(about: readonly OwnedRef[], name: BuildName): Promise<boolean> {
		this.began.push({ about, name });
		if (this.refuses !== null) {
			this.#says = this.refuses;
			return false;
		}
		this.#says = null;
		const id = ulid();
		this.#held = {
			id,
			graph: this.graph,
			project: this.project,
			about: [...about],
			name,
			line: buildLine(name),
			from: 'c0',
			state: 'reading',
			answers: {},
			tasks: {},
			sessions: [],
			merges: [],
			created: WHEN
		};
		this.lines.add(buildLine(name));
		await runtime.threads()?.write({
			id: ulid(),
			kind: 'build',
			build: id,
			name,
			graph: this.graph,
			project: this.project,
			created_at: WHEN,
			updated_at: WHEN,
			places: [],
			turns: []
		});
		return true;
	}

	go(): Promise<boolean> {
		this.went += 1;
		this.#change({ state: 'building' });
		return Promise.resolve(true);
	}

	answer(need: BuildSlug, note: OwnedRef): Promise<boolean> {
		this.answered.push({ need, note });
		const held = this.#held;
		if (held) this.#change({ answers: { ...held.answers, [need]: { note } } });
		return Promise.resolve(true);
	}

	drop(need: BuildSlug): Promise<boolean> {
		this.dropped.push(need);
		const held = this.#held;
		if (held) this.#change({ answers: { ...held.answers, [need]: { dropped: true } } });
		return Promise.resolve(true);
	}

	reads(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		this.read.push({ task, note });
		return Promise.resolve(true);
	}

	leaves(task: BuildSlug, note: OwnedRef): Promise<boolean> {
		this.left.push({ task, note });
		return Promise.resolve(true);
	}

	stop(): Promise<boolean> {
		this.stopped += 1;
		this.#change({ state: 'stopped' });
		return Promise.resolve(true);
	}

	carryOn(): Promise<boolean> {
		this.carriedOn += 1;
		this.#change({ state: 'building' });
		return Promise.resolve(true);
	}

	discard(): Promise<boolean> {
		this.discarded += 1;
		this.#held = null;
		return Promise.resolve(true);
	}

	contextOf(conversation: Ulid): ContextUsage | null {
		return this.windows.get(conversation) ?? null;
	}

	#change(over: Partial<Build>): void {
		const held = this.#held;
		if (held) this.#held = { ...held, ...over };
	}
}
