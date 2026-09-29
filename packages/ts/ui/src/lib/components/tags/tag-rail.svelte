<script lang="ts" module>
	/** How the tags a reader has not selected are laid out: by how many notes
	 *  carry each, or by name. */
	export type TagOrder = 'count' | 'name';
</script>

<script lang="ts">
	// The question the reader asks the canvas, and the legend for its answer.
	// DESIGN.md § "Hue — the tags you selected, and only those": selected tags
	// lead, in the order they were selected, because that order is what hands out
	// the hues. One ordering, two presentations — along the chrome over the
	// canvas, and down the sidebar beside it (DESIGN.md § Layout).
	import ArrowDown10 from '@lucide/svelte/icons/arrow-down-1-0';
	import ArrowDownAZ from '@lucide/svelte/icons/arrow-down-a-z';
	import Search from '@lucide/svelte/icons/search';
	import { assignTagHueSlots, type Tag, type TagCount } from '@sloppy/types';
	import { tick } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { cn } from '$lib/utils.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';

	let {
		tags,
		selected,
		onselect,
		stacked = false,
		order = 'count',
		onorder
	}: {
		/** Every tag the reader has used, most-used first. */
		tags: readonly TagCount[];
		/** In selection order. */
		selected: readonly Tag[];
		onselect: (tags: Tag[]) => void;
		/** Down a column that scrolls vertically, rather than along a row. */
		stacked?: boolean;
		/** How the rest are laid out down a column; a row keeps most-used first. */
		order?: TagOrder;
		/** Absent is a column with no say in its order. */
		onorder?: (order: TagOrder) => void;
	} = $props();

	const slots = $derived(assignTagHueSlots(selected));
	const counts = $derived(new Map(tags.map((entry) => [entry.tag, entry.notes])));

	/** Chips past which scrolling the rail costs more than typing the word. */
	const CROWDED = 12;
	let typed = $state('');
	let typing = $state(false);
	let field = $state<HTMLInputElement | null>(null);
	let group = $state<HTMLElement | null>(null);
	const offered = $derived(tags.length > CROWDED);
	/** A column has a head to keep the field in; a row has to be asked for it,
	 *  and only once there are enough chips to make typing the shorter way. */
	const asField = $derived(stacked || (offered && typing));
	const needle = $derived(asField ? typed.trim().toLowerCase() : '');

	/** What the chips are, for a reader who is not looking at them. */
	const says = $derived(selected.length > 1 ? 'Notes with any of these' : 'Tags');

	/** The rest, as the read ordered them — most-used first — or by name. */
	const rest = $derived.by(() => {
		const held = tags
			.map((entry) => entry.tag)
			.filter((tag) => !slots.has(tag) && (needle === '' || tag.includes(needle)));
		return stacked && order === 'name' ? [...held].sort((a, b) => a.localeCompare(b)) : held;
	});
	/** Selected first, in selection order, whatever the order of the rest: the
	 *  canvas is drawing the selection's hues, so the legend holds them whatever
	 *  is typed, and only the tail narrows. */
	const shown = $derived([...selected, ...rest]);
	const nothingMatched = $derived(needle !== '' && !shown.some((tag) => tag.includes(needle)));

	let rail = $state<HTMLElement | null>(null);

	async function startTyping(): Promise<void> {
		typing = true;
		await tick();
		field?.focus();
	}

	// The row must not move between a finger going down on a chip and coming up,
	// and WebKit hands that chip no focus for the field's own blur to see it by —
	// so what puts the field away is a pointer landing outside the rail.
	function putAway(event: Event): void {
		if (stacked || !typing || typed.trim() !== '' || group?.contains(event.target as Node)) return;
		typed = '';
		typing = false;
	}

	/** A mouse wheel has no sideways axis, and the rail runs sideways. */
	function wheelAlong(event: WheelEvent): void {
		if (stacked || !rail) return;
		if (event.deltaX !== 0 || event.deltaY === 0) return;
		if (!matchMedia('(pointer: fine)').matches) return;
		const at = rail.scrollLeft;
		const to = Math.max(0, Math.min(rail.scrollWidth - rail.clientWidth, at + event.deltaY));
		if (to === at) return;
		event.preventDefault();
		rail.scrollLeft = to;
	}

	async function toggle(tag: Tag, tapped: HTMLElement): Promise<void> {
		const dropping = slots.has(tag);
		onselect(dropping ? selected.filter((held) => held !== tag) : [...selected, tag]);
		if (dropping) return;
		await tick();
		keepInView(tapped);
	}

	/**
	 * Selecting has moved the tapped chip to the head of the rail, away from
	 * where the finger left it — and the legend is read from that head, so show
	 * as much of it as fits with the tag still on screen.
	 */
	function keepInView(tapped: HTMLElement): void {
		if (!rail) return;
		const box = tapped.getBoundingClientRect();
		const frame = rail.getBoundingClientRect();
		const at = stacked ? rail.scrollTop : rail.scrollLeft;
		const start = (stacked ? box.top - frame.top : box.left - frame.left) + at;
		const end = start + (stacked ? box.height : box.width);
		const seen = stacked ? rail.clientHeight : rail.clientWidth;
		const to = end <= seen ? 0 : Math.min(start, Math.max(at, end - seen));
		if (to === at) return;
		rail.scrollTo(stacked ? { top: to } : { left: to });
	}

	const chip =
		'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
	const quiet = 'border-transparent text-muted-foreground hover:text-foreground';
	const wide = 'w-full justify-start';
</script>

<svelte:window onpointerdowncapture={putAway} />

{#snippet finder()}
	<Input
		bind:ref={field}
		bind:value={typed}
		type="search"
		class={cn('h-11 shrink-0 rounded-full', stacked ? 'min-w-0 flex-1' : 'w-36 sm:w-44')}
		autocapitalize="none"
		autocomplete="off"
		spellcheck="false"
		aria-label="Find a tag"
		placeholder="Find a tag"
		onkeydown={(event) => {
			if (event.key !== 'Escape' || typed === '') return;
			event.stopPropagation();
			typed = '';
		}}
	/>
{/snippet}

<div
	bind:this={group}
	role="group"
	aria-label={says}
	class={cn('flex gap-1.5', stacked ? 'min-h-0 flex-col' : 'items-center')}
>
	<!-- Out of the scroller, so the way to type a tag is where it was left
	     however far along the chips the reader has gone. -->
	{#if asField && stacked}
		<div class="flex shrink-0 items-center gap-1.5">
			{@render finder()}
			{#if onorder}
				<button
					type="button"
					aria-label={order === 'name' ? 'Order by how many notes carry each' : 'Order by name'}
					title={order === 'name' ? 'Order by how many notes carry each' : 'Order by name'}
					onclick={() => onorder?.(order === 'name' ? 'count' : 'name')}
					class={cn(chip, quiet, 'size-11 justify-center border-input px-0')}
				>
					{#if order === 'name'}
						<ArrowDown10 class="size-4" />
					{:else}
						<ArrowDownAZ class="size-4" />
					{/if}
				</button>
			{/if}
		</div>
	{:else if asField}
		{@render finder()}
	{:else if offered}
		<button
			type="button"
			aria-label="Find a tag"
			onclick={() => void startTyping()}
			class={cn(chip, quiet, 'border-input px-3')}
		>
			<Search class="size-4" />
		</button>
	{/if}

	<div
		bind:this={rail}
		onwheel={wheelAlong}
		class={cn(
			'flex min-w-0 gap-1.5',
			stacked
				? 'min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y pe-0.5'
				: 'flex-1 overflow-x-auto scroll-fade-x py-0.5 [scrollbar-width:none]'
		)}
		{@attach scrollFade(stacked ? 'y' : 'x')}
	>
		{#each shown as tag (tag)}
			{@const slot = slots.get(tag)}
			<button
				type="button"
				aria-pressed={slot !== undefined}
				onclick={(event) => void toggle(tag, event.currentTarget)}
				style={slot === undefined ? undefined : `border-color: var(--facet-${slot})`}
				class={cn(chip, slot === undefined ? quiet : 'text-foreground', stacked && wide)}
			>
				{#if slot !== undefined}
					<span
						aria-hidden="true"
						class="size-2.5 shrink-0 rounded-full"
						style="background-color: var(--facet-{slot})"
					></span>
				{/if}
				<span class={cn(stacked && 'min-w-0 truncate')}>{tag}</span>
				{#if slot === undefined}
					<span class={cn('text-xs text-muted-foreground', stacked && 'ms-auto')}
						>{counts.get(tag)?.toLocaleString()}</span
					>
				{/if}
			</button>
		{/each}

		{#if nothingMatched}
			<p
				role="status"
				class="flex min-h-11 shrink-0 items-center px-2 text-sm text-muted-foreground"
			>
				No tag has that in it.
			</p>
		{/if}
	</div>

	{#if selected.length > 0}
		<button
			type="button"
			onclick={() => onselect([])}
			class={cn(chip, quiet, 'border-input px-3', stacked && wide)}
		>
			Clear
		</button>
	{/if}
</div>
