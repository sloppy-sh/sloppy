<script lang="ts">
	// The chrome beside the graph on a desk — DESIGN.md § Layout. Presentational
	// like the pill it stands in place of: the destinations are handed to it, and
	// the page on screen fills the rest through `deskNav`. Not shadcn's Sidebar:
	// that one lays the page out around itself where `main` must stay `contents`,
	// and keeps a breakpoint and a cookie of its own where the dock width and
	// `prefs` already decide both.
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import { cn } from '$lib/utils.js';
	import { chromeInset } from './chrome-inset.svelte.js';
	import { deskNav } from './desk-nav.svelte.js';
	import Avatar from './identity/avatar.svelte';
	import type { NavAction, NavItem } from './nav-pill.svelte';

	let {
		items,
		activeId,
		action,
		open = true,
		onOpenChange
	}: {
		items: NavItem[];
		activeId?: string;
		action?: NavAction;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	const collapsed = $derived(!open);

	const control =
		'flex min-h-control min-w-control items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
	const quiet = 'text-foreground/70 hover:bg-muted/70 hover:text-foreground';

	let column = $state<HTMLElement | null>(null);

	// Owes its width as `--app-chrome-inset-start` — DESIGN.md § "The four inset vars".
	$effect(() => {
		const root = document.documentElement;
		const drop = () => {
			root.style.removeProperty('--app-chrome-inset-start');
			chromeInset.takes(0);
		};
		const el = column;
		if (!el) {
			drop();
			return;
		}
		const publish = () => {
			root.style.setProperty('--app-chrome-inset-start', `${el.offsetWidth}px`);
			chromeInset.takes(el.offsetWidth);
		};
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			drop();
		};
	});
</script>

<aside
	bind:this={column}
	aria-label="Sloppy"
	class={cn(
		'fixed inset-y-0 start-0 z-40 flex flex-col gap-2 border-e bg-card/95 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(var(--safe-area-inset-bottom,env(safe-area-inset-bottom))+0.75rem)] backdrop-blur',
		collapsed ? 'w-(--desk-nav-rail) px-1.5' : 'w-(--desk-nav-width) px-2'
	)}
>
	<!-- The head is where the page is looked at differently — the column narrowed,
	     and whatever the page puts beside that — so those stand together. -->
	<div class={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
		{#if deskNav.head && !collapsed}
			<div class="flex min-w-0 flex-1 items-center">{@render deskNav.head({ collapsed })}</div>
		{/if}
		<button
			type="button"
			aria-expanded={open}
			aria-label={open ? 'Narrow this column' : 'Widen this column'}
			onclick={() => onOpenChange?.(!open)}
			class={cn(control, quiet, 'ms-auto justify-center px-2.5')}
		>
			{#if open}
				<PanelLeftClose class="size-5" />
			{:else}
				<PanelLeftOpen class="size-5" />
			{/if}
		</button>
		{#if deskNav.head && collapsed}
			{@render deskNav.head({ collapsed })}
		{/if}
	</div>

	{#if deskNav.parts}
		<div class="flex min-h-0 flex-1 flex-col gap-2">
			{@render deskNav.parts({ collapsed })}
		</div>
	{:else}
		<div class="flex-1"></div>
	{/if}

	<nav aria-label="Primary" class="flex flex-col gap-0.5 border-t pt-2">
		{#each items as item (item.id)}
			{@const active = item.id === activeId}
			<a
				href={item.href}
				aria-current={active ? 'page' : undefined}
				aria-label={collapsed ? item.label : undefined}
				title={collapsed ? item.label : undefined}
				class={cn(
					control,
					active ? 'bg-primary/10 text-primary' : quiet,
					collapsed && 'justify-center px-2.5'
				)}
			>
				<span class="relative flex shrink-0">
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
				{#if !collapsed}
					<span class="min-w-0 truncate">{item.label}</span>
				{/if}
			</a>
		{/each}

		{#if action}
			<button
				type="button"
				onclick={action.onSelect}
				aria-label={collapsed ? action.label : undefined}
				title={collapsed ? action.label : undefined}
				class={cn(control, quiet, collapsed && 'justify-center px-2.5')}
			>
				<action.icon class="size-5 shrink-0" />
				{#if !collapsed}
					<span class="min-w-0 truncate">{action.label}</span>
				{/if}
			</button>
		{/if}
	</nav>
</aside>
