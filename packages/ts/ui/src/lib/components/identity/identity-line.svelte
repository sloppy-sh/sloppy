<script lang="ts">
	// The identifier a person hands out so somebody can read them, and the way to
	// hand it out on a phone.
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		identity,
		label = 'Copy this identity',
		class: className
	}: {
		identity: string;
		/** What the copy control is called, in the voice of the surface it is on. */
		label?: string;
		class?: string;
	} = $props();

	let copied = $state(false);
	let settling: ReturnType<typeof setTimeout> | undefined;

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(identity);
		} catch {
			// The line beside it is selectable, which is the way out of this.
			return;
		}
		copied = true;
		clearTimeout(settling);
		settling = setTimeout(() => (copied = false), 2000);
	}

	$effect(() => () => clearTimeout(settling));
</script>

<div class={cn('flex items-start gap-2', className)}>
	<p class="min-w-0 flex-1 address text-sm break-all select-text">{identity}</p>
	<Button
		variant="ghost"
		size="icon"
		class="size-9 shrink-0 text-muted-foreground"
		aria-label={label}
		onclick={copy}
	>
		{#if copied}
			<Check class="size-4" />
		{:else}
			<Copy class="size-4" />
		{/if}
	</Button>
</div>
