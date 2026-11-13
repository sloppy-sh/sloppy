import { beforeAll, describe, expect, it, vi } from "vitest";
import { MARKDOWN, NAMED, OTHER_REF, PICTURES, REF } from "./fixtures/note";
import { boot, type Sloppy } from "./page";
import type { Said } from "./wire";

vi.mock("./diagrams", () => ({ drawDiagrams: vi.fn(async () => {}) }));

const said: Said[] = [];
let sloppy: Sloppy;

beforeAll(() => {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.sloppy = { send: (json: string) => said.push(JSON.parse(json)) };
  const root = document.createElement("main");
  document.body.append(root);
  sloppy = boot(window, root);
});

function click(selector: string): boolean {
  const target = document.querySelector(selector)!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const last = () => said.at(-1);

describe("the page the headset reads a note in", () => {
  it("says it is ready once, through the panel's own send", () => {
    expect(said.filter((each) => each.kind === "ready")).toHaveLength(1);
    expect(window.sloppy).toBe(sloppy);
  });

  it("renders what it is handed, as an object or as JSON", async () => {
    await sloppy.render(
      JSON.stringify({ markdown: MARKDOWN, named: NAMED, pictures: PICTURES }),
    );
    expect(document.querySelector("table")).not.toBeNull();
    await sloppy.render({ markdown: "Only this." });
    expect(document.querySelector("main")?.textContent?.trim()).toBe(
      "Only this.",
    );
  });

  it("wears the look it is handed", async () => {
    await sloppy.render({
      markdown: "Dark.",
      look: {
        paper: [0.215, 0.008, 260],
        ink: "#e6e6e6",
        faces: { ui: "atkinson" },
      },
    });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--paper")).toBe("oklch(0.215 0.008 260)");
    expect(style.getPropertyValue("--ink")).toBe("#e6e6e6");
    expect(style.getPropertyValue("--face-ui")).toContain(
      "Atkinson Hyperlegible",
    );
    expect(document.documentElement.hasAttribute("data-dark")).toBe(true);
  });

  it("tells the headset which note a link names, and goes nowhere itself", async () => {
    await sloppy.render({
      markdown: MARKDOWN,
      named: NAMED,
      pictures: PICTURES,
    });
    expect(click(`a[data-note="${REF}"]`)).toBe(true);
    expect(last()).toEqual({ kind: "link", href: `sloppy:${REF}`, note: REF });
    click(`a[data-note="${OTHER_REF}"]`);
    expect(last()).toEqual({
      kind: "link",
      href: `sloppy:${OTHER_REF}`,
      note: OTHER_REF,
    });
    click('a[data-note="1a2"]');
    expect(last()).toEqual({ kind: "link", href: "1a2", address: "1a2" });
  });

  it("hands a link out of the graph to the headset to open", () => {
    expect(click("a.web-link")).toBe(true);
    expect(last()).toEqual({
      kind: "link",
      href: "https://example.com/kettle",
    });
  });

  it("keeps a link to somewhere on the page to itself", async () => {
    await sloppy.render({ markdown: "A claim.[^1]\n\n[^1]: The source." });
    const before = said.length;
    expect(click("a.on-page")).toBe(true);
    expect(said.length).toBe(before);
  });
});
