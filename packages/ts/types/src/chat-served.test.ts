// How Sloppy's acts are served to an assistant outside the app.

import { describe, expect, it } from "vitest";
import {
  CORE_CHAT_TOOLS,
  DEFAULT_SERVING,
  LEAN_SERVING,
  type ServingShape,
  servedChatTools,
} from "./chat-served.js";
import {
  advertisedChatTools,
  CHAT_TOOLS,
  chatToolWrites,
  DOCTRINES,
} from "./chat.js";

const size = (serving: ServingShape) =>
  JSON.stringify(servedChatTools(serving)).length;

describe("the acts served to an assistant", () => {
  it("are the chat's own, as the chat advertises them, where nothing says otherwise", () => {
    for (const doctrine of DOCTRINES) {
      expect(servedChatTools({ ...DEFAULT_SERVING, doctrine })).toEqual(
        advertisedChatTools(doctrine, true),
      );
    }
  });

  it("keep, in the core set, the acts that answer and the two that write a note's words and lines, and leave the rest to the full set", () => {
    const core = new Set<string>(CORE_CHAT_TOOLS);
    for (const act of [
      "brief",
      "search_notes",
      "read_note",
      "read_around",
      "list_notes",
      "find_code",
      "write_note",
      "link_notes",
    ]) {
      expect(core.has(act)).toBe(true);
    }
    expect(CHAT_TOOLS.filter((act) => !core.has(act)).sort()).toEqual(
      [
        "style_edge",
        "style_note",
        "list_bin",
        "restore_note",
        "list_offers",
        "read_graph",
        "relate",
        "list_tags",
        "tag_note",
        "move_note",
        "number_note",
        "delete_note",
        "show_note",
        "find_note",
      ].sort(),
    );
  });

  it("keep, in core words, every argument of a core act with its type and whether it is required, and offer no other place to read", () => {
    const full = servedChatTools({ ...DEFAULT_SERVING, tools: "default" });
    const core = servedChatTools({ ...DEFAULT_SERVING, tools: "core" });
    expect(core.map((one) => one.name)).toEqual([...CORE_CHAT_TOOLS]);
    for (const one of core) {
      expect(one.description.length).toBeGreaterThan(0);
      expect(one.description.length).toBeLessThanOrEqual(200);
      const whole = full.find((act) => act.name === one.name)?.arguments ?? {};
      const wholeProperties = (whole.properties ?? {}) as Record<
        string,
        { type?: string; enum?: unknown; items?: { type?: string } }
      >;
      const properties = (one.arguments.properties ?? {}) as Record<
        string,
        {
          description?: string;
          type?: string;
          enum?: unknown;
          items?: { type?: string };
        }
      >;
      expect(Object.keys(properties)).toEqual(
        Object.keys(wholeProperties).filter((field) => field !== "in"),
      );
      for (const [field, shape] of Object.entries(properties)) {
        const was = wholeProperties[field];
        expect(shape.type).toBe(was?.type);
        expect(shape.enum).toEqual(was?.enum);
        expect(shape.items?.type).toBe(was?.items?.type);
        expect((shape.description ?? "").length).toBeLessThanOrEqual(100);
      }
      expect(one.arguments.required ?? []).toEqual(
        ((whole.required ?? []) as string[]).filter((field) => field !== "in"),
      );
    }
  });

  it("cost under 5,500 characters in the lean profile", () => {
    expect(size(LEAN_SERVING)).toBeLessThan(5_500);
  });

  it("cost under half as much in core words as every act in the chat's", () => {
    expect(size({ ...DEFAULT_SERVING, tools: "core" }) * 2).toBeLessThan(
      size(DEFAULT_SERVING),
    );
    expect(size(LEAN_SERVING) * 2).toBeLessThan(size(DEFAULT_SERVING));
  });

  it("tell the agent to read the lines an answer names where answers land on code", () => {
    for (const tools of ["default", "core"] as const) {
      const served = servedChatTools({
        ...DEFAULT_SERVING,
        tools,
        landOnCode: true,
      });
      for (const name of ["search_notes", "brief", "read_note"]) {
        expect(served.find((one) => one.name === name)?.description).toContain(
          "do not grep for them",
        );
      }
      expect(served.find((one) => one.name === "brief")?.description).toContain(
        "Usually the only call",
      );
    }
  });

  it("say a long note comes back as its opening and headings only where answers land on code", () => {
    const readNote = (serving: typeof DEFAULT_SERVING) =>
      servedChatTools(serving).find((one) => one.name === "read_note")
        ?.description;
    for (const tools of ["default", "core"] as const) {
      expect(
        readNote({ ...DEFAULT_SERVING, tools, landOnCode: true }),
      ).toContain("its opening and headings");
      expect(readNote({ ...DEFAULT_SERVING, tools })).not.toContain(
        "its opening and headings",
      );
    }
  });

  it("tell the agent to look in the notes first under that doctrine, in core words too", () => {
    const search = servedChatTools({
      ...LEAN_SERVING,
      doctrine: "notes-first",
    }).find((one) => one.name === "search_notes");
    expect(search?.description).toContain("Look here before anything else");
  });
});
