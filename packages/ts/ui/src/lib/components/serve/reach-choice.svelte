<script lang="ts">
	// How far a desk can be reached, each choice with what it means for what
	// leaves the device.
	import type { ServeReach } from '@sloppy/types';
	import { cn } from '$lib/utils.js';

	let {
		reach,
		disabled = false,
		onpick,
		class: className
	}: {
		reach: ServeReach;
		disabled?: boolean;
		onpick: (reach: ServeReach) => void;
		class?: string;
	} = $props();

	const CHOICES: { reach: ServeReach; name: string; says: string }[] = [
		{
			reach: 'local',
			name: 'This network',
			says: 'Only a headset on the same network finds this desk, and nothing leaves it.'
		},
		{
			reach: 'anywhere',
			name: 'Anywhere',
			says: 'A headset on any network reaches this desk through a relay. What passes between them is encrypted end to end: the relay sees that the two talked, never what. With a public relay, where this desk can be reached is listed publicly, though not under its name; a relay of your own lists nothing.'
		}
	];
</script>

<fieldset class={cn('space-y-2', className)} {disabled}>
	<legend class="mb-2 text-sm font-medium">Reach</legend>
	{#each CHOICES as choice (choice.reach)}
		<label class={cn('block', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
			<input
				type="radio"
				name="serve-reach"
				value={choice.reach}
				checked={reach === choice.reach}
				onchange={() => onpick(choice.reach)}
				class="peer sr-only"
			/>
			<span
				class="block space-y-1 rounded-md border border-border bg-card px-4 py-3 transition-colors duration-150 ease-out peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none"
			>
				<span class="block text-sm text-foreground">{choice.name}</span>
				<span class="block text-xs text-muted-foreground">{choice.says}</span>
			</span>
		</label>
	{/each}
</fieldset>
