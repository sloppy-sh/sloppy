<script lang="ts" module>
	const ROW = 56;
	const LANE = 14;
	const EDGE = 12;
	const DOT = 3.5;
	const BEND = 12;
	/** Past this many lanes there is no room for them beside the words, at any
	 *  width this surface is given. */
	const MOST_LANES = 5;
	const HALF_INK = 0.45;
</script>

<script lang="ts">
	// The history as a picture — DESIGN.md § "The history as a picture". Lanes in
	// ink, the branch the folder is on at full ink and every other at half.
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sloppy/ui/button';
	import { MediaQuery } from 'svelte/reactivity';
	import { alongTheLine, type DrawnVersion, placed } from './commit-graph.js';

	let {
		versions,
		at,
		signs = false,
		older = false,
		busy = false,
		onOlder,
		onOpen
	}: {
		/** Newest first, never above what it springs from. */
		versions: readonly DrawnVersion[];
		/** The version the folder stands on, whose lane is drawn at full ink. */
		at?: string;
		/** Whether this folder signs what it keeps, which is what makes a version
		 *  with no signature worth marking. */
		signs?: boolean;
		/** Whether there are older ones than these. */
		older?: boolean;
		busy?: boolean;
		onOlder: () => void;
		onOpen: (id: string) => void;
	} = $props();

	const narrow = new MediaQuery('(max-width: 639px)');

	const laid = $derived(placed(versions));
	const widest = $derived(laid.reduce((most, one) => Math.max(most, one.lane + 1), 1));
	const collapsed = $derived(narrow.current || widest > MOST_LANES);
	const drawn = $derived(
		collapsed
			? laid.map((one) => ({
					...one,
					lane: 0,
					springs: one.springs.map((into) => ({ ...into, lane: 0 }))
				}))
			: laid
	);
	const columns = $derived(collapsed ? 1 : widest);
	const width = $derived(EDGE * 2 + LANE * (columns - 1));
	const height = $derived(versions.length * ROW);
	const online = $derived(alongTheLine(versions, at));

	function x(lane: number): number {
		return EDGE + lane * LANE;
	}

	function y(row: number): number {
		return row * ROW + ROW / 2;
	}

	/** From a version's mark down to one it springs from: straight in one lane,
	 *  and bent into the parent's where they differ. */
	function line(row: number, from: number, into: { row: number; lane: number }): string {
		const x1 = x(from);
		const x2 = x(into.lane);
		const y1 = y(row);
		const y2 = y(into.row);
		if (x1 === x2) return `M ${x1} ${y1} L ${x1} ${y2}`;
		const step = Math.sign(x2 - x1) * Math.min(BEND, Math.abs(x2 - x1));
		return `M ${x1} ${y1} L ${x1} ${y2 - Math.min(BEND, y2 - y1)} Q ${x1} ${y2} ${x1 + step} ${y2} L ${x2} ${y2}`;
	}

	function ink(id: string): number {
		return online.has(id) ? 1 : HALF_INK;
	}

	/** A line into a version on another lane is that lane's, so a merge does not
	 *  draw the line it took in as though it were the one the folder is on. */
	function inkBetween(row: number, into: { row: number }): number {
		return ink(versions[row].id) === 1 && ink(versions[into.row].id) === 1 ? 1 : HALF_INK;
	}
</script>

<div class="relative">
	<svg
		class="pointer-events-none absolute top-0 left-0 text-graph-ink"
		{width}
		{height}
		viewBox="0 0 {width} {height}"
		aria-hidden="true"
	>
		{#each drawn as one, row (versions[row].id)}
			{#each one.springs as into (`${row}-${into.row}-${into.lane}`)}
				<path
					d={line(row, one.lane, into)}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					opacity={inkBetween(row, into)}
				/>
			{/each}
			{#if one.older}
				<path
					d="M {x(one.lane)} {y(row)} L {x(one.lane)} {height}"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					opacity={ink(versions[row].id)}
				/>
			{/if}
		{/each}
		{#each drawn as one, row (versions[row].id)}
			{#if collapsed && versions[row].parents.length > 1}
				<circle
					cx={x(one.lane)}
					cy={y(row)}
					r={DOT + 2.5}
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					opacity={ink(versions[row].id)}
				/>
			{/if}
			<circle
				cx={x(one.lane)}
				cy={y(row)}
				r={DOT}
				fill="currentColor"
				opacity={ink(versions[row].id)}
			/>
		{/each}
	</svg>
	<ul aria-label="The history">
		{#each versions as version, row (version.id)}
			<li style="height: {ROW}px" data-version={version.id} data-lane={drawn[row]?.lane ?? 0}>
				<button
					type="button"
					class="flex h-full w-full flex-col justify-center rounded-md pr-2 text-left hover:bg-muted"
					style="padding-left: {width + 6}px"
					onclick={() => onOpen(version.id)}
				>
					<span class="flex min-w-0 items-baseline gap-1.5">
						{#each version.refs as ref (ref)}
							<span
								class="shrink-0 rounded-full border border-border px-1.5 py-px text-[0.6875rem] text-muted-foreground"
							>
								{ref}
							</span>
						{/each}
						<span class="min-w-0 truncate text-sm">{version.message || 'A version'}</span>
					</span>
					<span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
						{#if version.signed}
							<Check class="size-3 shrink-0" aria-hidden="true" />
							<span class="sr-only">Signed.</span>
						{:else if signs}
							<span class="shrink-0">Kept unsigned ·</span>
						{/if}
						{version.when}{version.author ? ` · ${version.author}` : ''}
					</span>
				</button>
			</li>
		{/each}
	</ul>
</div>
{#if older}
	<Button variant="ghost" class="h-9 w-full rounded-full" disabled={busy} onclick={onOlder}>
		Older versions
	</Button>
{/if}
