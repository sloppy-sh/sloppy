<script lang="ts" module>
	import type { Tag } from '@sloppy/types';

	/** Enough of a note to know whether you want it open. */
	export interface PreviewedNote {
		address: string;
		title: string;
		/** Every tag the MARK stands for, which on a mega-node is the subtree's. */
		tags: readonly Tag[];
		/** Its author gave the mark a picture. */
		picture: boolean;
		/** Notes folded into the mark: 0 unless it is a mega-node. */
		folded: number;
	}
</script>

<script lang="ts">
	// What a mark is, for a reader whose pointer has come to rest on it. It is
	// placed beside the mark rather than under the pointer, and it takes no
	// events: everything in it is reachable by opening the note, so a canvas with
	// no pointer on it loses nothing.
	import ImageIcon from '@lucide/svelte/icons/image';
	import { assignTagHueSlots } from '@sloppy/types';

	let {
		at,
		note,
		selected
	}: {
		/** The mark's centre in viewport coordinates and its drawn radius; null is
		 *  nothing to preview. */
		at: { clientX: number; clientY: number; radius: number } | null;
		/** Absent where the note is not in hand, which draws nothing. */
		note: PreviewedNote | undefined;
		/** The reader's tags, in selection order — the order the hues go out in. */
		selected: readonly Tag[];
	} = $props();

	const WIDTH = 264;
	/** Between the mark and the card, and between the card and the screen edge. */
	const GAP = 12;
	const EDGE = 8;
	/** More tags than a glance can carry; the rest are counted. */
	const SHOWN = 5;

	const slots = $derived(assignTagHueSlots(selected));

	const place = $derived.by(() => {
		if (!at || !note) return null;
		const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
		const room = window.innerWidth - EDGE - width;
		const right = at.clientX + at.radius + GAP;
		const left = at.clientX - at.radius - GAP - width;
		// Beside the mark on whichever side has room for it, and above or below it
		// where neither has — a window narrower than the card and the mark together
		// would otherwise clamp the card back over the thing it is about.
		const aside = right <= room ? right : left >= EDGE ? left : null;
		// Anchored by whichever edge it grows away from, so it never has to be
		// measured to be placed and never lands twice.
		const upward = at.clientY > window.innerHeight / 2;
		const from = upward ? window.innerHeight - at.clientY : at.clientY;
		return {
			width,
			left: aside ?? Math.max(EDGE, Math.min(at.clientX - width / 2, room)),
			side: upward ? 'bottom' : 'top',
			from: aside === null ? from + at.radius + GAP : from
		};
	});

	/** Selected first, in selection order — a mark can stand for more tags than
	 *  the card has room for, and the ones answering the reader's question are
	 *  the ones it must not run out of room for. */
	const order = $derived.by(() => {
		const tags = note?.tags ?? [];
		const lit = [...slots.keys()].filter((tag) => tags.includes(tag));
		return [...lit, ...tags.filter((tag) => !slots.has(tag))];
	});
	const shown = $derived(order.slice(0, SHOWN));
	const rest = $derived(order.length - shown.length);
</script>

{#if place && note}
	<div
		aria-hidden="true"
		class="pointer-events-none fixed z-30 rounded-xl border bg-popover/95 px-3 py-2 text-popover-foreground shadow-md backdrop-blur motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0"
		style="left: {place.left}px; {place.side}: {place.from}px; width: {place.width}px"
	>
		<div class="flex items-center gap-2">
			<span class="min-w-0 truncate address text-xs">{note.address}</span>
			{#if note.folded > 0}
				<span class="shrink-0 text-xs text-muted-foreground">+{note.folded} folded</span>
			{/if}
			{#if note.picture}
				<ImageIcon class="ms-auto size-3.5 shrink-0 text-muted-foreground" />
			{/if}
		</div>

		{#if note.title.trim() !== ''}
			<p class="mt-1 line-clamp-3 text-sm leading-snug">{note.title}</p>
		{/if}

		{#if order.length > 0}
			<div class="mt-2 flex flex-wrap items-center gap-1.5">
				<!-- The rail's own language for a tag, so the legend and the card
				     cannot disagree about which hue answers which question. -->
				{#each shown as tag (tag)}
					{@const slot = slots.get(tag)}
					<span
						style={slot === undefined ? undefined : `border-color: var(--facet-${slot})`}
						class="inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs {slot ===
						undefined
							? 'border-transparent bg-muted text-muted-foreground'
							: 'text-foreground'}"
					>
						{#if slot !== undefined}
							<span
								class="size-2 shrink-0 rounded-full"
								style="background-color: var(--facet-{slot})"
							></span>
						{/if}
						{tag}
					</span>
				{/each}
				{#if rest > 0}
					<span class="text-xs text-muted-foreground">+{rest}</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}
