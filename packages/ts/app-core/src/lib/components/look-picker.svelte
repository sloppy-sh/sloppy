<script lang="ts">
	// Where somebody chooses the look the app wears — DESIGN.md § "The look".
	// Sloppy's own five and every look carried as data stand in one list, because
	// choosing a palette is one choice.
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import {
		BASE_KEYS,
		cn,
		dressed,
		type Scheme,
		type SchemeDressing,
		schemes,
		scrollFade
	} from '@sloppy/ui';
	import { Input } from '@sloppy/ui/input';
	import { onMount } from 'svelte';
	import { BUILT_IN_LOOKS, type BuiltInLook, LOOK_LABELS, prefs } from '../stores/prefs.svelte.js';

	interface Offer {
		scheme: Scheme;
		dressing: SchemeDressing;
	}

	/** How many of the collection's rows stand at once. It is five hundred looks
	 *  and a phone draws every row it is given, so past this the search is the way
	 *  through. */
	const MOST = 60;

	/** What each of Sloppy's own looks shows of itself: its page, a quiet surface
	 *  on it, its accent and its ink. A look block in `app.css` only ever applies
	 *  to `<html>`, so a swatch cannot read one off the stylesheet — and
	 *  `look-picker.test.ts` holds these four to what that block declares. */
	const OWN_PALETTE: Record<BuiltInLook, readonly string[]> = {
		paper: [
			'oklch(0.972 0.006 85)',
			'oklch(0.937 0.008 85)',
			'oklch(0.52 0.14 265)',
			'oklch(0.26 0.015 70)'
		],
		graphite: [
			'oklch(0.215 0.008 260)',
			'oklch(0.25 0.008 260)',
			'oklch(0.62 0.14 265)',
			'oklch(0.905 0.006 250)'
		],
		light: ['oklch(1 0 0)', 'oklch(0.965 0 0)', 'oklch(0.52 0.14 265)', 'oklch(0.145 0 0)'],
		dark: ['oklch(0.145 0 0)', 'oklch(0.18 0 0)', 'oklch(0.62 0.14 265)', 'oklch(0.985 0 0)'],
		contrast: ['oklch(0.99 0 0)', 'oklch(0.955 0 0)', 'oklch(0.52 0.14 265)', 'oklch(0.13 0 0)']
	};

	/** Which key each arrow takes the focus to, given where it stands and the
	 *  last row there is. */
	const MOVES: Record<string, (at: number, last: number) => number> = {
		ArrowDown: (at) => at + 1,
		ArrowRight: (at) => at + 1,
		ArrowUp: (at) => at - 1,
		ArrowLeft: (at) => at - 1,
		Home: () => 0,
		End: (_, last) => last
	};

	let open = $state(false);
	let offered = $state.raw<Offer[] | null>(null);
	let held = $state.raw<Offer | null>(null);
	let unread = $state(false);
	let typed = $state('');
	let onTab = $state<string | null>(null);
	let group = $state<HTMLElement | null>(null);

	const chosen = $derived(prefs.current.look);
	const wearing = $derived(held !== null && held.scheme.slug === chosen ? held : null);
	/** What the control under the rows says: the look carried as data that is on,
	 *  or the way to the rest of them — which is also what it says in the moment
	 *  before a saved look resolves to a name of its own. */
	const saying = $derived(wearing === null ? 'More looks' : wearing.scheme.name);
	const matching = $derived.by(() => {
		const all = offered ?? [];
		const needle = typed.trim().toLowerCase();
		if (needle === '') return all;
		return all.filter(
			({ scheme }) =>
				scheme.name.toLowerCase().includes(needle) || scheme.author.toLowerCase().includes(needle)
		);
	});
	const shown = $derived.by(() => {
		if (matching.length <= MOST) return matching;
		const head = matching.slice(0, MOST);
		if (head.some(({ scheme }) => scheme.slug === chosen)) return head;
		const worn = matching.find(({ scheme }) => scheme.slug === chosen);
		return worn === undefined ? head : [worn, ...head.slice(0, MOST - 1)];
	});
	const more = $derived(matching.length - shown.length);
	const keys = $derived([
		...BUILT_IN_LOOKS,
		...(open ? shown.map(({ scheme }) => scheme.slug) : [])
	]);
	/** The group's one tab stop: where the keyboard was last taken, else the row
	 *  being worn, else the first of Sloppy's own. */
	const stop = $derived.by(() => {
		if (onTab !== null && keys.includes(onTab)) return onTab;
		return keys.includes(chosen) ? chosen : keys[0];
	});

	onMount(() => {
		void sayWhatIsOn();
	});

	/** The collection, or null where it could not be read. */
	async function read(): Promise<readonly Scheme[] | null> {
		const collection = await schemes().catch(() => null);
		unread = collection === null;
		return collection;
	}

	/** The look carried as data that is on, resolved to its name and its paint —
	 *  and a saved one this collection cannot dress stood down to one of Sloppy's
	 *  own, on the ground it was already standing on. A look of somebody's own is
	 *  named by no collection and is theirs to take off in Your own look, so it
	 *  stands. */
	async function sayWhatIsOn(): Promise<void> {
		const slug = prefs.current.look;
		if (BUILT_IN_LOOKS.some((one) => one === slug)) return;
		const collection = await read();
		if (collection === null) return;
		const scheme = collection.find((one) => one.slug === slug);
		const dressing = scheme === undefined ? null : dressed(scheme);
		if (scheme === undefined || dressing === null) {
			if (prefs.current.ownLook !== slug) prefs.setLook(null, prefs.isDark ? 'graphite' : 'paper');
			return;
		}
		held = { scheme, dressing };
		// Written over whatever paint was already in hand, not only where there was
		// none: a copy an earlier build cached carries fewer of the palette's
		// tokens, and the ones it misses would be left to the stylesheet.
		prefs.setLook(dressing, slug);
	}

	function toggle(): void {
		if (open) {
			open = false;
			return;
		}
		open = true;
		void offer();
	}

	async function offer(): Promise<void> {
		if (offered !== null) return;
		const collection = await read();
		if (collection === null) return;
		offered = collection.flatMap((scheme) => {
			const dressing = dressed(scheme);
			return dressing === null ? [] : [{ scheme, dressing }];
		});
	}

	function wear(key: string): void {
		onTab = key;
		if (BUILT_IN_LOOKS.some((one) => one === key)) {
			prefs.setLook(null, key);
			return;
		}
		const offer =
			held !== null && held.scheme.slug === key
				? held
				: (offered ?? []).find(({ scheme }) => scheme.slug === key);
		if (offer === undefined) return;
		held = offer;
		prefs.setLook(offer.dressing, offer.scheme.slug);
	}

	function land(key: string): void {
		onTab = key;
		group?.querySelector<HTMLElement>(`[data-row='${key}']`)?.focus();
	}

	function onkey(event: KeyboardEvent, key: string): void {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			wear(key);
			return;
		}
		const move = MOVES[event.key];
		if (move === undefined) return;
		event.preventDefault();
		const last = keys.length - 1;
		land(keys[Math.min(last, Math.max(0, move(keys.indexOf(key), last)))]);
	}

	function look(on: boolean): string {
		return cn(
			'flex min-h-control w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none',
			on ? 'border-primary text-foreground' : 'border-border bg-card text-muted-foreground'
		);
	}

	/** The sixteen a look carried as data shows of itself, in the collection's own
	 *  order. */
	function sixteen(scheme: Scheme): string[] {
		return BASE_KEYS.map((key) => scheme.palette[key]);
	}
</script>

{#snippet band(colours: readonly string[])}
	<span class="flex h-6 w-32 shrink-0 overflow-hidden rounded-sm" aria-hidden="true">
		{#each colours as colour, at (at)}
			<span class="flex-1" style="background-color: {colour}"></span>
		{/each}
	</span>
{/snippet}

{#snippet row(key: string, name: string, author: string, colours: readonly string[])}
	<button
		type="button"
		role="radio"
		aria-checked={chosen === key}
		tabindex={stop === key ? 0 : -1}
		data-row={key}
		class={look(chosen === key)}
		onclick={() => wear(key)}
		onkeydown={(event) => onkey(event, key)}
	>
		{@render band(colours)}
		<span class="min-w-0 flex-1">
			<span class="block truncate">{name}</span>
			{#if author !== ''}
				<span class="block truncate text-xs text-muted-foreground">{author}</span>
			{/if}
		</span>
	</button>
{/snippet}

<fieldset class="min-w-0 space-y-3">
	<legend class="text-sm font-medium">Look</legend>
	<p class="text-xs text-muted-foreground">
		Every colour the app is drawn in: the surfaces, the ink and the accent. Your style, faces and
		spacing stay as you set them.
	</p>

	{#if open && !unread}
		<Input type="search" bind:value={typed} aria-label="Find a look" placeholder="Find a look" />
	{/if}

	<div
		role="radiogroup"
		aria-label="Look"
		bind:this={group}
		class="max-h-80 min-w-0 space-y-1 overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
		{@attach scrollFade('y')}
	>
		{#each BUILT_IN_LOOKS as built (built)}
			{@render row(built, LOOK_LABELS[built], '', OWN_PALETTE[built])}
		{/each}

		{#if open}
			{#each shown as { scheme } (scheme.slug)}
				{@render row(scheme.slug, scheme.name, scheme.author, sixteen(scheme))}
			{/each}
		{/if}
	</div>

	<button
		type="button"
		aria-expanded={open}
		aria-label={wearing === null ? saying : `Look: ${saying}`}
		class={look(wearing !== null)}
		onclick={toggle}
	>
		{#if wearing !== null}{@render band(sixteen(wearing.scheme))}{/if}
		<span class="min-w-0 flex-1 truncate text-foreground">{saying}</span>
		<ChevronDown
			class={cn(
				'size-4 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none',
				open && 'rotate-180'
			)}
		/>
	</button>

	{#if open}
		{#if unread}
			<p class="text-sm text-muted-foreground">The looks could not be loaded. Try again later.</p>
		{:else}
			{#if offered !== null && matching.length === 0}
				<p class="text-sm text-muted-foreground">
					Nothing here is called that, or it would not be readable.
				</p>
			{/if}
			{#if more > 0}
				<p class="text-xs text-muted-foreground">{more} more — keep typing</p>
			{/if}
		{/if}
	{/if}
</fieldset>
