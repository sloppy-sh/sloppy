<script lang="ts">
	import { scaleLinear, scalePoint } from 'd3-scale';
	import { DRAW_ORDER } from '$lib/approaches';
	import { orList } from '$lib/readings';
	import BetterBadge from './BetterBadge.svelte';
	import { placeLabels } from './endLabels';
	import type { SeriesData, XPoint } from './types';

	interface Props {
		id: string;
		title: string;
		subtitle?: string;
		xs: XPoint[];
		series: SeriesData[];
		y: { domain: [number, number]; ticks: number[]; format: (v: number) => string };
		valueFormat: (v: number) => string;
		notes?: string[];
		/** Which way along the y-axis is the good direction. */
		better: 'higher' | 'lower';
		/** Draw each point's interval as a whisker. */
		intervals?: boolean;
		height?: number;
	}

	let {
		id,
		title,
		subtitle,
		xs,
		series,
		y,
		valueFormat,
		notes = [],
		better,
		intervals = false,
		height = 300
	}: Props = $props();

	const TOP = 12;
	const BOTTOM = 52;
	const LEFT = 44;
	const LABEL_GAP = 17;
	/** Inter at 12.5px, px per character with some room: semibold letters, then tabular digits. */
	const CHAR = 6.4;
	const DIGIT = 6.2;
	/** The step between projects below which a tick says "72k words" rather than "72k words of docs". */
	const ROOM_FOR_SUB = 132;
	const ROOM_FOR_LABEL = 132;
	/** How far apart, in px, the series' points at one project stand so their whiskers do not overlap. */
	const DODGE = 7;

	let measured = $state(0);
	let figure: HTMLElement | undefined = $state();
	let tipWidth = $state(0);
	let active: number | null = $state(null);

	const width = $derived(measured || 640);
	const full = $derived(width >= 720);
	const nameOf = (s: SeriesData) => (full ? s.label : s.short);

	const lastIndex = (s: SeriesData) => s.values.findLastIndex((v) => v !== null);
	const drawn = $derived(
		[...series]
			.filter((s) => lastIndex(s) >= 0)
			.sort(
				(a, b) =>
					DRAW_ORDER.indexOf(a.approach) - DRAW_ORDER.indexOf(b.approach) ||
					b.key.localeCompare(a.key)
			)
	);

	const labelRoom = $derived(
		Math.max(
			...drawn.map((s) => {
				const v = s.values[lastIndex(s)]!.v;
				return 22 + nameOf(s).length * CHAR + 6 + valueFormat(v).length * DIGIT;
			}),
			60
		)
	);
	/** On a phone, names at the line ends leave the projects too little room; the legend names them. */
	const endLabels = $derived(width >= 480 || labelRoom <= width * 0.4);
	const right = $derived(endLabels ? labelRoom : 16);

	const x = $derived(
		scalePoint<string>()
			.domain(xs.map((p) => p.subject))
			.range([LEFT, width - right])
			.padding(xs.length === 1 ? 0.5 : 0.25)
	);
	const yScale = $derived(
		scaleLinear()
			.domain(y.domain)
			.range([height - BOTTOM, TOP])
			.clamp(true)
	);
	const xAt = (i: number) => x(xs[i].subject) ?? LEFT;
	/** Too narrow a step for the projects' names side by side: alternate them over two lines. */
	const stagger = $derived(xs.length > 1 && x.step() < 90);
	const offsetOf = (s: SeriesData) => {
		if (!intervals) return 0;
		const k = drawn.indexOf(s);
		return (k - (drawn.length - 1) / 2) * DODGE;
	};
	const px = (s: SeriesData, i: number) => xAt(i) + offsetOf(s);

	function path(s: SeriesData): string {
		let d = '';
		s.values.forEach((v, i) => {
			if (!v) return;
			const joined = i > 0 && s.values[i - 1] !== null;
			d += `${joined ? 'L' : 'M'}${px(s, i).toFixed(1)} ${yScale(v.v).toFixed(1)}`;
		});
		return d;
	}

	const labels = $derived.by(() => {
		if (!endLabels) return [];
		const ends = drawn.map((s) => {
			const i = lastIndex(s);
			return { s, i, px: px(s, i), py: yScale(s.values[i]!.v) };
		});
		const edge = Math.max(...ends.map((e) => e.px), LEFT);
		const placed = placeLabels(
			ends.map((e) => e.py),
			LABEL_GAP,
			TOP + 4,
			height - BOTTOM
		);
		return ends.map((e, k) => {
			const leader = Math.abs(placed[k] - e.py) > 3 || e.px < edge - 1;
			return { ...e, y: placed[k], leader, lx: edge + (leader ? 18 : 10) };
		});
	});

	function snap(clientX: number, svg: SVGSVGElement): number | null {
		const at = clientX - svg.getBoundingClientRect().left;
		const half = Math.max(x.step() / 2, 40);
		const i = xs.findIndex((_, k) => Math.abs(xAt(k) - at) <= half);
		return i < 0 ? null : i;
	}

	function onpointer(event: PointerEvent) {
		active = snap(event.clientX, event.currentTarget as SVGSVGElement);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight')
			active = active === null ? 0 : Math.min(xs.length - 1, active + 1);
		else if (event.key === 'ArrowLeft')
			active = active === null ? xs.length - 1 : Math.max(0, active - 1);
		else if (event.key === 'Escape') active = null;
		else return;
		event.preventDefault();
	}

	$effect(() => {
		const away = (event: PointerEvent) => {
			if (figure && !figure.contains(event.target as Node)) active = null;
		};
		document.addEventListener('pointerdown', away);
		return () => document.removeEventListener('pointerdown', away);
	});

	const interval = (v: { lo: number | null; hi: number | null }) =>
		v.lo === null || v.hi === null ? '' : `${valueFormat(v.lo)}–${valueFormat(v.hi)}`;

	const rows = $derived(
		active === null
			? []
			: series
					.filter((s) => s.values[active!] !== null)
					.map((s) => ({ s, value: s.values[active!]! }))
					.sort((a, b) => b.value.v - a.value.v)
	);
	const notRun = $derived(
		active === null ? [] : series.filter((s) => s.values[active!] === null).map((s) => s.label)
	);
	const tipLeft = $derived.by(() => {
		if (active === null) return 0;
		const at = xAt(active);
		return at + 16 + tipWidth > width ? Math.max(0, at - 16 - tipWidth) : at + 16;
	});

	const description = $derived(
		series
			.map((s) => {
				const ran = xs.flatMap((p, i) =>
					s.values[i] ? [`${p.label} ${valueFormat(s.values[i]!.v)}`] : []
				);
				const missing = xs.filter((_, i) => !s.values[i]).map((p) => p.label);
				const parts = [ran.join(', '), missing.length ? `not run on ${orList(missing)}` : '']
					.filter(Boolean)
					.join('; ');
				return `${s.label}: ${parts}.`;
			})
			.join(' ')
	);
</script>

<figure bind:this={figure} class="min-w-0" aria-labelledby="{id}-heading" data-chart>
	<figcaption>
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h3 id="{id}-heading" class="text-lg font-semibold">{title}</h3>
			<BetterBadge {better} />
		</div>
		{#if subtitle}<p class="mt-1 text-sm text-muted-foreground">{subtitle}</p>{/if}
	</figcaption>

	{#if drawn.length}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="chart relative mt-5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
			style:height="{height}px"
			bind:clientWidth={measured}
			role="group"
			tabindex="0"
			aria-label="{title}, use the arrow keys to read each project"
			{onkeydown}
			onblur={() => (active = null)}
		>
			<svg
				role="img"
				aria-labelledby="{id}-title {id}-desc"
				width={measured ? width : '100%'}
				{height}
				viewBox={measured ? undefined : `0 0 ${width} ${height}`}
				class="block overflow-visible"
				onpointermove={onpointer}
				onpointerdown={onpointer}
				onpointerleave={(e) => {
					if (e.pointerType === 'mouse') active = null;
				}}
			>
				<title id="{id}-title">{title}</title>
				<desc id="{id}-desc">{description}</desc>

				{#each y.ticks as tick (tick)}
					<line
						x1={LEFT}
						x2={width - right + 8}
						y1={yScale(tick)}
						y2={yScale(tick)}
						class="stroke-border"
						shape-rendering="crispEdges"
					/>
					<text
						x={LEFT - 8}
						y={yScale(tick)}
						text-anchor="end"
						dominant-baseline="middle"
						class="fill-muted-foreground text-[12px] tabular-nums">{y.format(tick)}</text
					>
				{/each}

				{#each xs as point, i (point.subject)}
					<text
						x={xAt(i)}
						y={height - BOTTOM + 22 + (stagger && i % 2 ? 17 : 0)}
						text-anchor="middle"
						class="text-[13px]"
					>
						<tspan class="fill-foreground font-semibold"
							>{x.step() >= ROOM_FOR_LABEL || xs.length === 1
								? point.label
								: point.labelShort}</tspan
						>
						{#if !stagger}
							<tspan x={xAt(i)} dy="17" class="fill-muted-foreground text-[12px]"
								>{x.step() >= ROOM_FOR_SUB || xs.length === 1 ? point.sub : point.subShort}</tspan
							>
						{/if}
					</text>
				{/each}

				{#if active !== null}
					<line
						x1={xAt(active)}
						x2={xAt(active)}
						y1={TOP}
						y2={height - BOTTOM}
						class="stroke-muted-foreground"
						stroke-opacity="0.4"
					/>
				{/if}

				{#if intervals}
					{#each drawn as s (s.key)}
						{#each s.values as v, i (i)}
							{#if v && v.lo !== null && v.hi !== null}
								<g class="series-whisker" style:stroke={s.colour} stroke-opacity="0.55">
									<line x1={px(s, i)} x2={px(s, i)} y1={yScale(v.lo)} y2={yScale(v.hi)} />
									<line x1={px(s, i) - 3} x2={px(s, i) + 3} y1={yScale(v.lo)} y2={yScale(v.lo)} />
									<line x1={px(s, i) - 3} x2={px(s, i) + 3} y1={yScale(v.hi)} y2={yScale(v.hi)} />
								</g>
							{/if}
						{/each}
					{/each}
				{/if}

				{#each drawn as s (s.key)}
					<path
						d={path(s)}
						fill="none"
						class="series-line"
						data-approach={s.approach}
						style:stroke={s.colour}
						stroke-width={s.width}
						stroke-dasharray={s.dash || undefined}
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
				{/each}

				{#each drawn as s (s.key)}
					{#each s.values as v, i (i)}
						{#if v}
							<circle
								cx={px(s, i)}
								cy={yScale(v.v)}
								r={active === i ? 5 : 4}
								class="series-point stroke-card"
								style:fill={s.dash ? 'var(--card)' : s.colour}
								style:stroke={s.dash ? s.colour : undefined}
								stroke-width="2"
							/>
						{/if}
					{/each}
				{/each}

				{#each labels as l (l.s.key)}
					{#if l.leader}
						<line
							x1={l.px + 5}
							y1={l.py}
							x2={l.lx - 3}
							y2={l.y}
							class="stroke-muted-foreground"
							stroke-opacity="0.5"
						/>
					{/if}
					<text x={l.lx} y={l.y} dominant-baseline="middle" class="text-[12.5px]">
						<tspan class="fill-foreground font-semibold">{nameOf(l.s)}</tspan>
						<tspan dx="6" class="fill-muted-foreground tabular-nums"
							>{valueFormat(l.s.values[l.i]!.v)}</tspan
						>
					</text>
				{/each}
			</svg>

			<div aria-live="polite" class="sr-only">
				{#if active !== null}
					{xs[active].label}: {rows
						.map((r) => `${r.s.label} ${valueFormat(r.value.v)}, ${r.value.n} runs`)
						.join('; ')}
				{/if}
			</div>

			{#if active !== null}
				<div
					bind:clientWidth={tipWidth}
					class="pointer-events-none absolute top-2 z-10 w-max max-w-[22rem] rounded-lg border bg-popover px-2.5 py-2 text-sm text-popover-foreground shadow-sm"
					style:left="{tipLeft}px"
					aria-hidden="true"
				>
					<p class="font-semibold">
						{xs[active].label}
						<span class="font-normal text-muted-foreground">· {xs[active].sub}</span>
					</p>
					<table class="mt-1.5 tabular-nums">
						<tbody>
							{#each rows as r (r.s.key)}
								<tr>
									<td class="pr-2 align-middle">
										<svg width="14" height="4" aria-hidden="true" class="block">
											<line
												x1="1"
												x2="13"
												y1="2"
												y2="2"
												stroke-width="2.5"
												stroke-linecap="round"
												stroke-dasharray={r.s.dash || undefined}
												style:stroke={r.s.colour}
											/>
										</svg>
									</td>
									<td class="pr-2 font-semibold">{valueFormat(r.value.v)}</td>
									<td class="pr-3 whitespace-nowrap text-muted-foreground">{r.s.label}</td>
									<td class="text-right whitespace-nowrap text-muted-foreground"
										>{#if intervals && interval(r.value)}{interval(r.value)} ·
										{/if}{r.value.n} runs</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if notRun.length}
						<p class="mt-1.5 text-muted-foreground">Not run here: {notRun.join(', ')}</p>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<p class="mt-5 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
			Nothing has run under this choice yet.
		</p>
	{/if}

	<ul class="mt-4 space-y-1 text-sm leading-relaxed text-muted-foreground">
		{#each notes as note (note)}
			<li>{note}</li>
		{/each}
	</ul>

	<details class="mt-4 text-sm">
		<summary class="cursor-pointer text-muted-foreground hover:text-foreground"
			>Show the numbers</summary
		>
		<div class="mt-3 overflow-x-auto">
			<table class="w-full tabular-nums">
				<caption class="sr-only">{title}</caption>
				<thead class="text-muted-foreground">
					<tr class="border-b">
						<th scope="col" class="py-1.5 pr-3 text-left font-normal">Approach</th>
						{#each xs as point (point.subject)}
							<th scope="col" class="px-2 py-1.5 text-right font-normal">{point.label}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each series as s (s.key)}
						<tr class="border-b border-border/60">
							<th scope="row" class="py-1.5 pr-3 text-left font-normal whitespace-nowrap"
								>{s.label}</th
							>
							{#each s.values as v, i (i)}
								<td class="px-2 py-1.5 text-right whitespace-nowrap">
									{#if v}{valueFormat(v.v)}
										<span class="text-muted-foreground"
											>{#if interval(v)}({interval(v)}){/if} · {v.n} runs</span
										>
									{:else}<span class="text-muted-foreground">not run</span>{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>
