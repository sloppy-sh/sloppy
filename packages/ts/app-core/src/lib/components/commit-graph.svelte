<script lang="ts" module>
	/** The lane hues, borrowed from the ramp the canvas lends a selected tag —
	 *  DESIGN.md § "The history as a picture". A ninth lane wraps onto the first. */
	export const HUES = [
		'text-facet-1',
		'text-facet-2',
		'text-facet-3',
		'text-facet-4',
		'text-facet-5',
		'text-facet-6',
		'text-facet-7',
		'text-facet-8'
	];

	const LANE = 12;
	const EDGE = 9;
	const DOT = 3.5;
	/** A row carrying the message over a line of date, author and hash, against
	 *  one carrying all four side by side. */
	/** Row heights in rem, so a reader who raises the root font size gets rows that
	 *  grow with the text they hold. */
	const FOLDED = 2.875;
	const DENSE = 1.875;

	/** Under this the columns fold and a row takes two lines. It is the
	 *  PICTURE's own width, not the window's: this stands in a sheet on a desk
	 *  and in a column beside the graph, and only it knows which. */
	const FOLD_UNDER = 36;
	const SHORT_NAME = 8;

	/** On the row the folder stands on. Short, because it sits in a 16rem column
	 *  beside a branch name; the sentence beside it is what a reader hears. */
	const HERE = 'Here';

	type Point = [number, number];

	function midpoint(from: Point, to: Point): Point {
		return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
	}

	/** A curve cut in half, so each row draws only the half that falls in it and
	 *  nothing has to spill past a row's edge. */
	function cut(p0: Point, p1: Point, p2: Point, p3: Point): [Point[], Point[]] {
		const a = midpoint(p0, p1);
		const b = midpoint(p1, p2);
		const c = midpoint(p2, p3);
		const d = midpoint(a, b);
		const e = midpoint(b, c);
		const m = midpoint(d, e);
		return [
			[p0, a, d, m],
			[m, e, c, p3]
		];
	}

	function curve(points: Point[], lift: number): string {
		const [p0, p1, p2, p3] = points.map(([x, y]) => `${x.toFixed(2)} ${(y + lift).toFixed(2)}`);
		return `M ${p0} C ${p1} ${p2} ${p3}`;
	}
</script>

<script lang="ts">
	// The history as a table — DESIGN.md § "The history as a picture". One row per
	// version, its lane beside it, the lines between them in the lane's hue.
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sloppy/ui/button';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import type { Snippet } from 'svelte';
	import type { DrawnVersion } from './commit-graph.js';
	import { lanes, type LaneLink, type Lanes } from './commit-lanes.js';

	let {
		versions,
		at,
		on,
		elsewhere = [],
		signs = false,
		older = false,
		busy = false,
		standingFor,
		onStandingFor,
		acts,
		openAt = null,
		onOlder,
		onOpen
	}: {
		/** Newest first, never above what it springs from. */
		versions: readonly DrawnVersion[];
		/** The version the folder stands on, marked as the one it is at. */
		at?: string;
		/** The line the folder is on, marked where a version carries it. */
		on?: string;
		/** The lines kept somewhere else, spelled as a row spells them —
		 *  `origin/main`. A line a row names that is not one of these is kept
		 *  here, whatever its name has in it. */
		elsewhere?: readonly string[];
		/** Whether this folder signs what it keeps, which is what makes a version
		 *  with no signature worth marking. */
		signs?: boolean;
		/** Whether there are older ones than these. */
		older?: boolean;
		busy?: boolean;
		/** How many versions a row stands for, by that row's id — a run nobody
		 *  wrote a message for, folded. Absent folds nothing. */
		standingFor?: ReadonlyMap<string, number>;
		/** Somebody asked to see the versions a folded row stands for. */
		onStandingFor?: (id: string) => void;
		/** What a version offers, drawn against that version's own row rather
		 *  than anywhere a reader would have to go and find it. */
		acts?: Snippet<[string]>;
		/** Which version's acts are showing; the caller toggles it in `onOpen`. */
		openAt?: string | null;
		onOlder: () => void;
		onOpen: (id: string) => void;
	} = $props();

	let box = $state.raw<HTMLElement | null>(null);
	let across = $state(0);
	let rootPx = $state(16);
	function readRootPx(): void {
		const said = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
		rootPx = Number.isFinite(said) && said > 0 ? said : 16;
	}
	$effect(() => {
		readRootPx();
		window.addEventListener('resize', readRootPx);
		return () => window.removeEventListener('resize', readRootPx);
	});
	$effect(() => {
		const held = box;
		if (!held) return;
		const measure = () => (across = held.offsetWidth);
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(held);
		return () => watching.disconnect();
	});
	let foot = $state.raw<HTMLElement | null>(null);
	/** Whether the foot of the list asks for the next page by itself. A browser
	 *  that cannot watch for it keeps the control, so nothing is out of reach. */
	const watching = $derived(typeof IntersectionObserver !== 'undefined');
	/** One page asked for at a time: `onOlder` answers on its own clock and the
	 *  foot stays in view the whole while it does. */
	let asking = false;
	$effect(() => {
		const at = foot;
		void versions.length;
		asking = false;
		if (!at || !older || !watching) return;
		const look = new IntersectionObserver((seen) => {
			if (!asking && seen.some((one) => one.isIntersecting)) {
				asking = true;
				onOlder();
			}
		});
		look.observe(at);
		return () => look.disconnect();
	});

	const folded = $derived(across > 0 && across < FOLD_UNDER * rootPx);
	const tall = $derived(Math.round((folded ? FOLDED : DENSE) * rootPx));
	const laid = $derived(lanes(versions));
	const width = $derived(EDGE * 2 + LANE * (laid.width - 1));
	const drawn = $derived(rows(laid, tall));

	interface Row {
		lane: number;
		hue: number;
		curves: { d: string; hue: number }[];
	}

	function rows(laid: Lanes, tall: number): Row[] {
		const out: Row[] = laid.places.map((place) => ({
			lane: place.lane,
			hue: laid.hues[place.line] % HUES.length,
			curves: []
		}));
		for (const link of laid.links) {
			const hue = laid.hues[link.line] % HUES.length;
			const [leaving, arriving] = between(link, tall);
			out[link.row]?.curves.push({ d: leaving, hue });
			out[link.row + 1]?.curves.push({ d: arriving, hue });
		}
		return out;
	}

	/** What a line between two rows draws in the row it leaves and in the row it
	 *  arrives in. */
	function between(link: LaneLink, tall: number): [string, string] {
		const from = x(link.from);
		const to = x(link.to);
		const half = tall / 2;
		if (from === to)
			return [`M ${from} ${half} L ${from} ${tall}`, `M ${from} 0 L ${from} ${half}`];
		const bend = tall * 0.8;
		const [leaving, arriving] = cut([from, 0], [from, bend], [to, tall - bend], [to, tall]);
		return [curve(leaving, half), curve(arriving, -half)];
	}

	function x(lane: number): number {
		return EDGE + lane * LANE;
	}

	/** Where a branch is kept is drawn in form, never in a second hue — the lanes
	 *  are what this surface spends hue on (DESIGN.md § "The history as a
	 *  picture"). */
	function chip(ref: string): string {
		if (ref === on) return 'border-foreground font-medium';
		return elsewhere.includes(ref)
			? 'border-dashed border-border text-muted-foreground'
			: 'border-border';
	}
</script>

<ul bind:this={box} aria-label="The history" class="@container">
	{#each versions as version, row (version.id)}
		{@const place = drawn[row] ?? { lane: 0, hue: 0, curves: [] }}
		{@const standing = version.id === at}
		{@const named = version.id.slice(0, SHORT_NAME)}
		{@const holds = standingFor?.get(version.id)}
		<li
			class="relative {standing ? 'rounded-md bg-muted/60 inset-ring-1 inset-ring-border' : ''}"
			style="height: {tall}px"
			data-version={version.id}
			data-lane={place.lane}
			data-standing={standing ? 'true' : undefined}
		>
			<button
				type="button"
				class="grid h-full w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-md pr-2 text-left hover:bg-muted focus-visible:inset-ring-2 focus-visible:inset-ring-ring focus-visible:outline-none @xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] {holds
					? 'text-muted-foreground'
					: ''}"
				onclick={() => (holds ? onStandingFor?.(version.id) : onOpen(version.id))}
			>
				<svg
					class="row-span-2 @xl:row-span-1"
					{width}
					height={tall}
					viewBox="0 0 {width} {tall}"
					aria-hidden="true"
				>
					{#each place.curves as curved, held (held)}
						<path
							class={HUES[curved.hue]}
							d={curved.d}
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
						/>
					{/each}
					<circle
						class={HUES[place.hue]}
						cx={x(place.lane)}
						cy={tall / 2}
						r={standing ? DOT + 0.5 : DOT}
						fill={standing ? 'var(--background)' : 'currentColor'}
						stroke={standing ? 'currentColor' : 'none'}
						stroke-width="2"
					/>
				</svg>

				<span class="flex min-w-0 items-center gap-1.5">
					{#if standing}
						<span
							class="shrink-0 rounded-full bg-foreground px-1.5 py-px text-[0.6875rem] font-medium text-background"
						>
							{HERE}
						</span>
						<span class="sr-only">Your graph stands on this version.</span>
					{/if}
					{#if version.signed}
						<Check class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span class="sr-only">Signed.</span>
					{:else if signs}
						<span class="shrink-0 text-[0.6875rem] text-muted-foreground">Kept unsigned</span>
					{/if}
					{#each version.refs as ref (ref)}
						<span class="shrink-0 rounded-full border px-1.5 py-px text-[0.6875rem] {chip(ref)}">
							{ref}
						</span>
					{/each}
					<span class="min-w-0 truncate text-sm"
						>{version.message || 'A version'}{#if holds}
							<span class="text-xs">· {holds} versions</span>
						{/if}</span
					>
				</span>

				<span
					class="col-start-2 flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground @xl:contents"
				>
					<span class="shrink-0 tabular-nums @xl:w-24 @xl:text-right">{version.when}</span>
					<span class="min-w-0 truncate @xl:w-24 @xl:text-right">
						{#if version.author}<span aria-hidden="true" class="@xl:hidden">·&nbsp;</span
							>{version.author}{/if}
					</span>
					<span class="shrink-0 font-mono @xl:w-16 @xl:text-right">
						<span aria-hidden="true" class="@xl:hidden">·&nbsp;</span>{named}
					</span>
				</span>
			</button>

			{#if acts && openAt === version.id}
				<div
					class="absolute inset-x-0 top-full z-20 mt-0.5 rounded-md border border-border bg-popover p-1 shadow-md"
					role="group"
					aria-label="What you can do with this version"
				>
					{@render acts(version.id)}
				</div>
			{/if}
		</li>
	{/each}
</ul>
{#if older}
	<div bind:this={foot} class="px-2 py-1">
		{#if watching}
			<div class="space-y-1.5" aria-hidden="true">
				<Skeleton class="h-3 w-2/3" />
				<Skeleton class="h-3 w-1/2" />
			</div>
			<span class="sr-only" role="status">Reading older versions.</span>
		{:else}
			<Button variant="ghost" class="h-9 w-full rounded-full" disabled={busy} onclick={onOlder}>
				Older versions
			</Button>
		{/if}
	</div>
{/if}
