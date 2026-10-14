<script lang="ts">
	// The one thing the canvas has to say about the sets in front of the reader:
	// that the graph carries more tags than can wear a hue at once — DESIGN.md
	// § Hue. Nothing at all otherwise.
	import { DRAWN_SETS_MOST, type GraphArrangement } from '@sloppy/graph';

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
		/** Which reading it stands over, which is what the sets DO there: the one
		 *  draws them as places, the other colours the marks by them. */
		reading: GraphArrangement;
	} = $props();

	const verb = $derived(reading === 'sets' ? 'drawn' : 'coloured');
</script>

{#if tags > DRAWN_SETS_MOST}
	<!-- DESIGN.md § "The four inset vars": it floats over a pannable field, so it
	     clears the system bar and the bar over a chosen set both. -->
	<div
		style="bottom: calc(var(--sysnav-clearance) + var(--chosen-bar-inset-bottom, 0px) + 0.5rem)"
		class="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 sm:px-6"
	>
		<div
			class="pointer-events-auto max-w-full rounded-2xl border bg-card/90 px-3 py-1 shadow-sm backdrop-blur"
		>
			<p class="text-sm text-muted-foreground" role="status">
				{drawn} of the {word(tags)} tags are {verb}. Select tags to choose which.
			</p>
		</div>
	</div>
{/if}
