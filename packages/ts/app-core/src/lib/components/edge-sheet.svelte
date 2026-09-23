<script lang="ts">
	// The look on one line, as a person sets it — DESIGN.md § Edges, "A look a
	// person set".
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Minus from '@lucide/svelte/icons/minus';
	import {
		compareOrd,
		EDGE_LABEL_MAX,
		noteLabel,
		type BlockView,
		type EdgeDirection,
		type EdgeLook,
		type EdgeStroke,
		type NodeView
	} from '@sloppy/types';
	import { isNamed, nameOf, ResponsiveModal } from '@sloppy/ui';
	import { untrack } from 'svelte';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { api } from '../api.js';
	import { lineBetween } from '../edge-look.js';
	import { serverMessage } from '../stores/errors.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { offers } from '../stores/offers.svelte.js';
	import { people } from '../stores/people.svelte.js';
	import { session } from '../stores/session.svelte.js';

	let {
		open = false,
		onOpenChange,
		from,
		to
	}: {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** The note the reader came from. */
		from: NodeView;
		to: NodeView;
	} = $props();

	// Read once: a sheet is opened on one line, and the graph moving underneath
	// it must not rewrite what the person is in the middle of saying.
	const line = untrack(() => lineBetween(from, to, session.viewer?.did ?? ''));
	const here = noteLabel(line.on);
	const there = noteLabel(line.other);
	const offering = line.writes === 'offered';
	const owner = line.on.owner;

	let label = $state(line.look?.label ?? '');
	let direction = $state<EdgeDirection | undefined>(line.look?.direction);
	let stroke = $state<EdgeStroke | undefined>(line.look?.stroke);
	let busy = $state(false);
	let trouble = $state('');
	let said = $state('');

	const ownerName = $derived.by(() => {
		if (owner === undefined) return 'whoever writes it';
		const person = people.of(owner);
		if (person && isNamed(person)) return nameOf(person);
		return people.unplaced(owner) ? 'somebody else' : 'whoever writes it';
	});

	$effect(() => {
		if (offering && owner !== undefined) people.resolve(owner);
	});

	const arrows: { at: EdgeDirection | undefined; says: string; icon: typeof Minus }[] = [
		{ at: undefined, says: 'No arrow', icon: Minus },
		{ at: 'to', says: `Points at ${there}`, icon: ArrowRight },
		{ at: 'from', says: `Points at ${here}`, icon: ArrowLeft },
		{ at: 'both', says: 'Both ends', icon: ArrowLeftRight }
	];

	const breaks: { as: EdgeStroke | undefined; says: string }[] = [
		{ as: undefined, says: 'As it is' },
		{ as: 'solid', says: 'Solid' },
		{ as: 'dashed', says: 'Dashed' },
		{ as: 'dotted', says: 'Dotted' }
	];

	const pill =
		'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none';
	const chosen = (on: boolean) =>
		on
			? 'border-input text-foreground'
			: 'border-transparent text-muted-foreground hover:text-foreground';

	/** An offer carries the note's writing whole, so the rest of it is the note as
	 *  it stands — or as this person is already offering it. */
	async function offer(look: EdgeLook): Promise<void> {
		const of = line.on.ref;
		const note = nodes.get(of) ?? line.on;
		const stack: BlockView[] = (await api.listBlocks(of)).sort((a, b) => compareOrd(a.ord, b.ord));
		await offers.read(of);
		await offers.hold(of, { title: note.title, tags: note.tags, blocks: stack });
		offers.setLook(of, look);
		await offers.propose(of, '');
	}

	async function write(sets: {
		label?: string;
		direction?: EdgeDirection;
		stroke?: EdgeStroke;
	}): Promise<void> {
		busy = true;
		trouble = '';
		said = '';
		try {
			const look: EdgeLook = { to: line.other.ref, ...sets };
			if (offering) {
				await offer(look);
				said = `Offered to ${ownerName}. It shows once they take it.`;
			} else {
				await nodes.setLook(line.on.ref, look);
				onOpenChange?.(false);
			}
		} catch (error) {
			trouble = serverMessage(error) ?? 'Sloppy could not save that. Try again in a moment.';
		} finally {
			busy = false;
		}
	}

	const save = () =>
		write({
			label: label.trim(),
			...(direction === undefined ? {} : { direction }),
			...(stroke === undefined ? {} : { stroke })
		});
</script>

<ResponsiveModal {open} {onOpenChange} title="This line" description="Between {here} and {there}.">
	<div class="space-y-5 px-2 pt-4 pb-2">
		<div class="space-y-2">
			<p class="px-1 text-xs text-muted-foreground" id="edge-words">Words on the line</p>
			<Input
				bind:value={label}
				class="h-11"
				maxlength={EDGE_LABEL_MAX}
				autocomplete="off"
				placeholder="Nothing written on it"
				aria-labelledby="edge-words"
				onkeydown={(event: KeyboardEvent) => {
					if (event.key !== 'Enter') return;
					event.preventDefault();
					void save();
				}}
			/>
		</div>

		<div class="space-y-2">
			<p class="px-1 text-xs text-muted-foreground" id="edge-arrow">Arrow</p>
			<div role="group" aria-labelledby="edge-arrow" class="flex flex-wrap gap-1.5">
				{#each arrows as arrow (arrow.says)}
					{@const Icon = arrow.icon}
					<button
						type="button"
						aria-pressed={direction === arrow.at}
						onclick={() => (direction = arrow.at)}
						class="{pill} {chosen(direction === arrow.at)}"
					>
						<Icon class="size-4" aria-hidden="true" />
						{arrow.says}
					</button>
				{/each}
			</div>
		</div>

		<div class="space-y-2">
			<p class="px-1 text-xs text-muted-foreground" id="edge-stroke">Line</p>
			<div role="group" aria-labelledby="edge-stroke" class="flex flex-wrap gap-1.5">
				{#each breaks as broken (broken.says)}
					<button
						type="button"
						aria-pressed={stroke === broken.as}
						onclick={() => (stroke = broken.as)}
						class="{pill} {chosen(stroke === broken.as)}"
					>
						{broken.says}
					</button>
				{/each}
			</div>
		</div>

		{#if trouble}
			<p class="px-1 text-sm text-destructive" role="alert">{trouble}</p>
		{/if}

		{#if said}
			<p class="px-1 text-sm text-muted-foreground" role="status">{said}</p>
		{/if}

		<div class="flex flex-col gap-2 sm:flex-row-reverse">
			<Button class="h-11 sm:flex-1" disabled={busy} onclick={save}>
				{busy ? 'Just a moment…' : offering ? 'Offer this look' : 'Save'}
			</Button>
			{#if line.look}
				<Button
					variant="ghost"
					class="h-11 sm:flex-1"
					disabled={busy}
					onclick={() => void write({})}
				>
					Clear the look
				</Button>
			{/if}
		</div>
	</div>
</ResponsiveModal>
