<script lang="ts" module>
	/** A folder somebody has open, as the strip across the top shows it. */
	export interface OpenTab {
		/** Where the folder is, which is what every act here names. */
		root: string;
		name: string;
		active: boolean;
	}

	export interface TabStripProps {
		tabs: readonly OpenTab[];
		onSwitch: (root: string) => void;
		onClose: (root: string) => void;
		/** The `+`: somewhere else to open, which is the folder picker. */
		onOpen: () => void;
		/** Words for a person about an act that did not happen. Whoever put it
		 *  there takes it away. */
		refused?: string;
	}
</script>

<script lang="ts">
	// The folders open, in a strip across the top — DESIGN.md § Layout.
	// Presentational: it is handed the folders and reports the root of whichever
	// one was tapped, so the shell holding them is the only thing that opens,
	// switches or closes one.
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { scrollFade } from '$lib/scroll-fade.svelte.js';
	import { cn } from '$lib/utils.js';

	let { tabs, onSwitch, onClose, onOpen, refused }: TabStripProps = $props();

	let strip = $state<HTMLElement | null>(null);
	let row = $state<HTMLElement | null>(null);

	const control =
		'flex min-h-control items-center text-sm transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';

	// Owes its whole height as `--app-chrome-top` — DESIGN.md § "The four inset
	// vars", which counts the system inset this clears as part of that height.
	$effect(() => {
		const root = document.documentElement;
		const drop = () => root.style.removeProperty('--app-chrome-top');
		const el = strip;
		if (!el) {
			drop();
			return;
		}
		const publish = () => root.style.setProperty('--app-chrome-top', `${el.offsetHeight}px`);
		publish();
		const observer = new ResizeObserver(publish);
		observer.observe(el);
		return () => {
			observer.disconnect();
			drop();
		};
	});

	/** Left and right walk the folders; Enter and Space put one in front, which
	 *  the button does itself. */
	function walk(event: KeyboardEvent, at: number): void {
		const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (step === 0 || tabs.length === 0) return;
		event.preventDefault();
		const next = (at + step + tabs.length) % tabs.length;
		row?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
	}
</script>

<div
	bind:this={strip}
	class="sticky top-0 z-50 border-b bg-card/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur"
>
	<div
		bind:this={row}
		role="tablist"
		aria-label="Folders open"
		class="flex items-stretch gap-1 overflow-x-auto scroll-fade-x px-1.5 [scrollbar-width:none]"
		{@attach scrollFade('x')}
	>
		{#each tabs as tab, at (tab.root)}
			<div
				role="presentation"
				class={cn(
					'flex shrink-0 items-center gap-0.5 rounded-t-md border-b-2 ps-2 pe-1',
					tab.active
						? 'border-primary bg-muted/60 text-foreground'
						: 'border-transparent text-foreground/60 hover:bg-muted/40 hover:text-foreground/80'
				)}
			>
				<button
					type="button"
					role="tab"
					aria-selected={tab.active}
					tabindex={tab.active ? 0 : -1}
					title={tab.root}
					class={cn(control, 'max-w-48 min-w-0 rounded-sm')}
					onclick={() => onSwitch(tab.root)}
					onkeydown={(event) => walk(event, at)}
				>
					<span class="truncate">{tab.name}</span>
				</button>
				<button
					type="button"
					aria-label="Close {tab.name}"
					class={cn(
						control,
						'min-w-control shrink-0 justify-center rounded-sm hover:bg-muted hover:text-foreground'
					)}
					onclick={() => onClose(tab.root)}
				>
					<X class="size-4" />
				</button>
			</div>
		{/each}
		<button
			type="button"
			aria-label="Open a folder"
			class={cn(
				control,
				'min-w-control shrink-0 justify-center self-center rounded-md text-foreground/60 hover:bg-muted/70 hover:text-foreground'
			)}
			onclick={() => onOpen()}
		>
			<Plus class="size-4" />
		</button>
	</div>
	{#if refused}
		<p role="alert" class="px-3 pb-1.5 text-xs text-destructive">{refused}</p>
	{/if}
</div>
