<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { Person } from './identity/person.js';

	export interface NavItem {
		/** Stable across renders; also what {@link NavPillProps.activeId} names. */
		id: string;
		label: string;
		href: string;
		icon: Component;
		/** Whoever the destination is; their picture stands where the icon would. */
		person?: Person;
		/** Absent where there is nothing to count; 0 draws nothing either. */
		badge?: number;
	}

	/** A button beside the destinations. It acts rather than navigates, so it
	 *  never carries a selected state. */
	export interface NavAction {
		label: string;
		icon: Component;
		onSelect: () => void;
	}

	export interface NavPillProps {
		items: NavItem[];
		activeId?: string;
		action?: NavAction;
		/** A modal surface is up: the pill floats over it and would clip its
		 *  footer. */
		suppressed?: boolean;
		/** The on-screen keyboard owns the bottom of the screen. */
		keyboardOpen?: boolean;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';
	import Avatar from './identity/avatar.svelte';

	let {
		items,
		activeId,
		action,
		suppressed = false,
		keyboardOpen = false
	}: NavPillProps = $props();

	const hidden = $derived(suppressed || keyboardOpen);

	let pill = $state<HTMLElement | null>(null);

	// The pill floats over the page, so it owes the space it takes as
	// `--sysnav-inset-bottom` — DESIGN.md § "The four inset vars", which also says
	// the var is UNSET wherever the pill is hidden.
	//
	// The pill's own lift above the OS bar, which the class below spells as 1rem;
	// Tailwind scans that class as a literal, so the two have to agree by hand.
	const LIFT_PX = 16;
	$effect(() => {
		const root = document.documentElement;
		const drop = () => root.style.removeProperty('--sysnav-inset-bottom');
		const el = pill;
		if (hidden || !el) {
			drop();
			return;
		}
		const publish = () =>
			root.style.setProperty('--sysnav-inset-bottom', `${el.offsetHeight + LIFT_PX}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			drop();
		};
	});
</script>

<nav
	bind:this={pill}
	aria-label="Primary"
	inert={hidden}
	class={cn(
		'fixed bottom-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+1rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card/95 p-1 shadow-lg backdrop-blur transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
		hidden
			? 'pointer-events-none translate-y-[calc(100%+2rem)] opacity-0'
			: 'translate-y-0 opacity-100'
	)}
>
	{#each items as item (item.id)}
		{@const active = item.id === activeId}
		<a
			href={item.href}
			aria-current={active ? 'page' : undefined}
			class={cn(
				'relative flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-3 font-medium transition-[color,background-color,scale] duration-150 ease-out motion-safe:active:scale-95 motion-reduce:transition-none sm:min-w-0 sm:flex-row sm:gap-2 sm:px-4',
				active
					? 'bg-primary/10 text-primary'
					: 'text-foreground/60 hover:bg-muted/70 hover:text-foreground/80'
			)}
		>
			<span class="relative flex">
				{#if item.person}
					<Avatar person={item.person} size={20} />
				{:else}
					<item.icon class="size-5" />
				{/if}
				{#if item.badge}
					<span
						class="absolute -top-1 -right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
					>
						{item.badge > 9 ? '9+' : item.badge}
					</span>
				{/if}
			</span>
			<span
				class={cn(
					'text-[11px] leading-none whitespace-nowrap sm:text-sm',
					active && 'font-semibold'
				)}
			>
				{item.label}
			</span>
		</a>
	{/each}

	{#if action}
		<button
			type="button"
			onclick={action.onSelect}
			class="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-3 font-medium text-foreground/60 transition-[color,background-color,scale] duration-150 ease-out hover:bg-muted/70 hover:text-foreground/80 motion-safe:active:scale-95 motion-reduce:transition-none sm:min-w-0 sm:flex-row sm:gap-2 sm:px-4"
		>
			<action.icon class="size-5" />
			<span class="text-[11px] leading-none whitespace-nowrap sm:text-sm">{action.label}</span>
		</button>
	{/if}
</nav>
