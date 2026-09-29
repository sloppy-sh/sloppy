<script lang="ts">
	// Picking a note's shape, while picking one is still cheap. Nothing is
	// imposed: the first row is the note as it already stands, and an unfilled
	// section stays an empty section.
	import ResponsiveModal from '../responsive-modal.svelte';
	import { NOTE_TEMPLATES, type NoteTemplate, type TemplateId } from './templates.js';

	let {
		open = $bindable(false),
		onOpenChange,
		suggested = null,
		existing = false,
		onpick
	}: {
		open?: boolean;
		/** For the unbound `open={expr}` pattern; a bound `open` needs nothing. */
		onOpenChange?: (open: boolean) => void;
		/** Offered first, where one shape fits this note's place in the graph. */
		suggested?: TemplateId | null;
		/** The shape goes into a note that is open, not one about to be written. */
		existing?: boolean;
		/** Null is the note as it stands: nothing is written. */
		onpick: (template: NoteTemplate | null) => void;
	} = $props();

	const order = $derived([
		...NOTE_TEMPLATES.filter((template) => template.id === suggested),
		...NOTE_TEMPLATES.filter((template) => template.id !== suggested)
	]);

	const row =
		'flex min-h-control w-full flex-col items-start gap-0.5 rounded-md px-2 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
</script>

<ResponsiveModal
	{open}
	onOpenChange={(v) => {
		open = v;
		onOpenChange?.(v);
	}}
	title={existing ? 'Add a shape' : 'Start from a shape'}
	description={existing
		? 'The sections land under anything already in this note.'
		: 'Sections to fill in, or leave empty.'}
>
	<ul class="space-y-0.5 px-2 pt-4">
		<li>
			<button type="button" class={row} onclick={() => onpick(null)}>
				<span class="font-medium">Just a note</span>
				<span class="text-sm text-muted-foreground">Nothing to fill in.</span>
			</button>
		</li>
		{#each order as template (template.id)}
			<li>
				<button type="button" class={row} onclick={() => onpick(template)}>
					<span class="font-medium">{template.name}</span>
					<span class="text-sm text-pretty text-muted-foreground">
						{template.sections.map((section) => section.heading).join(' · ')}
					</span>
				</button>
			</li>
		{/each}
	</ul>
</ResponsiveModal>
