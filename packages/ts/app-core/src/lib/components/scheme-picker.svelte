<script lang="ts">
	// The schemes a person can dress the app in, as its own fieldset beside the
	// Theme pills — DESIGN.md § Schemes. It reads prefs itself, so it takes
	// nothing; it stands closed until somebody asks for the collection.
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
	import { prefs } from '../stores/prefs.svelte.js';

	interface Offer {
		scheme: Scheme;
		dressing: SchemeDressing;
	}

	/** How many rows stand at once. The collection is five hundred schemes and a
	 *  phone draws every row it is given, so past this the search is the way
	 *  through. */
	const MOST = 60;
	/** What the row for no scheme at all answers to among the slugs. */
	const NONE = 'none';

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

	const chosen = $derived(prefs.current.scheme);
	const wearing = $derived(held !== null && held.scheme.slug === chosen ? held : null);
	/** What the closed row says: the scheme's name, None where a theme is, and
	 *  nothing at all in the moment before a saved look resolves to its name. */
	const saying = $derived(wearing?.scheme.name ?? (chosen === null ? 'None' : ''));
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
		if (chosen === null || head.some(({ scheme }) => scheme.slug === chosen)) return head;
		const worn = matching.find(({ scheme }) => scheme.slug === chosen);
		return worn === undefined ? head : [worn, ...head.slice(0, MOST - 1)];
	});
	const more = $derived(matching.length - shown.length);
	const keys = $derived([NONE, ...shown.map(({ scheme }) => scheme.slug)]);
	/** The group's one tab stop: where the keyboard was last taken, else the row
	 *  being worn, else None. */
	const stop = $derived.by(() => {
		if (onTab !== null && keys.includes(onTab)) return onTab;
		return chosen !== null && keys.includes(chosen) ? chosen : NONE;
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

	/** What the closed row says, dressed on its own — and a saved look the
	 *  collection cannot dress stood down, since the theme is what is left. */
	async function sayWhatIsOn(): Promise<void> {
		const slug = prefs.current.scheme;
		if (slug === null) return;
		const collection = await read();
		if (collection === null) return;
		const scheme = collection.find((one) => one.slug === slug);
		const dressing = scheme === undefined ? null : dressed(scheme);
		if (scheme === undefined || dressing === null) {
			prefs.setScheme(null);
			return;
		}
		held = { scheme, dressing };
		if (prefs.dressing === null) prefs.setScheme(dressing);
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
		if (key === NONE) {
			prefs.setScheme(null);
			return;
		}
		const offer = (offered ?? []).find(({ scheme }) => scheme.slug === key);
		if (offer === undefined) return;
		held = offer;
		prefs.setScheme(offer.dressing);
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
</script>

{#snippet strip(scheme: Scheme)}
	<span class="flex h-6 w-32 shrink-0 overflow-hidden rounded-sm" aria-hidden="true">
		{#each BASE_KEYS as key (key)}
			<span class="w-2 shrink-0" style="background-color: {scheme.palette[key]}"></span>
		{/each}
	</span>
{/snippet}

<fieldset class="min-w-0 space-y-3">
	<legend class="text-sm font-medium">Scheme</legend>
	<p class="text-xs text-muted-foreground">
		A palette somebody else wrote, in place of a theme. Your accent, style, face and spacing stay as
		you set them.
	</p>

	<button
		type="button"
		aria-expanded={open}
		aria-label={saying === '' ? 'Scheme' : `Scheme: ${saying}`}
		class={look(false)}
		onclick={toggle}
	>
		{#if wearing}{@render strip(wearing.scheme)}{/if}
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
			<p class="text-sm text-muted-foreground">The schemes could not be loaded. Try again later.</p>
		{:else}
			<Input
				type="search"
				bind:value={typed}
				aria-label="Find a scheme"
				placeholder="Find a scheme"
			/>

			<div
				role="radiogroup"
				aria-label="Scheme"
				bind:this={group}
				class="max-h-80 min-w-0 space-y-1 overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
				{@attach scrollFade('y')}
			>
				<button
					type="button"
					role="radio"
					aria-checked={chosen === null}
					tabindex={stop === NONE ? 0 : -1}
					data-row={NONE}
					class={look(chosen === null)}
					onclick={() => wear(NONE)}
					onkeydown={(event) => onkey(event, NONE)}
				>
					<span class="min-w-0 flex-1 truncate">None</span>
				</button>

				{#each shown as { scheme } (scheme.slug)}
					<button
						type="button"
						role="radio"
						aria-checked={chosen === scheme.slug}
						tabindex={stop === scheme.slug ? 0 : -1}
						data-row={scheme.slug}
						class={look(chosen === scheme.slug)}
						onclick={() => wear(scheme.slug)}
						onkeydown={(event) => onkey(event, scheme.slug)}
					>
						{@render strip(scheme)}
						<span class="min-w-0 flex-1">
							<span class="block truncate">{scheme.name}</span>
							{#if scheme.author !== ''}
								<span class="block truncate text-xs text-muted-foreground">{scheme.author}</span>
							{/if}
						</span>
					</button>
				{/each}
			</div>

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
