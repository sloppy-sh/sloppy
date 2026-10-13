<script lang="ts">
	// A build is named before it starts, and nothing is kept until it is —
	// DESIGN.md § "A build". Where this machine has no assistant it can run,
	// this is where the act says so.
	import { BUILD_NAME_MAX, BUILD_NAME_NEEDS, buildNameFrom } from '@sloppy/types';
	import { ResponsiveModal } from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';

	let {
		open = $bindable(false),
		count,
		assistantSays = null,
		busy = false,
		says = null,
		taken,
		onName
	}: {
		open?: boolean;
		/** How many notes it would be built from. */
		count: number;
		/** Why no build can run here, in words for the person. `null` is a device
		 *  one can run on. */
		assistantSays?: string | null;
		busy?: boolean;
		/** Why the last try did not land, in words for the person. */
		says?: string | null;
		/** Whether something here is already called this. */
		taken: (name: string) => Promise<boolean>;
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

	async function name(): Promise<void> {
		const held = buildNameFrom(typed);
		if (held === undefined) {
			refused = BUILD_NAME_NEEDS;
			return;
		}
		if (await taken(held)) {
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
	description={assistantSays ??
		'Assistants read what these notes say the project is for and write the code that answers them. Nothing of yours changes until you bring it in.'}
>
	<div class="flex flex-col gap-3 px-2 pt-4">
		{#if assistantSays === null}
			<form
				class="flex flex-col gap-3"
				onsubmit={(event) => {
					event.preventDefault();
					void name();
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
