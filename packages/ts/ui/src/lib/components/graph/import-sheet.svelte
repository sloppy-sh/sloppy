<script lang="ts">
	// What a graph in a file brings with it, said before anything is written.
	import type { ArchivePreview } from '@sloppy/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import ResponsiveModal from '../responsive-modal.svelte';

	let {
		open = $bindable(false),
		onOpenChange,
		preview = null,
		yours = true,
		reading = false,
		busy = false,
		refused = null,
		onimport,
		oncancel
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Null until the file has been read. */
		preview?: ArchivePreview | null;
		/** Whether this identity is the one the graph was written under. */
		yours?: boolean;
		reading?: boolean;
		/** The import is with the server, so the choices stop taking taps. */
		busy?: boolean;
		/** Why it did not land, in words to show. */
		refused?: string | null;
		onimport: () => void;
		oncancel: () => void;
	} = $props();

	function count(n: number, one: string, many: string): string {
		return `${n.toLocaleString()} ${n === 1 ? one : many}`;
	}

	const named = $derived(preview?.name.trim() ?? '');

	const title = $derived(
		preview ? (named ? `Import “${named}”?` : 'Import this graph?') : 'Import a graph'
	);

	const empty = $derived(preview !== null && preview.notes === 0);

	const description = $derived.by(() => {
		if (!preview) return reading ? 'Reading what is in the file…' : undefined;
		if (empty) return 'There is nothing in it to bring in.';
		const notes = count(preview.notes, 'note', 'notes');
		if (preview.pictures === 0) return `${notes} ${preview.notes === 1 ? 'arrives' : 'arrive'}.`;
		return `${notes} and ${count(preview.pictures, 'picture', 'pictures')} arrive.`;
	});

	const landing = $derived(
		empty
			? null
			: preview?.replaces
				? 'You already keep this graph. What is in the file replaces what is here.'
				: 'It arrives as a graph of its own, beside the ones you keep.'
	);

	const keptElsewhere = $derived(preview?.collisions.length ?? 0);

	const emoji = $derived(preview?.missing_emoji ?? []);

	/** `:a:, :b: and 4 more`. */
	function listed(all: readonly string[]): string {
		const shown = all.slice(0, 3).map((code) => `:${code}:`);
		const rest = all.length - shown.length;
		if (rest > 0) shown.push(`${rest} more`);
		if (shown.length < 2) return shown.join('');
		return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
	}
</script>

<ResponsiveModal bind:open {onOpenChange} {title} {description}>
	<div class="space-y-3 px-2 pt-4 pb-2">
		{#if preview}
			{#if landing}
				<p class="px-2 text-sm text-muted-foreground">{landing}</p>
			{/if}

			{#if !yours && !empty}
				<p class="px-2 text-sm text-muted-foreground">
					It was written under another identity. The notes become yours here, and keep the numbers
					they carry.
				</p>
			{/if}

			{#if emoji.length > 0}
				<p class="px-2 text-sm text-muted-foreground">
					{emoji.length === 1
						? `One emoji it was written with cannot come along: ${listed(emoji)}.`
						: `${emoji.length.toLocaleString()} emoji it was written with cannot come along: ${listed(emoji)}.`}
					The notes keep the words they were typed as.
				</p>
			{/if}

			{#if keptElsewhere > 0}
				<p class="px-2 text-sm text-destructive">
					{keptElsewhere === 1
						? 'One of these notes is already in another of your graphs.'
						: `${keptElsewhere.toLocaleString()} of these notes are already in another of your graphs.`}
					Nothing here takes them out of it, so this graph cannot come in.
				</p>
			{/if}
		{/if}

		{#if refused}
			<p class="px-2 text-sm text-destructive" role="alert">{refused}</p>
		{/if}

		{#if preview}
			<Button class="h-11 w-full" disabled={busy || keptElsewhere > 0 || empty} onclick={onimport}>
				Import
			</Button>
		{/if}

		<Button variant="ghost" class="h-11 w-full" disabled={busy} onclick={oncancel}>Cancel</Button>
	</div>
</ResponsiveModal>
