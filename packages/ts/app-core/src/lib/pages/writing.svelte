<script lang="ts">
	// The note that has been asked for and not yet answered, on the same reading
	// surface the note itself opens on. What is typed here is handed to that note
	// the moment it lands — PRODUCT.md § "Capture is one gesture".
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '@sloppy/ui/button';

	let {
		title,
		body,
		numbering,
		refused = null,
		onTitle,
		onBody,
		onCaret,
		onAgain,
		onClose
	}: {
		title: string;
		body: string;
		/** Whether an address is coming with the note; one written on its own
		 *  carries none. */
		numbering: boolean;
		/** Why the note is not written yet, in words already fit to show. */
		refused?: string | null;
		onTitle: (title: string) => void;
		onBody: (body: string) => void;
		/** Which of the two the caret is in, so the note opens where it was left. */
		onCaret: (where: 'title' | 'body') => void;
		/** Ask for the same note again. */
		onAgain: () => void;
		onClose: () => void;
	} = $props();

	let titleField = $state<HTMLTextAreaElement | null>(null);
	let bodyField = $state<HTMLTextAreaElement | null>(null);

	/** A field wraps rather than scrolling out of sight, so the box follows it. */
	function fit(field: HTMLTextAreaElement): void {
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	$effect(() => {
		if (titleField) fit(titleField);
		if (bodyField) fit(bodyField);
	});

	// The modal claims focus for itself one frame after it mounts, so the caret
	// can only be put in the title the frame after that.
	$effect(() => {
		const field = titleField;
		if (!field) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => {
				field.focus();
				field.setSelectionRange(field.value.length, field.value.length);
			});
		});
		return () => cancelAnimationFrame(frame);
	});
</script>

<svelte:head><title>{title || 'Note'} · Sloppy</title></svelte:head>

<div
	class="mx-auto flex min-h-0 w-full max-w-[var(--reading-column,42rem)] flex-col gap-7 px-2 pb-1 sm:px-1"
>
	<header
		style="top: var(--reading-head, 0px)"
		class="sticky z-20 -mx-2 border-b border-border bg-background px-2 pt-2 pb-1 sm:-mx-1 sm:px-1"
	>
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={onClose}
				class="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
			>
				<ArrowLeft class="size-4" />
				Graph
			</button>
			{#if !refused}
				<span class="ml-auto truncate text-sm text-muted-foreground" role="status">
					{numbering ? 'Giving it an address…' : 'Putting it down…'}
				</span>
			{/if}
		</div>
	</header>

	<div class="space-y-3">
		<textarea
			bind:this={titleField}
			value={title}
			rows="1"
			oninput={(e) => {
				onTitle(e.currentTarget.value);
				fit(e.currentTarget);
			}}
			onfocus={() => onCaret('title')}
			onkeydown={(e) => {
				const out = e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey);
				if (!out || e.metaKey || e.ctrlKey || e.altKey) return;
				// A title is done with when the writing starts, and on a phone the
				// keyboard has to stay up between the two.
				e.preventDefault();
				bodyField?.focus();
			}}
			placeholder="Untitled"
			maxlength="512"
			aria-label="Title"
			class="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl leading-snug font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:outline-none"
		></textarea>
	</div>

	<div class="flex flex-col gap-7">
		<textarea
			bind:this={bodyField}
			value={body}
			rows="3"
			oninput={(e) => {
				onBody(e.currentTarget.value);
				fit(e.currentTarget);
			}}
			onfocus={() => onCaret('body')}
			placeholder="Start writing."
			aria-label="Note body"
			class="section w-full resize-none overflow-hidden border-0 bg-transparent p-0 placeholder:text-muted-foreground focus-visible:outline-none"
		></textarea>

		{#if refused}
			<div
				class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
				role="alert"
			>
				<span>{refused} What you have written is still here.</span>
				<Button variant="outline" size="sm" onclick={onAgain}>Try again</Button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* The one section a note with nothing in it opens on, drawn the way the
	   writing surface draws it — DESIGN.md § "A block reads as a section". */
	.section {
		padding-block: 0.6rem;
		font-size: 1rem;
		line-height: 1.7;
	}
</style>
