<script lang="ts">
	// Where the folder stands when it is on a version rather than a line, and the
	// line somebody's writing opened there — DESIGN.md § "The history as a
	// picture". It stands wherever the history does, the column and the sheet
	// alike.
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { graphHistory } from '../stores/history.svelte.js';

	let renaming = $state<string | null>(null);
	/** So a refusal from before the rename was asked for is not read as its
	 *  answer. */
	let tried = $state(false);

	const opened = $derived(graphHistory.openedLine);

	async function rename(): Promise<void> {
		const from = opened;
		const to = renaming?.trim();
		if (from === null || to === undefined || to === '' || to === from) return;
		tried = true;
		if (await graphHistory.renameLine(from, to)) renaming = null;
	}
</script>

{#if graphHistory.standingOn}
	<p class="shrink-0 px-1 text-xs text-muted-foreground" role="status">
		Working on a version, {graphHistory.standingOn}.
	</p>
{/if}

{#if opened !== null}
	<div class="flex shrink-0 flex-col gap-2 px-1">
		<p class="text-xs text-muted-foreground" role="status">
			Your writing opened a new line, {opened}.
		</p>
		{#if renaming === null}
			<Button
				variant="ghost"
				class="h-control self-start text-xs"
				onclick={() => {
					tried = false;
					renaming = opened;
				}}
			>
				Rename
			</Button>
		{:else}
			<div class="flex gap-2">
				<Input
					bind:value={renaming}
					class="h-control flex-1 text-sm"
					autocomplete="off"
					maxlength={128}
					aria-label="What this line is called"
					onkeydown={(event) => {
						if (event.key !== 'Enter') return;
						event.preventDefault();
						void rename();
					}}
				/>
				<Button
					variant="outline"
					class="h-control shrink-0 text-xs"
					disabled={graphHistory.busy}
					onclick={rename}
				>
					Rename it
				</Button>
			</div>
			{#if tried && graphHistory.says}
				<p class="text-sm text-destructive" role="alert">{graphHistory.says}</p>
			{/if}
		{/if}
	</div>
{/if}
