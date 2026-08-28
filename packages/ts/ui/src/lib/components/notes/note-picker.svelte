<script lang="ts">
	// Choosing a note by looking at the graph rather than by citing it: the tree
	// browses, and the field over it matches on address or title.
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { compareAddresses, type NodeView, type OwnedRef } from '@sloppy/types';
	import { SvelteSet } from 'svelte/reactivity';
	import { cn } from '$lib/utils.js';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		notes,
		title,
		description,
		pickable = () => true,
		onpick
	}: {
		open?: boolean;
		/** The whole graph to browse, in any order; the tree is read off `parent`. */
		notes: readonly NodeView[];
		title: string;
		description?: string;
		/** False for a note the picker shows but does not offer — one already
		 *  chosen, or the one being pointed from. */
		pickable?: (note: NodeView) => boolean;
		onpick: (note: NodeView) => void;
	} = $props();

	const listId = $props.id();

	let typed = $state('');
	const expanded = new SvelteSet<OwnedRef>();

	const byAddress = (a: NodeView, b: NodeView) => compareAddresses(a.address, b.address);

	const children = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt whole by the derived, never mutated after.
		const index = new Map<OwnedRef, NodeView[]>();
		for (const note of notes) {
			if (!note.parent) continue;
			const kin = index.get(note.parent);
			if (kin) kin.push(note);
			else index.set(note.parent, [note]);
		}
		return index;
	});

	const roots = $derived(notes.filter((note) => !note.parent));

	const needle = $derived(typed.trim().toLowerCase());

	/** Address order, which is depth-first, which is the order a branch reads in. */
	const shown = $derived.by(() => {
		if (needle) {
			return [...notes]
				.filter(
					(note) => note.address.startsWith(needle) || note.title.toLowerCase().includes(needle)
				)
				.sort(byAddress);
		}
		const out: NodeView[] = [];
		const walk = (list: NodeView[]) => {
			for (const note of [...list].sort(byAddress)) {
				out.push(note);
				if (expanded.has(note.ref)) walk(children.get(note.ref) ?? []);
			}
		};
		walk(roots);
		return out;
	});

	const SHOWN = 200;

	// Cleared as the sheet opens rather than as it closes, which would empty the
	// list out from under it while it animates away.
	$effect(() => {
		if (open) typed = '';
	});

	function toggle(ref: OwnedRef): void {
		if (expanded.has(ref)) expanded.delete(ref);
		else expanded.add(ref);
	}

	function pick(note: NodeView): void {
		open = false;
		onpick(note);
	}

	// Arrowing down a long branch, rather than tabbing through every row of it.
	function step(event: KeyboardEvent, by: number): void {
		const list = event.currentTarget as HTMLElement;
		const rows = [...list.querySelectorAll<HTMLElement>('[data-note-row]')];
		const at = rows.indexOf(document.activeElement as HTMLElement);
		const next = rows[at < 0 ? (by > 0 ? 0 : rows.length - 1) : at + by];
		if (!next) return;
		event.preventDefault();
		next.focus();
	}
</script>

<ResponsiveModal bind:open {title} {description} class="sm:max-w-lg">
	<div class="flex min-h-0 flex-col gap-2 px-2 pt-4">
		<Input
			bind:value={typed}
			class="h-11 shrink-0"
			placeholder="Title or address"
			aria-label="Narrow this list"
			autocapitalize="none"
			autocomplete="off"
			spellcheck="false"
			onkeydown={(e) => {
				if (e.key !== 'ArrowDown') return;
				e.preventDefault();
				document.getElementById(listId)?.querySelector<HTMLElement>('[data-note-row]')?.focus();
			}}
		/>

		{#if shown.length === 0}
			<p class="px-2 py-8 text-center text-muted-foreground">
				{needle ? 'Nothing here matches that.' : 'There is nothing to point at yet.'}
			</p>
		{:else}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<ul
				id={listId}
				aria-label={title}
				class="max-h-[60vh] min-h-0 space-y-0.5 overflow-y-auto scroll-fade-y sm:max-h-80"
				{@attach scrollFade('y')}
				onkeydown={(e) => {
					if (e.key === 'ArrowDown') step(e, 1);
					else if (e.key === 'ArrowUp') step(e, -1);
				}}
			>
				{#each shown.slice(0, SHOWN) as note (note.ref)}
					{@const kin = children.get(note.ref) ?? []}
					{@const offer = pickable(note)}
					<li
						class="flex items-center gap-1"
						style:padding-left="{needle ? 0 : Math.min(note.depth - 1, 6) * 0.75}rem"
					>
						{#if kin.length > 0 && !needle}
							<button
								type="button"
								data-note-row
								aria-expanded={expanded.has(note.ref)}
								aria-label="{expanded.has(note.ref) ? 'Hide' : 'Show'} what is under {note.address}"
								onclick={() => toggle(note.ref)}
								class="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
							>
								<ChevronRight
									class={cn(
										'size-4 transition-transform duration-150 ease-out motion-reduce:transition-none',
										expanded.has(note.ref) && 'rotate-90'
									)}
								/>
							</button>
						{:else}
							<span class="size-11 shrink-0"></span>
						{/if}

						{#if offer}
							<button
								type="button"
								data-note-row
								onclick={() => pick(note)}
								class="flex min-h-11 min-w-0 flex-1 items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
							>
								<span class="shrink-0 address text-sm text-muted-foreground">{note.address}</span>
								<span class="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
							</button>
						{:else}
							<p
								class="flex min-h-11 min-w-0 flex-1 items-baseline gap-3 px-2 text-muted-foreground/60"
							>
								<span class="shrink-0 address text-sm">{note.address}</span>
								<span class="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			{#if shown.length > SHOWN}
				<p class="shrink-0 px-2 text-xs text-muted-foreground">
					Not everything is here. Type to narrow the list.
				</p>
			{/if}
		{/if}
	</div>
</ResponsiveModal>
