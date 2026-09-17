<script lang="ts">
	// One of a handful of choices, as a row of pills: a radio underneath, so a
	// keyboard and a screen reader read the set as the one choice it is.
	import { cn } from '$lib/utils.js';

	let {
		group,
		value,
		label,
		checked = false,
		disabled = false,
		onpick,
		class: className
	}: {
		/** The choices this one stands among; every pill in a set shares it. */
		group: string;
		value: string;
		label: string;
		checked?: boolean;
		/** A choice this device cannot make, shown so somebody knows it exists. */
		disabled?: boolean;
		onpick: () => void;
		class?: string;
	} = $props();
</script>

<label class={cn(disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', className)}>
	<input
		type="radio"
		name={group}
		{value}
		{checked}
		{disabled}
		onchange={onpick}
		class="peer sr-only"
	/>
	<span
		class="inline-flex h-11 items-center rounded-md border border-border bg-card px-4 text-sm text-muted-foreground transition-colors duration-150 ease-out peer-checked:border-primary peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none"
	>
		{label}
	</span>
</label>
