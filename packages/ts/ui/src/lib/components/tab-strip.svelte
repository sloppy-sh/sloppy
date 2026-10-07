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
		/** The `+`: another folder chosen on this device, which starts a graph in
		 *  one that holds none. */
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
	import { Button } from './ui/button/index.js';

	let { tabs, onSwitch, onClose, onOpen, refused }: TabStripProps = $props();

	let strip = $state<HTMLElement | null>(null);
	let row = $state<HTMLElement | null>(null);
	/** The folder the keyboard is on, which is the one it reaches again on the
	 *  way back in. `null` is nobody there yet: that is the one in front. */
	let walked = $state<number | null>(null);

	const inFront = $derived(
		Math.max(
			0,
			tabs.findIndex((one) => one.active)
		)
	);
	const reaches = $derived(walked !== null && walked < tabs.length ? walked : inFront);

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

	/** Left and right walk the folders, carrying the keyboard's place with them;
	 *  Delete takes the one it is on off, which is what keeps closing a folder
	 *  off the pointer. Enter and Space put one in front, which the button does
	 *  itself. */
	function walk(event: KeyboardEvent, at: number): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			const tab = tabs[at];
			if (!tab) return;
			event.preventDefault();
			onClose(tab.root);
			return;
		}
		const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
		if (step === 0 || tabs.length === 0) return;
		event.preventDefault();
		const next = (at + step + tabs.length) % tabs.length;
		walked = next;
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
				<Button
					variant="ghost"
					role="tab"
					aria-selected={tab.active}
					tabindex={at === reaches ? 0 : -1}
					title={tab.root}
					class="min-h-control max-w-48 min-w-0 rounded-sm px-0 font-normal hover:bg-transparent hover:text-inherit"
					onclick={() => {
						walked = at;
						onSwitch(tab.root);
					}}
					onkeydown={(event) => walk(event, at)}
				>
					<span class="truncate">{tab.name}</span>
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Close {tab.name}"
					tabindex={-1}
					class="min-h-control min-w-control shrink-0 rounded-sm hover:bg-muted hover:text-foreground"
					onclick={() => onClose(tab.root)}
				>
					<X class="size-4" />
				</Button>
			</div>
		{/each}
		<Button
			variant="ghost"
			size="icon"
			aria-label="Choose a folder"
			class="min-h-control min-w-control shrink-0 self-center rounded-md text-foreground/60 hover:bg-muted/70 hover:text-foreground"
			onclick={() => onOpen()}
		>
			<Plus class="size-4" />
		</Button>
	</div>
	{#if refused}
		<p role="alert" class="px-3 pb-1.5 text-xs text-destructive">{refused}</p>
	{/if}
</div>
