<script lang="ts">
	// The schemes a person can dress the app in, as its own fieldset beside the
	// Theme pills — DESIGN.md § Schemes. It reads prefs itself, so it takes
	// nothing; it draws its rows once the collection is here.
	import {
		BASE_KEYS,
		cn,
		dress,
		type Scheme,
		type SchemeDressing,
		schemes,
		scrollFade
	} from '@sloppy/ui';
	import { Input } from '@sloppy/ui/input';
	import { prefs } from '../stores/prefs.svelte.js';

	let offered = $state.raw<{ scheme: Scheme; dressing: SchemeDressing }[]>([]);
	let typed = $state('');

	const chosen = $derived(prefs.current.scheme);
	const found = $derived.by(() => {
		const needle = typed.trim().toLowerCase();
		if (needle === '') return offered;
		return offered.filter(
			({ scheme }) =>
				scheme.name.toLowerCase().includes(needle) || scheme.author.toLowerCase().includes(needle)
		);
	});

	$effect(() => {
		void read();
	});

	async function read(): Promise<void> {
		const collection = await schemes().catch(() => []);
		offered = collection.flatMap((scheme) => {
			const dressing = dress(scheme);
			return dressing === null ? [] : [{ scheme, dressing }];
		});
		// A look saved with no paint beside it — the collection is what resolves
		// a slug, and this is where it arrives.
		if (prefs.current.scheme !== null && prefs.dressing === null) {
			const held = offered.find(({ scheme }) => scheme.slug === prefs.current.scheme);
			if (held) prefs.setScheme(held.dressing);
		}
	}

	function row(wearing: boolean): string {
		return cn(
			'flex h-control w-full items-center gap-3 rounded-md border px-3 text-left text-sm transition-colors duration-150 ease-out motion-reduce:transition-none',
			wearing ? 'border-primary text-foreground' : 'border-border bg-card text-muted-foreground'
		);
	}
</script>

<fieldset class="space-y-3">
	<legend class="text-sm font-medium">Scheme</legend>
	<p class="text-xs text-muted-foreground">
		A palette somebody else wrote, in place of a theme. Your accent, style, face and spacing stay as
		you set them.
	</p>

	<Input type="search" bind:value={typed} aria-label="Find a scheme" placeholder="Find a scheme" />

	<div
		class="max-h-80 space-y-1 overflow-y-auto scroll-fade-y [--scroll-fade:1rem]"
		{@attach scrollFade('y')}
	>
		<button
			type="button"
			aria-pressed={chosen === null}
			class={row(chosen === null)}
			onclick={() => prefs.setScheme(null)}
		>
			None
		</button>

		{#each found as { scheme, dressing } (scheme.slug)}
			<button
				type="button"
				aria-pressed={chosen === scheme.slug}
				class={row(chosen === scheme.slug)}
				onclick={() => prefs.setScheme(dressing)}
			>
				<span class="flex h-4 w-24 shrink-0 overflow-hidden rounded-sm" aria-hidden="true">
					{#each BASE_KEYS as key (key)}
						<span class="flex-1" style="background-color: {scheme.palette[key]}"></span>
					{/each}
				</span>
				<span class="min-w-0 flex-1 truncate">{scheme.name}</span>
				{#if scheme.author !== ''}
					<span class="min-w-0 truncate text-right text-xs text-muted-foreground">
						{scheme.author}
					</span>
				{/if}
			</button>
		{/each}

		{#if offered.length > 0 && found.length === 0}
			<p class="px-3 py-2 text-sm text-muted-foreground">Nothing here is called that.</p>
		{/if}
	</div>
</fieldset>
