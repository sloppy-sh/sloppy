<script lang="ts">
	// A build is named before it starts, and nothing is kept until it is —
	// DESIGN.md § "A build". Where this machine has no assistant it can run,
	// this is where the act says so.
	import { BUILD_NAME_MAX, BUILD_NAME_NEEDS, buildNameFrom } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { NEEDS_A_PROGRAM } from './build-said.js';

	let {
		open = $bindable(false),
		count,
		reaches = true,
		busy = false,
		says = null,
		taken,
		onName
	}: {
		open?: boolean;
		/** How many notes it would be built from. */
		count: number;
		/** Whether an assistant this machine can run is here. */
		reaches?: boolean;
		busy?: boolean;
		/** Why the last try did not land, in words for the person. */
		says?: string | null;
		/** Whether something here is already called this. */
		taken: (name: string) => boolean;
		onName: (name: string) => void;
	} = $props();

	let typed = $state('');
	let refused = $state<string | null>(null);

	$effect(() => {
		if (!open) {
			typed = '';
			refused = null;
		}
	});

	function name(): void {
		const held = buildNameFrom(typed);
		if (held === undefined) {
			refused = BUILD_NAME_NEEDS;
			return;
		}
		if (taken(held)) {
			refused = `A line of work is already called ${held}. Give the build another name.`;
			return;
		}
		refused = null;
		onName(held);
	}
</script>

<ResponsiveModal
	bind:open
	title={count === 1 ? 'Build this' : `Build these ${count} notes`}
	description={reaches
		? 'Assistants read what these notes say the project is for and write the code that answers them. Nothing of yours changes until you bring it in.'
		: NEEDS_A_PROGRAM}
>
	<div class="flex flex-col gap-3 px-2 pt-4">
		{#if reaches}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					name();
				}}
			>
				<Input
					bind:value={typed}
					maxlength={BUILD_NAME_MAX}
					class="h-control text-sm"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					aria-label="What to call this build"
					placeholder="What you are building"
				/>
				{#if refused ?? says}
					<p class="text-sm text-destructive" role="alert">{refused ?? says}</p>
				{/if}
				<Button type="submit" class="h-control sm:h-9" disabled={busy || typed.trim() === ''}>
					Start the build
				</Button>
			</form>
		{/if}
		<Button variant="ghost" class="h-control sm:h-9" onclick={() => (open = false)}>
			Never mind
		</Button>
	</div>
</ResponsiveModal>
