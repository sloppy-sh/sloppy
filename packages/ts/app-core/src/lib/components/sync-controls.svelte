<script lang="ts" module>
	/** One place a folder is also kept, as the surface names it. */
	export interface KeptAlso {
		/** What this folder calls it. */
		name: string;
		/** What a person calls it: the host it is at, else the name. */
		at: string;
	}
</script>

<script lang="ts">
	// Where else a folder is kept, and what moves between here and there —
	// DESIGN.md § "The history as a picture".
	import { Button } from '@sloppy/ui/button';
	import * as Select from '@sloppy/ui/select';

	let {
		places,
		chosen = $bindable(''),
		ahead = 0,
		behind = 0,
		busy = false,
		said = null,
		onLook,
		onTakeIn,
		onPutThere
	}: {
		places: readonly KeptAlso[];
		/** Which one the acts are with; the first where nobody has picked. */
		chosen?: string;
		ahead?: number;
		behind?: number;
		busy?: boolean;
		/** What the last of these acts did, or would not do. */
		said?: { words: string; refused: boolean } | null;
		onLook: (name: string) => void;
		onTakeIn: (name: string) => void;
		onPutThere: (name: string) => void;
	} = $props();

	const at = $derived(places.find((one) => one.name === chosen) ?? places[0]);

	const standing = $derived(
		behind > 0 && ahead > 0
			? `${behind} to take in, ${ahead} to put there.`
			: behind > 0
				? `${behind} to take in.`
				: ahead > 0
					? `${ahead} to put there.`
					: ''
	);
</script>

{#if places.length === 0}
	<p class="text-sm text-muted-foreground">
		Your notes are only in this folder. Say where else to keep them in Settings, and you can put
		them there from here.
	</p>
{:else if at}
	<div class="space-y-3">
		{#if places.length > 1}
			<Select.Root type="single" bind:value={chosen}>
				<Select.Trigger class="h-11 w-full" aria-label="Where to">{at.at}</Select.Trigger>
				<Select.Content>
					{#each places as one (one.name)}
						<Select.Item value={one.name} class="min-h-11">{one.at}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{:else}
			<p class="text-sm text-muted-foreground">Also kept on {at.at}.</p>
		{/if}
		{#if standing}
			<p class="text-sm text-muted-foreground">{standing}</p>
		{/if}
		<div class="flex flex-col gap-2 sm:flex-row">
			<Button
				variant="ghost"
				class="h-11 sm:flex-1"
				disabled={busy}
				onclick={() => onLook(at.name)}
			>
				Look for newer versions
			</Button>
			<Button
				variant="outline"
				class="h-11 sm:flex-1"
				disabled={busy}
				onclick={() => onTakeIn(at.name)}
			>
				Take them in
			</Button>
			<Button class="h-11 sm:flex-1" disabled={busy} onclick={() => onPutThere(at.name)}>
				Put yours there
			</Button>
		</div>
		{#if said}
			<p
				class={said.refused ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}
				role={said.refused ? 'alert' : 'status'}
			>
				{said.words}
			</p>
		{/if}
	</div>
{/if}
