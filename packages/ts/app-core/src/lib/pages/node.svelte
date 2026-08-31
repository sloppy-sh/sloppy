<script lang="ts">
	// One note's interior, on the reading surface `ReadingPanel` gives it. The
	// address rides the top because it is what a person cites and a peer resolves.
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import {
		alongRun,
		compareOrd,
		type BlockView,
		type CreateBlockRequest,
		type NodeAppearance,
		type NodeView,
		type OwnedRef,
		type Tag,
		type UpdateBlockRequest
	} from '@sloppy/types';
	import {
		AppearanceField,
		BlockStack,
		ConfirmModal,
		scrollFade,
		suggestedFor,
		TagField,
		TemplatePicker,
		writeTemplate,
		type NoteReferences,
		type NoteTemplate
	} from '@sloppy/ui';
	import { Button } from '@sloppy/ui/button';
	import { Input } from '@sloppy/ui/input';
	import { Skeleton } from '@sloppy/ui/skeleton';
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import NoteAuthor from '../components/note-author.svelte';
	import { api } from '../api.js';
	import { deletionCost } from '../deletion.js';
	import { noteEmoji, noteMedia } from '../note-surface.js';
	import { nodes } from '../stores/nodes.svelte.js';
	import { serverMessage } from '../stores/errors.js';
	import { session } from '../stores/session.svelte.js';
	import { tags } from '../stores/tags.svelte.js';

	let {
		ref,
		naming = null,
		seed = null,
		onSeeded,
		onOpen,
		onLinkOnGraph,
		onClose
	}: {
		ref: OwnedRef;
		/** The note just written, whose title is still to be given, if it is this one. */
		naming?: OwnedRef | null;
		/** The shape the note just written was to start from, if it is this one. It
		 *  is seeded here so sections that will not write cannot strand the note. */
		seed?: { ref: OwnedRef; shape: NoteTemplate } | null;
		/** Called the moment the shape is taken up, and it must not be offered
		 *  again: a note reopened still carrying one would seed itself twice. */
		onSeeded?: () => void;
		onOpen: (ref: OwnedRef, fresh?: boolean, shape?: NoteTemplate | null) => void;
		/** Hand the choice of what to link to over to the graph. */
		onLinkOnGraph: () => void;
		onClose: () => void;
	} = $props();

	const node = $derived(nodes.get(ref));
	const children = $derived(nodes.children(ref));
	const parent = $derived(node?.parent ? nodes.get(node.parent) : undefined);
	const emoji = $derived(noteEmoji(session.viewer?.did ?? ''));
	const suggestions = $derived(tags.all.map((entry) => entry.tag));

	/** The notes this one is alongside, grouped the way the canvas groups them
	 *  for the run it draws: what sprang from the same note, or an author's own
	 *  branches. */
	const alongside = $derived.by(() => {
		if (!node) return [];
		return node.parent
			? nodes.children(node.parent)
			: nodes.region().filter((root) => root.created_by === node.created_by);
	});

	const along = $derived(node ? alongRun(node.address, alongside) : { before: null, after: null });

	/** Every way out of this note, in the shape the graph is drawn in. A way with
	 *  nowhere to go keeps its place and stops answering, so a walk presses the
	 *  same button in the same spot the whole way along. */
	const ways = $derived([
		{ icon: ChevronUp, says: 'The note this one grew out of', to: parent ?? null },
		{ icon: ChevronLeft, says: 'The note before this', to: along.before },
		{ icon: ChevronRight, says: 'The note after this', to: along.after },
		{ icon: ChevronDown, says: 'The first note under this', to: children[0] ?? null }
	]);

	/** Stacks already read, oldest first: a note whose sections are in hand must
	 *  not blank itself while the server says them again. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders off this, and the effect that reads it also writes it: a tracked read would re-open the note on every write.
	const read = new Map<OwnedRef, BlockView[]>();
	/** Reads in the air for a note nobody has opened yet. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- as above.
	const reading = new Set<OwnedRef>();

	/** The stack on screen and the note it is for. Named so the next note draws
	 *  from memory in the frame it opens in, not a frame later. */
	let shown = $state<{ of: OwnedRef; stack: BlockView[] } | null>(null);
	/** The note a read would not answer for, and what to tell whoever opened it. */
	let unread = $state<{ of: OwnedRef; says: string } | null>(null);
	const blocks = $derived(shown?.of === ref ? shown.stack : (read.get(ref) ?? []));
	const unreachable = $derived(unread?.of === ref ? unread.says : null);
	const loading = $derived(shown?.of !== ref && !unreachable && read.get(ref) === undefined);
	/** The note whose title would not save, and what to tell the person writing it. */
	let unsaved = $state<{ ref: OwnedRef; message: string } | null>(null);
	let adding = $state(false);
	let refused = $state<string | null>(null);
	let titleField = $state<HTMLTextAreaElement | null>(null);
	let noteBody = $state<HTMLElement | null>(null);

	/** Which act the shapes are being offered for: a note under this one, the one
	 *  after it, or this note itself. */
	let shaping = $state<'under' | 'after' | 'this' | null>(null);
	/** The same act, held while the sheet animates out so its title and its row
	 *  order do not change on the way. */
	let offered = $state<'under' | 'after' | 'this'>('this');
	let seeding = $state(false);
	let shapeRefused = $state<string | null>(null);
	/** Block writes the writing surface has in the air. */
	let surfaceWrites = 0;
	/** How many writes have landed in the note on screen. An answer to a read
	 *  started before one of them says less than what is already in hand. */
	let landed = 0;
	/** Bumped when the writing surface has to be built again from `blocks`. */
	let rebuilt = $state(0);

	/** The caret is in the note's own writing — a section, or the title. The
	 *  writing surface's own bar rides the foot of the note while it is, and a
	 *  way out under the thumb of somebody mid-sentence is a way out taken by
	 *  accident. */
	let writing = $state(false);
	/** A tap on that bar takes the caret off the writing for an instant, and on
	 *  touch there is no mousedown to refuse. */
	let stopped: ReturnType<typeof setTimeout> | undefined;

	let removing = $state(false);
	let undeletable = $state<string | null>(null);

	/** Typed into the field that reaches a note by the address a person cites. */
	let cited = $state('');
	let linking = $state(false);
	let linkRefused = $state<string | null>(null);
	/** The server's own words when a retag was refused, for the field to show. */
	let tagRefused = $state<string | null>(null);
	/** The same, for a look that would not save. */
	let lookRefused = $state<string | null>(null);
	/** Link targets a lookup found nothing at, so their row can say so. */
	const gone = new SvelteSet<OwnedRef>();

	/** Kept until it is stored, so a save that fails still has it to try again. */
	let typed = $state<{ ref: OwnedRef; title: string } | null>(null);
	const title = $derived(typed?.ref === ref ? typed.title : (node?.title ?? ''));

	const byOrd = (a: BlockView, b: BlockView) => compareOrd(a.ord, b.ord);

	/** How many notes back a walk stays instant. */
	const REMEMBERED = 24;

	function remember(of: OwnedRef, stack: BlockView[]): void {
		read.delete(of);
		read.set(of, stack);
		for (const oldest of read.keys()) {
			if (read.size <= REMEMBERED) break;
			read.delete(oldest);
		}
	}

	/** Which note's stack a block sits in, of the stacks in hand. */
	function holderOf(block: OwnedRef): OwnedRef | null {
		if (blocks.some((held) => held.ref === block)) return ref;
		for (const [of, stack] of read) {
			if (stack.some((held) => held.ref === block)) return of;
		}
		return null;
	}

	/** Puts a write into the stack of the note it was made in, which is not
	 *  always the note on screen: a writing surface sends its last write as it is
	 *  taken down, by which time the reader has walked on. */
	function amend(of: OwnedRef, change: (stack: BlockView[]) => BlockView[]): void {
		const held = of === ref ? blocks : read.get(of);
		if (!held) return;
		const stack = change(held).sort(byOrd);
		remember(of, stack);
		if (of !== ref) return;
		shown = { of, stack };
		landed += 1;
	}

	/** Whether a stack read back says anything the one in hand does not. */
	function differs(held: readonly BlockView[], answer: readonly BlockView[]): boolean {
		if (held.length !== answer.length) return true;
		return held.some(
			(block, at) =>
				block.ref !== answer[at].ref ||
				block.ord !== answer[at].ord ||
				JSON.stringify(block.content) !== JSON.stringify(answer[at].content)
		);
	}

	async function readAhead(of: OwnedRef): Promise<void> {
		reading.add(of);
		try {
			remember(of, await api.listBlocks(of));
		} catch {
			// Nobody asked for this note yet, so nothing is owed when it will not read.
		} finally {
			reading.delete(of);
		}
	}

	/** Past one section the person has made their own shape, and offering one
	 *  would be in the way rather than in time. */
	const shapeable = $derived(blocks.length <= 1);

	const suggested = $derived(offered === 'this' ? null : suggestedFor(offered));

	/** Every note the cache holds — what a link may point at, in address order. */
	const everyNote = $derived.by(() => {
		const out: NodeView[] = [];
		const walk = (list: NodeView[]) => {
			for (const note of list) {
				out.push(note);
				walk(nodes.children(note.ref));
			}
		};
		walk(nodes.region());
		return out;
	});

	const linked = $derived(
		(node?.links ?? []).map((target) => ({ target, note: nodes.get(target) }))
	);
	const backlinks = $derived(
		everyNote.filter((note) => note.ref !== ref && note.links.includes(ref))
	);

	/** Enough to recognise the one meant, never a list to browse. */
	const MATCHES = 6;

	/** How a note is reached by what a person cites: the address, or words in the
	 *  title. `needle` is already lowercased. */
	function carries(note: NodeView, needle: string): boolean {
		return note.address.startsWith(needle) || note.title.toLowerCase().includes(needle);
	}

	const citable = $derived.by(() => {
		const needle = cited.trim().toLowerCase();
		if (!needle) return [];
		const already = new Set(node?.links ?? []);
		return everyNote
			.filter((note) => note.ref !== ref && !already.has(note.ref) && carries(note, needle))
			.slice(0, MATCHES);
	});

	const references: NoteReferences = {
		find: (query: string) => {
			const needle = query.toLowerCase();
			return everyNote.filter((note) => note.ref !== ref && (!needle || carries(note, needle)));
		},
		read: async (target: OwnedRef) => nodes.get(target) ?? (await nodes.fetch(target)),
		write: async (name: string, relation: 'under' | 'after') => {
			try {
				return await nodes.create({ from: { relation, note: ref }, title: name });
			} catch (error) {
				throw new Error(
					serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.',
					{ cause: error }
				);
			}
		},
		open: (target: OwnedRef) => onOpen(target)
	};

	const consequence = $derived(deletionCost([ref]));

	// The modal claims focus for itself one frame after it mounts, so the caret
	// can only be put in the title the frame after that.
	$effect(() => {
		const field = titleField;
		if (naming !== ref || !field) return;
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => field.focus());
		});
		return () => cancelAnimationFrame(frame);
	});

	// A link may point at a note that has since gone, and a row that waits on one
	// forever is worse than a row that says so.
	$effect(() => {
		for (const { target, note } of linked) {
			if (note || gone.has(target)) continue;
			void nodes
				.fetch(target)
				.then((resolved) => {
					if (!resolved) gone.add(target);
				})
				// A lookup that failed says nothing about whether the note is there.
				.catch(() => {});
		}
	});

	/** The note scrolls inside a surface it does not own, so the next note along
	 *  is started at ITS top by scrolling whatever that surface turns out to be. */
	function startAtTheTop(): void {
		for (let box = noteBody?.parentElement; box; box = box.parentElement) {
			const flow = getComputedStyle(box).overflowY;
			if (flow === 'auto' || flow === 'scroll') {
				box.scrollTop = 0;
				return;
			}
		}
	}

	/** A title wraps rather than scrolling out of sight, so the box follows it. */
	function fitTitle(field: HTMLTextAreaElement): void {
		field.style.height = 'auto';
		field.style.height = `${field.scrollHeight}px`;
	}

	$effect(() => {
		if (node && titleField) fitTitle(titleField);
	});

	// Dismissing the sheet with the keyboard tears the field down without ever
	// blurring it, and what was typed into it is still worth keeping.
	onDestroy(() => {
		clearTimeout(stopped);
		void saveTitle();
	});

	function caretIn(target: EventTarget | null): void {
		if (!(target instanceof Element)) return;
		if (
			target !== titleField &&
			!target.closest('[contenteditable]:not([contenteditable="false"])')
		)
			return;
		clearTimeout(stopped);
		writing = true;
	}

	function caretGone(): void {
		clearTimeout(stopped);
		stopped = setTimeout(() => (writing = false), 250);
	}

	$effect(() => {
		const opening = ref;
		const starting = untrack(() => {
			if (seed?.ref !== opening) return null;
			const shape = seed.shape;
			onSeeded?.();
			return shape;
		});
		let live = true;
		const known = read.get(opening);
		const wrote = landed;
		cited = '';
		removing = false;
		undeletable = null;
		unread = null;
		linkRefused = null;
		tagRefused = null;
		lookRefused = null;
		shaping = null;
		seeding = false;
		shapeRefused = null;
		writing = false;
		startAtTheTop();
		void (async () => {
			let held = false;
			try {
				const [, stack] = await Promise.all([nodes.fetch(opening), api.listBlocks(opening)]);
				// A write that landed while this was in the air says more than it does.
				if (landed === wrote) {
					// A surface built from what was remembered is holding a stack the
					// server has moved past, and its next save would put that stack
					// back over the newer one.
					const rebuild = live && known !== undefined && differs(blocks, stack);
					remember(opening, stack);
					if (live) shown = { of: opening, stack };
					if (rebuild) rebuilt += 1;
				}
				held = true;
			} catch (error) {
				// Sections already on screen are the note; taking them away to report
				// a read behind them costs the reader more than it tells them.
				if (live && !known) {
					unread = {
						of: opening,
						says:
							serverMessage(error) ?? 'Sloppy could not read this note. Close it and open it again.'
					};
				}
			}
			if (live && held && starting) await shapeThisNote(starting);
		})();
		return () => {
			live = false;
		};
	});

	// The notes either side are read while this one is being read, so a walk
	// along the run does not wait on the server at every step.
	$effect(() => {
		if (loading || unreachable) return;
		for (const near of [along.before, along.after]) {
			if (near && !read.has(near.ref) && !reading.has(near.ref)) void readAhead(near.ref);
		}
	});

	async function saveTitle(): Promise<void> {
		const draft = typed;
		if (!draft || draft.title === nodes.get(draft.ref)?.title) return;
		try {
			await nodes.update(draft.ref, { title: draft.title });
			if (typed === draft) typed = null;
			if (unsaved?.ref === draft.ref) unsaved = null;
		} catch (error) {
			unsaved = {
				ref: draft.ref,
				message: serverMessage(error) ?? 'Sloppy could not save that title. Try again in a moment.'
			};
		}
	}

	/** The two ways a note is written from this one: one under it, or the one
	 *  that comes after it. The server derives the address from either. */
	async function write(relation: 'under' | 'after', shape: NoteTemplate | null): Promise<void> {
		if (adding) return;
		adding = true;
		refused = null;
		try {
			onOpen((await nodes.create({ from: { relation, note: ref } })).ref, true, shape);
		} catch (error) {
			refused = serverMessage(error) ?? 'Sloppy could not add that note. Try again in a moment.';
		} finally {
			adding = false;
		}
	}

	/** Two writers appending to one stack would interleave their sections, so a
	 *  shape waits until nothing the writing surface started is still in the air.
	 *  It waits a turn first, because a write started as the surface goes away is
	 *  not counted the moment it is started. */
	async function stackSettled(): Promise<void> {
		await tick();
		do {
			await new Promise((wake) => setTimeout(wake));
		} while (surfaceWrites > 0);
	}

	/** Gives this note a shape, its sections landing under what is already here. */
	async function shapeThisNote(shape: NoteTemplate): Promise<void> {
		if (seeding) return;
		const into = ref;
		seeding = true;
		shapeRefused = null;
		await stackSettled();
		if (ref !== into) return;

		let refusal: string | null = null;
		try {
			await writeTemplate(shape, { node: into, after: blocks.at(-1)?.ref }, api.createBlock);
		} catch (error) {
			refusal =
				serverMessage(error) ?? 'Sloppy could not add those sections. Try again in a moment.';
		}
		let stack: BlockView[] | null = null;
		try {
			stack = (await api.listBlocks(into)).sort(byOrd);
			remember(into, stack);
		} catch (error) {
			refusal ??=
				serverMessage(error) ?? 'Sloppy could not read this note. Close it and open it again.';
		}
		// A shape that finished after the reader moved on belongs to the note it
		// was asked for, not to the one now on screen.
		if (ref !== into) return;
		if (stack) shown = { of: into, stack };
		shapeRefused = refusal;
		seeding = false;
	}

	function offerShapes(act: 'under' | 'after' | 'this'): void {
		offered = act;
		shaping = act;
	}

	function pickShape(shape: NoteTemplate | null): void {
		const act = shaping;
		shaping = null;
		if (act === null) return;
		if (act === 'this') {
			if (shape) void shapeThisNote(shape);
			return;
		}
		void write(act, shape);
	}

	async function addBlock(request: CreateBlockRequest): Promise<BlockView> {
		surfaceWrites += 1;
		try {
			const block = await api.createBlock(request);
			amend(block.node, (stack) => [...stack, block]);
			return block;
		} finally {
			surfaceWrites -= 1;
		}
	}

	async function editBlock(block: OwnedRef, request: UpdateBlockRequest): Promise<BlockView> {
		surfaceWrites += 1;
		try {
			const saved = await api.updateBlock(block, request);
			amend(saved.node, (stack) => stack.map((held) => (held.ref === saved.ref ? saved : held)));
			return saved;
		} finally {
			surfaceWrites -= 1;
		}
	}

	async function dropBlock(block: OwnedRef): Promise<void> {
		const of = holderOf(block);
		surfaceWrites += 1;
		try {
			await api.deleteBlock(block);
			if (of) amend(of, (stack) => stack.filter((held) => held.ref !== block));
		} finally {
			surfaceWrites -= 1;
		}
	}

	async function relink(links: OwnedRef[], whenItFails: string): Promise<void> {
		if (linking) return;
		linking = true;
		linkRefused = null;
		try {
			await nodes.update(ref, { links });
		} catch (error) {
			linkRefused = serverMessage(error) ?? whenItFails;
		} finally {
			linking = false;
		}
	}

	async function retag(picked: Tag[]): Promise<void> {
		tagRefused = null;
		try {
			await nodes.update(ref, { tags: picked });
		} catch (error) {
			// The field puts its chips back on a rejection and shows `tagRefused`;
			// swallowing this would leave a tag that never saved looking saved.
			tagRefused = serverMessage(error) ?? 'Sloppy could not save that tag. Try again in a moment.';
			throw error;
		}
		// A tag exists exactly as long as a note carries one, so a word written
		// here is what puts it in the rail and in everybody else's completions.
		void tags.reload().catch(() => {});
	}

	async function relook(appearance: NodeAppearance | null): Promise<void> {
		lookRefused = null;
		try {
			await nodes.update(ref, { appearance });
		} catch (error) {
			// The field puts the choices back on a rejection and shows `lookRefused`;
			// swallowing this would leave a look that never saved looking saved.
			lookRefused =
				serverMessage(error) ?? 'Sloppy could not save that look. Try again in a moment.';
			throw error;
		}
	}

	async function link(target: OwnedRef): Promise<void> {
		const before = node?.links;
		if (!before) return;
		await relink([...before, target], 'Sloppy could not add that link. Try again in a moment.');
	}

	async function unlink(target: OwnedRef): Promise<void> {
		const before = node?.links;
		if (!before) return;
		await relink(
			before.filter((other) => other !== target),
			'Sloppy could not remove that link. Try again in a moment.'
		);
	}

	async function deleteNote(): Promise<void> {
		const above = node?.parent;
		undeletable = null;
		try {
			await nodes.remove(ref);
		} catch (error) {
			undeletable =
				serverMessage(error) ?? 'Sloppy could not delete that note. Try again in a moment.';
			return;
		}
		if (typed?.ref === ref) typed = null;
		if (above) onOpen(above);
		else onClose();
	}
</script>

{#snippet row(note: NodeView, choose: () => void)}
	<button
		type="button"
		onclick={choose}
		class="flex min-h-11 w-full items-baseline gap-3 rounded-md px-2 text-left transition-colors duration-150 ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
	>
		<span class="address shrink-0 text-sm text-muted-foreground">{note.address}</span>
		<span class="min-w-0 flex-1 truncate">{note.title || 'Untitled'}</span>
	</button>
{/snippet}

<svelte:head><title>{node?.title || 'Note'} · Sloppy</title></svelte:head>

<div
	bind:this={noteBody}
	class="mx-auto flex min-h-0 w-full max-w-2xl flex-col gap-7 px-2 pb-1 sm:px-1"
	onfocusin={(e) => caretIn(e.target)}
	onfocusout={caretGone}
>
	<!-- The way out and the address keep their place however far the note runs.
	     The way out comes first so the surface opens on it rather than in the
	     title field, which on a phone would raise the keyboard over a note you
	     came to read. -->
	<div
		class="sticky top-0 z-20 -mx-2 flex items-center gap-3 border-b border-border bg-background px-2 pt-2 pb-1 sm:-mx-1 sm:px-1"
	>
		<button
			type="button"
			onclick={onClose}
			class="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
		>
			<ArrowLeft class="size-4" />
			Graph
		</button>

		{#if node}
			<span class="address ml-auto truncate text-sm text-foreground/70 select-text">
				{node.address}
			</span>
		{/if}
	</div>

	{#if loading && !node}
		<div class="space-y-4">
			<Skeleton class="h-4 w-16" />
			<Skeleton class="h-9 w-2/3" />
			<Skeleton class="h-24 w-full" />
		</div>
	{:else if unreachable && !node}
		<p class="py-8 text-center text-muted-foreground" role="alert">{unreachable}</p>
	{:else if !node}
		<p class="py-8 text-center text-muted-foreground">
			That note is not here. Whoever wrote it may have taken it down.
		</p>
	{:else}
		<header class="space-y-3">
			<textarea
				bind:this={titleField}
				value={title}
				rows="1"
				oninput={(e) => {
					typed = { ref, title: e.currentTarget.value };
					fitTitle(e.currentTarget);
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						e.currentTarget.blur();
					}
				}}
				onblur={saveTitle}
				placeholder="Untitled"
				maxlength="512"
				aria-label="Title"
				class="w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl leading-snug font-semibold tracking-tight placeholder:text-muted-foreground/60 focus-visible:outline-none"
			></textarea>

			<NoteAuthor did={node.created_by} />

			{#if unsaved?.ref === ref}
				<p class="text-sm text-destructive" role="alert">{unsaved.message}</p>
			{/if}
		</header>

		<!-- The fields belong to the note: a word half-typed into one, and a
		     refusal it is still showing, must not follow the reader to the next. -->
		{#key ref}
			<div class="space-y-2 border-b border-border pb-6">
				<AppearanceField
					appearance={node.appearance}
					media={noteMedia}
					onchange={relook}
					refused={lookRefused}
				/>

				<TagField
					tags={node.tags}
					{suggestions}
					onchange={retag}
					refused={tagRefused}
					placeholder={node.tags.length > 0 ? 'Add a tag' : 'Tag this note'}
				/>
			</div>
		{/key}

		{#if loading || seeding}
			<Skeleton class="h-24 w-full" />
		{:else if unreachable}
			<p class="text-sm text-destructive" role="alert">{unreachable}</p>
		{:else}
			{#key rebuilt}
				<BlockStack
					{node}
					{blocks}
					{emoji}
					{references}
					media={noteMedia}
					onCreate={addBlock}
					onUpdate={editBlock}
					onRemove={dropBlock}
					onReorder={(block: OwnedRef, after: OwnedRef | null) => editBlock(block, { after })}
				/>
			{/key}
		{/if}

		{#if !loading && !unreachable && shapeable}
			<Button
				variant="ghost"
				class="-mt-4 h-11 w-fit text-muted-foreground"
				disabled={seeding}
				onclick={() => offerShapes('this')}
			>
				<LayoutTemplate class="size-4" />
				Add a shape
			</Button>
		{/if}

		{#if shapeRefused}
			<p class="text-sm text-destructive" role="alert">{shapeRefused}</p>
		{/if}

		<div class="space-y-3 border-t border-border pt-6">
			{#if children.length > 0}
				<h2 class="text-sm font-medium text-muted-foreground">Under this</h2>
				<ul class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto" {@attach scrollFade('y')}>
					{#each children as child (child.ref)}
						<li>{@render row(child, () => onOpen(child.ref))}</li>
					{/each}
				</ul>
			{/if}

			<div class="flex flex-col gap-2 sm:flex-row">
				<div class="flex gap-2 sm:flex-1">
					<Button
						variant="outline"
						class="h-11 flex-1"
						disabled={adding}
						onclick={() => write('under', null)}
					>
						<CornerDownRight class="size-4" />
						Write a note under this
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="size-11 shrink-0 text-muted-foreground"
						aria-label="Write a note under this, from a shape"
						disabled={adding}
						onclick={() => offerShapes('under')}
					>
						<LayoutTemplate class="size-4" />
					</Button>
				</div>
				<div class="flex gap-2 sm:flex-1">
					<Button
						variant="outline"
						class="h-11 flex-1"
						disabled={adding}
						onclick={() => write('after', null)}
					>
						<ArrowRight class="size-4" />
						Write the next note
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="size-11 shrink-0 text-muted-foreground"
						aria-label="Write the next note, from a shape"
						disabled={adding}
						onclick={() => offerShapes('after')}
					>
						<LayoutTemplate class="size-4" />
					</Button>
				</div>
			</div>

			{#if refused}<p class="text-sm text-destructive" role="alert">{refused}</p>{/if}
		</div>

		<div class="space-y-3 border-t border-border pt-6">
			{#if linked.length > 0}
				<h2 class="text-sm font-medium text-muted-foreground">Links to</h2>
				<ul class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto" {@attach scrollFade('y')}>
					{#each linked as { target, note: to } (target)}
						<li class="flex items-center gap-1">
							{#if to}
								{@render row(to, () => onOpen(target))}
							{:else if gone.has(target)}
								<p class="flex min-h-11 flex-1 items-center px-2 text-muted-foreground">
									A note that is no longer here.
								</p>
							{:else}
								<Skeleton class="h-9 flex-1" />
							{/if}
							<Button
								variant="ghost"
								size="icon"
								class="size-11 shrink-0 text-muted-foreground hover:text-destructive"
								aria-label={to ? `Unlink ${to.address}` : 'Unlink'}
								disabled={linking}
								onclick={() => unlink(target)}
							>
								<X class="size-4" />
							</Button>
						</li>
					{/each}
				</ul>
			{/if}

			{#if backlinks.length > 0}
				<h2 class="text-sm font-medium text-muted-foreground">Linked from</h2>
				<ul class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto" {@attach scrollFade('y')}>
					{#each backlinks as from (from.ref)}
						<li>{@render row(from, () => onOpen(from.ref))}</li>
					{/each}
				</ul>
			{/if}

			<Button variant="outline" class="h-11" disabled={linking} onclick={onLinkOnGraph}>
				<Link2 class="size-4" />
				Link to another note
			</Button>

			<Input
				bind:value={cited}
				class="h-11"
				placeholder="Or link by title or address"
				aria-label="Link by title or address"
				autocapitalize="none"
				autocomplete="off"
				spellcheck="false"
			/>

			{#if citable.length > 0}
				<ul
					aria-label="Notes to link to"
					class="scroll-fade-y max-h-64 space-y-0.5 overflow-y-auto"
					{@attach scrollFade('y')}
				>
					{#each citable as note (note.ref)}
						<li>
							{@render row(note, () => {
								cited = '';
								void link(note.ref);
							})}
						</li>
					{/each}
				</ul>
			{:else if cited.trim()}
				<p class="px-2 text-sm text-muted-foreground">Nothing here matches that.</p>
			{/if}

			{#if linkRefused}<p class="text-sm text-destructive" role="alert">{linkRefused}</p>{/if}
		</div>

		<div class="border-t border-border pt-6">
			<Button
				variant="ghost"
				class="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
				onclick={() => (removing = true)}
			>
				<Trash2 class="size-4" />
				Delete this note
			</Button>

			{#if undeletable}
				<p class="mt-2 text-sm text-destructive" role="alert">{undeletable}</p>
			{/if}
		</div>

		{#if !writing && ways.some((way) => way.to)}
			<!-- `--foot` is the OS bar and a breath above it: the bar is padded by it
			     so no target lands under the bar, and bled past the note by it so the
			     strip meets the foot of a sheet. The filler carries the strip on down
			     a surface that stands further off its own bottom edge. -->
			<nav
				aria-label="Nearby notes"
				style="--foot: calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 1rem)"
				class="sticky bottom-[calc(var(--foot)*-1)] z-10 -mx-2 -mb-[var(--foot)] flex items-center gap-1 border-t border-border bg-background px-2 pt-1 pb-[var(--foot)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-8 after:bg-background after:content-[''] sm:-mx-1 sm:px-1"
			>
				{#each ways as way (way.says)}
					{@const Way = way.icon}
					<Button
						variant="ghost"
						class="h-11 min-w-0 flex-1 gap-1.5 px-1 text-muted-foreground"
						disabled={!way.to}
						aria-label={way.to ? `${way.says}, ${way.to.address}` : way.says}
						onclick={() => way.to && onOpen(way.to.ref)}
					>
						<Way class="size-4 shrink-0" />
						{#if way.to}<span class="address truncate text-xs">{way.to.address}</span>{/if}
					</Button>
				{/each}
			</nav>
		{/if}

		<TemplatePicker
			open={shaping !== null}
			onOpenChange={(v) => {
				if (!v) shaping = null;
			}}
			{suggested}
			existing={offered === 'this'}
			onpick={pickShape}
		/>

		<ConfirmModal
			bind:open={removing}
			title="Delete this note?"
			description={consequence}
			confirmLabel="Delete"
			onconfirm={deleteNote}
		/>
	{/if}
</div>
