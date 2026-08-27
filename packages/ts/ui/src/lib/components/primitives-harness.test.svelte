<script lang="ts">
	import * as Card from './ui/card/index.js';
	import * as DropdownMenu from './ui/dropdown-menu/index.js';
	import * as Popover from './ui/popover/index.js';
	import * as ScrollArea from './ui/scroll-area/index.js';
	import * as Select from './ui/select/index.js';
	import * as Tabs from './ui/tabs/index.js';
	import * as Tooltip from './ui/tooltip/index.js';
	import { Badge } from './ui/badge/index.js';
	import { Button } from './ui/button/index.js';
	import { Input } from './ui/input/index.js';
	import { Label } from './ui/label/index.js';
	import { Separator } from './ui/separator/index.js';
	import { Skeleton } from './ui/skeleton/index.js';
	import { Switch } from './ui/switch/index.js';
	import { Textarea } from './ui/textarea/index.js';
	import { Toaster } from './ui/sonner/index.js';
</script>

<Badge>seed</Badge>
<Button>Add a node</Button>
<Card.Root>
	<Card.Header>
		<Card.Title>A thought</Card.Title>
		<Card.Description>and what it sprang from</Card.Description>
		<Card.Action><Button>Open</Button></Card.Action>
	</Card.Header>
	<Card.Content>1a1</Card.Content>
	<Card.Footer>domain:biology</Card.Footer>
</Card.Root>

<Label for="title">Title</Label>
<Input id="title" value="A thought" />
<Textarea value="the body" />
<Switch checked />
<Separator />
<Skeleton />

<ScrollArea.Root><ScrollArea.Scrollbar orientation="vertical" /></ScrollArea.Root>

<Tabs.Root value="graph">
	<Tabs.List>
		<Tabs.Trigger value="graph">Graph</Tabs.Trigger>
		<Tabs.Trigger value="labels">Labels</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="graph">the graph</Tabs.Content>
</Tabs.Root>

<Select.Root type="single" value="domain" open>
	<Select.Trigger>domain</Select.Trigger>
	<Select.Content>
		<Select.Group>
			<Select.GroupHeading>Dimensions</Select.GroupHeading>
			<Select.Item value="domain">domain</Select.Item>
			<Select.Separator />
			<Select.Item value="status">status</Select.Item>
		</Select.Group>
	</Select.Content>
</Select.Root>

<DropdownMenu.Root open>
	<DropdownMenu.Trigger>More</DropdownMenu.Trigger>
	<DropdownMenu.Content>
		<DropdownMenu.Label>Node</DropdownMenu.Label>
		<DropdownMenu.Group>
			<DropdownMenu.Item>
				Publish
				<DropdownMenu.Shortcut>⌘P</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.CheckboxItem checked>Show addresses</DropdownMenu.CheckboxItem>
		</DropdownMenu.Group>
		<DropdownMenu.RadioGroup value="seed">
			<DropdownMenu.RadioItem value="seed">seed</DropdownMenu.RadioItem>
		</DropdownMenu.RadioGroup>
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>Move</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent>
				<DropdownMenu.Item>Under 1a</DropdownMenu.Item>
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	</DropdownMenu.Content>
</DropdownMenu.Root>

<Popover.Root open>
	<Popover.Trigger>Labels</Popover.Trigger>
	<Popover.Content>domain:biology</Popover.Content>
</Popover.Root>

<Tooltip.Provider>
	<Tooltip.Root open>
		<Tooltip.Trigger>1a1</Tooltip.Trigger>
		<Tooltip.Content>Third in the sequence</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>

<Toaster />
