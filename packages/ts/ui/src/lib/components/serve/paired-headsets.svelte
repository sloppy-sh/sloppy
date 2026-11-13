<script lang="ts">
	// The headsets a desk lets back in without a code, each with a way to forget it.
	import type { PairedHeadset } from '@sloppy/types';
	import { cn } from '$lib/utils.js';
	import { Button } from '../ui/button/index.js';

	let {
		paired,
		forgetting = null,
		onforget,
		class: className
	}: {
		paired: PairedHeadset[];
		/** The id being forgotten now. */
		forgetting?: string | null;
		onforget: (id: string) => void;
		class?: string;
	} = $props();

	const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
</script>

{#if paired.length === 0}
	<p class={cn('text-sm text-muted-foreground', className)}>No headset has paired yet.</p>
{:else}
	<ul class={cn('divide-y divide-border', className)}>
		{#each paired as headset (headset.id)}
			<li class="flex min-h-14 items-center justify-between gap-3 py-2">
				<div class="min-w-0">
					<p class="truncate text-sm text-foreground">{headset.name ?? 'A headset'}</p>
					<p class="text-xs text-muted-foreground">
						Paired {when.format(new Date(headset.paired_at))}
					</p>
				</div>
				<Button
					variant="ghost"
					class="h-control shrink-0"
					disabled={forgetting === headset.id}
					aria-busy={forgetting === headset.id}
					aria-label="Forget {headset.name ?? 'this headset'}"
					onclick={() => onforget(headset.id)}
				>
					Forget
				</Button>
			</li>
		{/each}
	</ul>
{/if}
