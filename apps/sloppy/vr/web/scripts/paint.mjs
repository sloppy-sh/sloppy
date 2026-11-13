// Opens the built page in WebKit, as the headset would hand it a note, and
// checks it paints: a table, coloured code, a drawn diagram, live links.
// `pnpm paint [where-to-put-the-pictures]`; pictures default to the system's
// temporary folder, out of the Godot project's sight.

import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webkit } from "playwright";
import { MARKDOWN, NAMED, PICTURES, REF } from "../src/fixtures/note.ts";

const here = resolve(import.meta.dirname, "..");
const shots = resolve(process.argv[2] ?? tmpdir());
const LOOKS = {
  paper: {},
  graphite: {
    paper: [0.215, 0.008, 260],
    ink: [0.905, 0.006, 250],
    card: [0.23, 0.008, 260],
    edge: [0.31, 0.009, 260],
    faces: { ui: "atkinson", mono: "firacode" },
    density: "compact",
  },
};

const browser = await webkit.launch();
try {
  for (const [name, look] of Object.entries(LOOKS)) {
    const page = await browser.newPage({
      viewport: { width: 900, height: 1100 },
    });
    const troubles = [];
    page.on("pageerror", (error) => troubles.push(error.message));
    page.on(
      "console",
      (line) => line.type() === "error" && troubles.push(line.text()),
    );
    await page.addInitScript(() => {
      window.said = [];
      window.sloppy = { send: (json) => window.said.push(JSON.parse(json)) };
    });
    await page.goto(pathToFileURL(resolve(here, "dist/index.html")).href);
    await page.waitForFunction(() =>
      window.said.some((said) => said.kind === "ready"),
    );
    await page.evaluate((asked) => window.sloppy.render(asked), {
      markdown: MARKDOWN,
      named: NAMED,
      pictures: PICTURES,
      look,
    });

    const cell = await page.locator("td").first().boundingBox();
    assert.ok(cell && cell.width > 0 && cell.height > 0, "the table paints");
    const diagram = page.locator("figure[data-drawn] svg");
    assert.equal(await diagram.count(), 1, "the diagram is drawn");
    assert.match(await diagram.textContent(), /Grinder/);
    assert.ok(
      (await diagram.boundingBox()).height > 20,
      "the diagram has size",
    );
    const colours = await page.evaluate(
      () =>
        new Set(
          [...document.querySelectorAll(".shiki span span")].map(
            (run) => getComputedStyle(run).color,
          ),
        ).size,
    );
    assert.ok(colours >= 3, "code is coloured by what each part of it is");
    assert.ok(
      (await page.locator("img").evaluate((img) => img.naturalWidth)) > 0,
      "the picture handed over shows",
    );

    await page.locator(`a[data-note="${REF}"]`).click();
    await page.locator("a.web-link").click();
    const said = await page.evaluate(() => window.said);
    assert.deepEqual(
      said.filter((each) => each.kind === "link"),
      [
        { kind: "link", href: `sloppy:${REF}`, note: REF },
        { kind: "link", href: "https://example.com/kettle" },
      ],
    );
    const tall = await page.evaluate(() =>
      Math.ceil(document.body.getBoundingClientRect().height),
    );
    assert.equal(
      said.findLast((each) => each.kind === "height")?.px,
      tall,
      "the height told is the page's",
    );
    assert.ok(page.url().endsWith("index.html"), "no link took the page away");
    assert.deepEqual(troubles, []);

    const shot = resolve(shots, `paint-${name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`painted the ${name} look: ${shot}`);
    await page.close();
  }
} finally {
  await browser.close();
}
