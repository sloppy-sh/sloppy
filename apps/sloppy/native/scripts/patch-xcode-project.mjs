#!/usr/bin/env node
/**
 * Teach the generated Xcode project the two things `tauri ios init` does not
 * know about Sloppy: that its primary device is an iPad, and that it answers a
 * `sloppy://` URL. XCODE_PROJECT.md says what each costs when it is missing.
 *
 * It edits `gen/apple/project.yml` and regenerates from it, because `Info.plist`
 * and the pbxproj are both outputs of that file — and because `tauri ios init`
 * rewrites it from scratch, so an edit made by hand lasts until the next init.
 * `scripts/tauri.sh` therefore runs this for every `ios` command.
 *
 * Idempotent, and loud rather than silent: if an anchor is missing the generator
 * has changed shape, and a failed build is much cheaper than an iPad running a
 * phone-shaped app that nobody notices.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nativeDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const appleDir = join(nativeDir, 'src-tauri', 'gen', 'apple');
const projectYml = join(appleDir, 'project.yml');

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
	// Sits beside the other Info.plist properties, so xcodegen writes it every
	// time rather than it being an edit to the plist that the next generate eats.
	const anchor = /^(\s*)(LSRequiresIPhoneOS:.*)$/m;
	if (!anchor.test(yaml)) fail('project.yml has no LSRequiresIPhoneOS to anchor to');
	const [, pad] = yaml.match(anchor);
	const entries = schemes
		.map((s) => `${pad}  - CFBundleURLName: ${s}\n${pad}    CFBundleURLSchemes: [${s}]`)
		.join('\n');
	yaml = yaml.replace(anchor, `${pad}CFBundleURLTypes:\n${entries}\n$1$2`);
}

if (yaml !== before) writeFileSync(projectYml, yaml);

execFileSync('xcodegen', ['generate'], { cwd: appleDir, stdio: 'inherit' });
console.log(yaml === before ? '── Xcode project already patched' : '── Xcode project patched');
