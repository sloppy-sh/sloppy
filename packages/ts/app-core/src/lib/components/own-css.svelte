<script lang="ts">
	// Rules of a person's own, which are part of the look they can send
	// somebody — DESIGN.md § "A look is a file".
	import { Label } from '@sloppy/ui/label';
	import { Textarea } from '@sloppy/ui/textarea';
	import { cssIsSafe, LOOK_CSS_MAX } from '@sloppy/types';
	import { onDestroy } from 'svelte';
	import { prefs } from '../stores/prefs.svelte.js';

	/** How long after the last keystroke the rules are kept. */
	const SETTLES_MS = 400;
	/** How close to the bound the room left is worth saying. */
	const SAY_THE_ROOM_LEFT = 2048;

	let typed = $state(prefs.current.css);
	/** The rules this field last wrote, so a look arriving from a file lands in
	 *  the box and a keystroke of this person's own does not land twice. */
	let written = prefs.current.css;
	let settling: ReturnType<typeof setTimeout> | undefined;
	let waiting = false;

	$effect(() => {
		const held = prefs.current.css;
		if (held === written) return;
		written = held;
		typed = held;
	});

	function keep(): void {
		waiting = false;
		written = typed;
		prefs.set('css', typed);
	}

	function changed(): void {
		waiting = true;
		clearTimeout(settling);
		settling = setTimeout(keep, SETTLES_MS);
	}

	onDestroy(() => {
		clearTimeout(settling);
		if (waiting) keep();
	});

	const reaching = $derived(cssIsSafe(typed));
	const left = $derived(LOOK_CSS_MAX - typed.length);
</script>

<div class="space-y-2">
	<Label for="your-own-css">Your own CSS</Label>
	<Textarea
		id="your-own-css"
		name="your-own-css"
		rows={6}
		spellcheck={false}
		maxlength={LOOK_CSS_MAX}
		class="font-mono text-xs"
		bind:value={typed}
		oninput={changed}
	/>
	<p class="text-sm text-muted-foreground">
		Rules of your own. They are part of the look, so they travel with it.
	</p>
	{#if reaching}
		<p class="text-sm text-destructive" role="alert">{reaching}</p>
	{:else if left <= SAY_THE_ROOM_LEFT}
		<p class="text-sm text-muted-foreground" aria-live="polite">{left} characters left.</p>
	{/if}
</div>
