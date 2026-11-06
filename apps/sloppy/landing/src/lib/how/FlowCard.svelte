<script lang="ts">
	import BookOpen from '@lucide/svelte/icons/book-open';
	import Bot from '@lucide/svelte/icons/bot';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Crosshair from '@lucide/svelte/icons/crosshair';
	import FileCode from '@lucide/svelte/icons/file-code';
	import FileText from '@lucide/svelte/icons/file-text';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Network from '@lucide/svelte/icons/network';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Reply from '@lucide/svelte/icons/reply';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Terminal from '@lucide/svelte/icons/terminal';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import User from '@lucide/svelte/icons/user';
	import { Handle, Position } from '@xyflow/svelte';
	import { KIND_ICON, type Card, type IconName } from './pipeline';

	let { data }: { data: { card: Card } } = $props();

	const ICONS = {
		'book-open': BookOpen,
		bot: Bot,
		'chevron-right': ChevronRight,
		crosshair: Crosshair,
		'file-code': FileCode,
		'file-text': FileText,
		'message-square': MessageSquare,
		network: Network,
		pencil: Pencil,
		reply: Reply,
		'scroll-text': ScrollText,
		terminal: Terminal,
		'trending-up': TrendingUp,
		'triangle-alert': TriangleAlert,
		user: User
	} satisfies Record<IconName, unknown>;

	const card = $derived(data.card);
	const named = $derived(card.icon ?? KIND_ICON[card.kind]);
	const Icon = $derived(named ? ICONS[named] : undefined);
</script>

<div class="flow-card" data-kind={card.kind}>
	<Handle id="top" type="target" position={Position.Top} isConnectable={false} />
	<Handle id="left" type="target" position={Position.Left} isConnectable={false} />
	<p class="flow-card-title">
		{#if Icon}<Icon class="flow-card-icon" size={14} aria-hidden="true" />{/if}<span
			>{card.title}</span
		>
	</p>
	{#if card.body}<p class="flow-card-body">{card.body}</p>{/if}
	{#if card.code}<p class="flow-card-code">{card.code}</p>{/if}
	<Handle id="right" type="source" position={Position.Right} isConnectable={false} />
	<Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false} />
</div>
