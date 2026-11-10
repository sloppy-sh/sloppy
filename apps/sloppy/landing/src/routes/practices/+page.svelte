<script lang="ts">
	import { resolve } from '$app/paths';
	import { PRACTICES } from '$lib/links';
	import { approach } from '$lib/approaches';
	import { groupOf, subjectsWithRuns, valueOf } from '$lib/readings';
	import PageHead from '$lib/sections/PageHead.svelte';
	import SiteFooter from '$lib/sections/SiteFooter.svelte';
	import SiteHeader from '$lib/sections/SiteHeader.svelte';

	let { data } = $props();
	const summary = $derived(data.summary);

	/** How far the new text an agent takes in fell, across the projects measured. */
	const spared = $derived(
		subjectsWithRuns(summary)
			.map((subject) => {
				const plain = groupOf(summary, subject, 'medium', approach('plain'));
				const sloppy = groupOf(summary, subject, 'medium', approach('sloppy'));
				const a = plain && valueOf(plain, 'input');
				const b = sloppy && valueOf(sloppy, 'input');
				return a && b ? 1 - b / a : null;
			})
			.filter((r): r is number => r !== null)
			.sort((a, b) => a - b)
	);
	const pct = (r: number) => `${Math.round(r * 100)}%`;

	const h2 = 'text-2xl font-semibold tracking-tight';
	const link = 'underline underline-offset-2 hover:text-muted-foreground';
</script>

<svelte:head>
	<title>Shaping a project for Sloppy</title>
	<meta
		name="description"
		content="How to write and keep a project's notes so Sloppy finds the right one: one decision per document, titles that say the decision, notes that point at their code, and what to leave alone."
	/>
</svelte:head>

<div class="min-h-dvh bg-background text-foreground">
	<SiteHeader isSample={data.isSample} />
	<main>
		<PageHead trail={[{ label: 'Practices' }]} title="Shaping a project for Sloppy.">
			<p>
				Sloppy pays when an agent without it would not find the document that holds the reason.
				Everything below follows from that.
			</p>
		</PageHead>

		<div class="type-body mx-auto max-w-6xl space-y-14 px-4 py-16 sm:px-8 [&>*]:max-w-3xl">
			<section aria-labelledby="one">
				<h2 id="one" class={h2}>One decision per document</h2>
				<p class="mt-5">
					A question is matched against a document's title and headings, and one title names one
					decision. A document that settles five things matches all five weakly. Split it where its
					sections stop depending on each other, and link the parts.
				</p>
			</section>

			<section aria-labelledby="title">
				<h2 id="title" class={h2}>Title it with the decision, not the topic</h2>
				<p class="mt-5">
					Write the heading in the words somebody would ask in. “An id-primary store with
					lazily-validated hints” is found by the question it answers; “Design” and “Notes” by
					nothing. A dated or numbered file name costs nothing as long as the heading says what was
					decided.
				</p>
			</section>

			<section aria-labelledby="opening">
				<h2 id="opening" class={h2}>
					Put the decision in the opening, and the rest behind headings
				</h2>
				<p class="mt-5">
					An agent is shown a document's opening and its headings, then asks for the one it needs.
					An opening that states the decision and its reason often answers outright, and headings
					that say what a section settles — “Alternatives rejected”, “Why not a global lock” — spare
					it the rest.
				</p>
			</section>

			<section aria-labelledby="code">
				<h2 id="code" class={h2}>Point every document at the code it explains</h2>
				<p class="mt-5">
					A line naming the files is enough. Every path becomes a link from its note, so an agent
					goes from the reason straight to the lines instead of searching for them — and it is what
					tells you later when a document falls behind its code.
				</p>
			</section>

			<section aria-labelledby="instructions">
				<h2 id="instructions" class={h2}>Keep the instructions file to what every task needs</h2>
				<p class="mt-5">
					Build, test, style, the rules every change follows, and one line saying the reasons are in
					the notes and should be read before answering why. A mandatory reading list is worse than
					nothing: the agent dutifully reads the list and never opens the document that answers.
				</p>
			</section>

			<section aria-labelledby="searchable">
				<h2 id="searchable" class={h2}>Never make the project harder to search</h2>
				<p class="mt-5">
					Across the projects measured, the new text an agent took in fell by between {pct(
						spared[0]
					)} and {pct(spared[spared.length - 1])}. The low end is where a file name or an index
					already told the agent which document answered; the high end is where nothing did.
				</p>
				<p class="mt-4">
					An index, and names that say what is inside, are a project doing that searching itself, so
					they shrink what Sloppy has left to add. Keep them anyway: a narrower margin here means
					every reader already reaches the reason quickly.
				</p>
			</section>

			<section aria-labelledby="keep">
				<h2 id="keep" class={h2}>Bring in what you have, then keep it true</h2>
				<ul class="mt-5 space-y-3">
					<li>
						Carry existing documents one document per note. Every project measured was set up that
						way, word for word, with nothing rewritten first.
					</li>
					<li>
						Tag each note with the system it is about, one word, reusing the words already in the
						graph before inventing new ones.
					</li>
					<li>
						Check the notes against the code in CI and fix the ones it names. A note that
						contradicts the code misleads an agent that trusts it.
					</li>
				</ul>
			</section>

			<section aria-labelledby="little">
				<h2 id="little" class={h2}>Where this does not pay</h2>
				<p class="mt-5">
					Where one search of file names already finds the answer, where the answer lives in the
					code rather than a document, and where the instructions file already carries the reasons.
					On briefings it can do worse, working from excerpts of several notes instead of one whole.
				</p>
				<p class="mt-4">
					And on one project, a model's rewrite of titles and openings that already did most of this
					made every reader worse — with Sloppy, without, and with subagents alike. The same project
					shaped as a maintainer would — one line per document naming the component it governs, a
					tag per note, titles untouched — came out ahead. Try these on the questions your team
					asks, and keep what measures better.
				</p>
				<p class="mt-5">
					<a class={link} href={resolve('/results')}>The results</a>
					<span class="text-muted-foreground">show how far this went on each project, and</span>
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- links off this site -->
					<a class={link} href={PRACTICES}>the long version</a>
					<span class="text-muted-foreground">
						sets each practice against the runs behind it, including the ones it did not test.</span
					>
				</p>
			</section>
		</div>
	</main>
	<SiteFooter generatedAt={summary.generated_at} />
</div>
