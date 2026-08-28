<script lang="ts">
	// Tagging by typing. DESIGN.md § Forms: nothing is declared first and nothing
	// is chosen from a list the person had to build — what is already in the
	// graph completes as they type, and everything else is just a word.
	import X from '@lucide/svelte/icons/x';
	import { type Tag, TagSchema, TagsSchema } from '@sloppy/types';
	import { cn } from '$lib/utils.js';

	let {
		tags,
		suggestions = [],
		onchange,
		label = 'Tags',
		placeholder = 'Add a tag',
		refused = null
	}: {
		tags: readonly Tag[];
		/** Tags already in the graph, most-used first. */
		suggestions?: readonly Tag[];
		/** The WHOLE set. Rejecting restores the chips, so throw rather than swallow. */
		onchange: (tags: Tag[]) => Promise<void> | void;
		label?: string;
		placeholder?: string;
		/** What to say when {@link onchange} rejected without words of its own. */
		refused?: string | null;
	} = $props();

	const listId = $props.id();

	let typed = $state('');
	/** What the reader asked for, while it is on its way to the server. */
	let pending = $state<Tag[] | null>(null);
	let problem = $state<string | null>(null);
	let active = $state(0);
	let dismissed = $state(false);
	let asked = 0;

	const shown = $derived(pending ?? tags);

	const needle = $derived(typed.trim().toLowerCase());
	const SHOWN = 8;
	const matches = $derived.by(() => {
		if (dismissed || !needle) return [];
		const already = new Set(shown);
		return suggestions
			.filter((tag) => !already.has(tag) && tag.includes(needle) && tag !== needle)
			.slice(0, SHOWN);
	});

	$effect(() => {
		// Re-derives with the list, so the caret never points past the last row.
		if (active >= matches.length) active = 0;
	});

	async function save(next: Tag[]): Promise<void> {
		const mine = ++asked;
		pending = next;
		problem = null;
		try {
			await onchange(next);
		} catch {
			problem = refused ?? 'Sloppy could not save that. Try again in a moment.';
		} finally {
			// A second change made while this one was in flight owns the chips now.
			if (mine === asked) pending = null;
		}
	}

	/** Through the schema the API validates against, so both say the same thing. */
	async function add(text: string): Promise<void> {
		const one = TagSchema.safeParse(text);
		if (!one.success) {
			problem = one.error.issues[0].message;
			return;
		}
		typed = '';
		if (shown.includes(one.data)) return;
		const whole = TagsSchema.safeParse([...shown, one.data]);
		if (!whole.success) {
			problem = whole.error.issues[0].message;
			return;
		}
		await save(whole.data);
	}

	async function remove(tag: Tag): Promise<void> {
		await save(shown.filter((held) => held !== tag));
	}

	// Blur lands before the click that caused it, so committing what is in the
	// field straight away turns a tapped suggestion into two tags — the
	// half-typed one and the one they picked. `add` empties the field first, so a
	// frame later there is nothing left to commit.
	function commitOnBlur(): void {
		requestAnimationFrame(() => {
			if (typed.trim() !== '') void add(typed);
		});
	}

	function onkeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') {
			// A tag never contains a space, so the space bar is a second Enter and
			// two words typed in a row become two tags rather than one refusal.
			if (typed.trim() === '') return;
			event.preventDefault();
			void add(matches[active] ?? typed);
			return;
		}
		if (event.key === 'Backspace' && typed === '' && shown.length > 0) {
			event.preventDefault();
			void remove(shown[shown.length - 1]);
			return;
		}
		if (event.key === 'Escape' && matches.length > 0) {
			event.preventDefault();
			dismissed = true;
			return;
		}
		if (matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % matches.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + matches.length) % matches.length;
		}
	}
</script>

<div class="space-y-2">
	<!-- A `for=` would put the chips' remove buttons inside the input's label;
	     the field points back at this with `aria-labelledby` instead. -->
	<span id="{listId}-label" class="block text-sm font-medium">{label}</span>

	<div
		class="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
	>
		{#each shown as tag (tag)}
			<span
				class="inline-flex min-h-9 items-center gap-1 rounded-full border border-border pl-3 text-sm"
			>
				{tag}
				<button
					type="button"
					aria-label="Remove {tag}"
					onclick={() => void remove(tag)}
					class="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 ease-out hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
				>
					<X class="size-3.5" />
				</button>
			</span>
		{/each}

		<input
			bind:value={typed}
			{onkeydown}
			oninput={() => (dismissed = false)}
			onblur={commitOnBlur}
			type="text"
			role="combobox"
			autocapitalize="none"
			autocomplete="off"
			spellcheck="false"
			aria-labelledby="{listId}-label"
			aria-controls={listId}
			aria-expanded={matches.length > 0}
			aria-activedescendant={matches.length > 0 ? `${listId}-${active}` : undefined}
			{placeholder}
			class="min-h-9 min-w-32 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
		/>
	</div>

	<ul id={listId} role="listbox" aria-labelledby="{listId}-label" class:hidden={!matches.length}>
		{#each matches as match, at (match)}
			<li
				id="{listId}-{at}"
				role="option"
				aria-selected={at === active}
				class={cn('rounded-md', at === active && 'bg-muted/60')}
			>
				<button
					type="button"
					tabindex="-1"
					onclick={() => void add(match)}
					class="flex min-h-11 w-full items-center px-2 text-left text-sm"
				>
					{match}
				</button>
			</li>
		{/each}
	</ul>

	{#if problem}
		<p class="text-sm text-destructive" role="alert">{problem}</p>
	{/if}
</div>
