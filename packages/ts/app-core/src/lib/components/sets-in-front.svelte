<script lang="ts">
	// What the tag rail is showing the reader, where the graph carries more tags
	// than can wear a hue at once — DESIGN.md § Hue. Nothing at all otherwise.
	// A popover rather than shadcn's tooltip, which answers hover and focus
	// alone: the phone and the tablet this stands on have no hover, so the words
	// have to come on a tap.
	import Info from '@lucide/svelte/icons/info';
	import { DRAWN_SETS_MOST, type GraphArrangement } from '@sloppy/graph';
	import * as Popover from '@sloppy/ui/popover';

	/** Counts as a reader reads them; past twenty the figure is the quicker
	 *  read. */
	const WORDS = [
		'one',
		'two',
		'three',
		'four',
		'five',
		'six',
		'seven',
		'eight',
		'nine',
		'ten',
		'eleven',
		'twelve',
		'thirteen',
		'fourteen',
		'fifteen',
		'sixteen',
		'seventeen',
		'eighteen',
		'nineteen',
		'twenty'
	];
	const word = (many: number): string => WORDS[many - 1] ?? many.toLocaleString();
	const most = word(DRAWN_SETS_MOST);
	const drawn = most.charAt(0).toUpperCase() + most.slice(1);

	let {
		tags,
		reading
	}: {
		/** How many distinct tags the notes on the canvas carry. */
		tags: number;
		/** Which reading the rail is the legend for, which is what the sets DO
		 *  there: the one draws them as places, the other colours the marks by
		 *  them. */
		reading: GraphArrangement;
	} = $props();

	const verb = $derived(reading === 'sets' ? 'drawn' : 'coloured');
</script>

{#if tags > DRAWN_SETS_MOST}
	<Popover.Root>
		<Popover.Trigger
			aria-label="What these tags are showing"
			class="flex size-control shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		>
			<Info class="size-4" />
		</Popover.Trigger>
		<Popover.Content class="w-64 p-3">
			<p class="text-sm text-muted-foreground">
				{drawn} of the {word(tags)} tags are {verb}. Select tags to choose which.
			</p>
		</Popover.Content>
	</Popover.Root>
{/if}
