<script lang="ts">
	// The three ways out of writing nobody has kept, in the order and the wording
	// DESIGN.md § "The history as a picture" sets.
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import type { Moving } from './moving.svelte.js';

	let { moving }: { moving: Moving } = $props();
</script>

<ResponsiveModal
	bind:open={moving.asking}
	title="You have writing nobody has kept"
	description={moving.carries
		? 'Keep it as a version first, or bring it with you.'
		: 'Keep it as a version first, or stay where you are.'}
>
	<div class="flex flex-col gap-3 px-2 pt-4">
		<Input
			bind:value={moving.message}
			class="h-control text-sm"
			aria-label="What this version is"
			placeholder="What you did"
		/>
		{#if moving.says}
			<p class="text-sm text-destructive" role="alert">{moving.says}</p>
		{/if}
		<div class="flex flex-col gap-2">
			<Button
				class="h-control sm:h-9"
				disabled={moving.busy || moving.message.trim() === ''}
				onclick={() => void moving.keepFirst()}
			>
				Keep a version first
			</Button>
			{#if moving.carries}
				<Button
					variant="outline"
					class="h-control sm:h-9"
					disabled={moving.busy}
					onclick={() => void moving.bringThem()}
				>
					Bring them with me
				</Button>
			{/if}
			<Button
				variant="ghost"
				class="h-control sm:h-9"
				disabled={moving.busy}
				onclick={() => moving.stay()}
			>
				Stay here
			</Button>
		</div>
	</div>
</ResponsiveModal>
