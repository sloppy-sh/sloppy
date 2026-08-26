#!/usr/bin/env node
/**
 * Re-applies the two corrections `tauri ios init` cannot know about — the iPad
 * target and the `sloppy://` scheme — to `gen/apple/project.yml`, then
 * regenerates the project from it. Idempotent, and loud rather than silent: a
 * missing anchor means the generator changed shape. XCODE_PROJECT.md is the doc
 * of record.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const appleDir = join(nativeDir, 'src-tauri', 'gen', 'apple');
const projectYml = join(appleDir, 'project.yml');

/** Target sources that no clone carries: `Externals` is build output and
 *  gitignored, `assets` is empty until something is put in it, and git carries
 *  no empty directory. xcodegen rejects the whole spec if either is absent. */
const UNTRACKED_SOURCE_DIRS = ['Externals', 'assets'];

const fail = (message) => {
	console.error(`✗ ${message}`);
	process.exit(1);
};

if (!existsSync(projectYml)) fail(`${projectYml} is missing — run \`pnpm tauri ios init\` first`);

const tauriConf = JSON.parse(readFileSync(join(nativeDir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const schemes = tauriConf.plugins?.['deep-link']?.desktop?.schemes ?? [];
if (schemes.length === 0) fail('tauri.conf.json declares no deep-link scheme');

const before = readFileSync(projectYml, 'utf8');
let yaml = before;

if (/^\s*LSRequiresIPhoneOS:\s*true\s*$/m.test(yaml)) {
	yaml = yaml.replace(/^(\s*)LSRequiresIPhoneOS:\s*true\s*$/m, '$1LSRequiresIPhoneOS: false');
} else if (!/^\s*LSRequiresIPhoneOS:\s*false\s*$/m.test(yaml)) {
	fail('project.yml has no LSRequiresIPhoneOS key — the generator changed');
}

if (!/^\s*TARGETED_DEVICE_FAMILY:/m.test(yaml)) {
	// The `app` setting group is what every target inherits via `groups: [app]`.
	const anchor = /^(\s*)(PRODUCT_BUNDLE_IDENTIFIER:.*)$/m;
	if (!anchor.test(yaml)) fail('project.yml has no PRODUCT_BUNDLE_IDENTIFIER to anchor to');
	yaml = yaml.replace(anchor, '$1$2\n$1TARGETED_DEVICE_FAMILY: "1,2"');
}

if (!/^\s*CFBundleURLTypes:/m.test(yaml)) {
	const anchor = /^(\s*)(LSRequiresIPhoneOS:.*)$/m;
	if (!anchor.test(yaml)) fail('project.yml has no LSRequiresIPhoneOS to anchor to');
	const [, pad] = yaml.match(anchor);
	const entries = schemes
		.map((s) => `${pad}  - CFBundleURLName: ${s}\n${pad}    CFBundleURLSchemes: [${s}]`)
		.join('\n');
	yaml = yaml.replace(anchor, `${pad}CFBundleURLTypes:\n${entries}\n$1$2`);
}

if (yaml !== before) writeFileSync(projectYml, yaml);

for (const dir of UNTRACKED_SOURCE_DIRS) mkdirSync(join(appleDir, dir), { recursive: true });

execFileSync('xcodegen', ['generate'], { cwd: appleDir, stdio: 'inherit' });
console.log(yaml === before ? '── Xcode project already patched' : '── Xcode project patched');
