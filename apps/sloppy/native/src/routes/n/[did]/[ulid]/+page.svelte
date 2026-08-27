<script lang="ts">
	import Node from '@sloppy/app-core/pages/node';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<Node did={params.did} ulid={params.ulid} />
