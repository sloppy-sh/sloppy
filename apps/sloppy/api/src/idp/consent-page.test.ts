// The manifest names a URL and a person's browser follows it, so the promise
// and the routing table have to be the same fact. Nothing else in the flow
// fails when they drift: the instance keeps answering, and sign-in dead-ends.
//
// The page is a script in a string, so the second suite runs it: a DOM small
// enough to read stands in for the browser, and the assertions are about what
// a person would see and type.

import "reflect-metadata";
import { runInNewContext } from "node:vm";
import { PATH_METADATA } from "@nestjs/common/constants";
import { instanceManifest, providerApiBase } from "@sloppy/idp";
import { describe, expect, it } from "vitest";
import { consentPage } from "./consent-page";
import { ConsentController } from "./consent.controller";

const BASE = "https://sloppy.example";

// `main.ts` mounts everything but the two discovery documents under this.
const API_PREFIX = "api";

describe("the consent page the manifest promises", () => {
  it("is served by the controller the manifest points at", () => {
    const controller = Reflect.getMetadata(PATH_METADATA, ConsentController);
    expect(instanceManifest(BASE).platform?.consent).toBe(
      `${BASE}/${API_PREFIX}/${controller}`,
    );
  });

  it("drives the provider's own endpoints and nothing else's", () => {
    const html = consentPage(providerApiBase(BASE));
    expect(html).toContain(`"${providerApiBase(BASE)}"`);
    expect(html.startsWith("<html")).toBe(true);
  });
});

const API = providerApiBase(BASE);
const PAGE = consentPage(API);
const SCRIPT = PAGE.slice(
  PAGE.indexOf("<script>") + "<script>".length,
  PAGE.lastIndexOf("</script>"),
);
const SEARCH =
  "?platform_origin=https%3A%2F%2Fapp.example" +
  "&callback_url=https%3A%2F%2Fapp.example%2Fback" +
  "&platform_name=Sloppy";
const DEVICE_KEY = "sloppy.idp.signed-in-here";

type Listener = (event: { preventDefault(): void }) => void;

class El {
  textContent = "";
  className = "";
  type = "";
  autocomplete = "";
  placeholder = "";
  value = "";
  required = false;
  disabled = false;
  minLength = 0;
  focused = false;
  children: El[] = [];
  readonly attributes: Record<string, string> = {};
  readonly listeners: Record<string, Listener[]> = {};

  constructor(readonly tag: string) {}

  appendChild(child: El): El {
    this.children.push(child);
    return child;
  }
  append(...kids: El[]): void {
    this.children.push(...kids);
  }
  replaceChildren(...kids: El[]): void {
    this.children = kids;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(name: string, run: Listener): void {
    (this.listeners[name] ??= []).push(run);
  }
  focus(): void {
    this.focused = true;
  }
  fire(name: string): void {
    for (const run of this.listeners[name] ?? []) run({ preventDefault() {} });
  }
}

type Reply = { ok: boolean; data: unknown };

function within(node: El): El[] {
  return node.children.flatMap((child) => [child, ...within(child)]);
}

function heading(root: El): string {
  return within(root).find((node) => node.tag === "h1")?.textContent ?? "";
}

function buttonSaying(root: El, text: string): El {
  const found = within(root).find(
    (node) => node.tag === "button" && node.textContent === text,
  );
  if (!found) throw new Error(`no button reading "${text}"`);
  return found;
}

function fieldNamed(root: El, label: string): El {
  const wrap = within(root).find(
    (node) => node.tag === "label" && node.textContent === label,
  );
  const input = wrap?.children.find((child) => child.tag === "input");
  if (!input) throw new Error(`no field labelled "${label}"`);
  return input;
}

function problem(root: El): El | undefined {
  return within(root).find((node) => node.className === "problem");
}

function focused(root: El): El | undefined {
  return within(root).find((node) => node.focused);
}

function submitForm(root: El): void {
  const form = within(root).find((node) => node.tag === "form");
  if (!form) throw new Error("no form on the page");
  form.fire("submit");
}

function openPage(
  options: {
    remembers?: boolean;
    answer?: (path: string, body: Record<string, unknown>) => Reply;
  } = {},
) {
  const root = new El("main");
  const device: Record<string, string> = options.remembers
    ? { [DEVICE_KEY]: "yes" }
    : {};
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const answer = options.answer ?? (() => ({ ok: true, data: {} }));

  runInNewContext(SCRIPT, {
    console,
    URL,
    URLSearchParams,
    document: {
      getElementById: () => root,
      createElement: (tag: string) => new El(tag),
    },
    location: { search: SEARCH, href: "" },
    localStorage: {
      getItem: (key: string) => device[key] ?? null,
      setItem: (key: string, value: string) => {
        device[key] = value;
      },
    },
    fetch: (url: string, init: { body: string }) => {
      const path = url.slice(API.length);
      const body = JSON.parse(init.body) as Record<string, unknown>;
      sent.push({ path, body });
      const reply = answer(path, body);
      return Promise.resolve({
        ok: reply.ok,
        json: () => Promise.resolve(reply.data),
      });
    },
  });

  return { root, device, sent };
}

/** The page's own promises resolve on the microtask queue. */
const settled = () => new Promise((done) => setTimeout(done, 0));

describe("which door the consent page opens on", () => {
  it("offers to make an identity when this device has never signed in here", () => {
    const { root } = openPage();
    expect(heading(root)).toBe("Create an identity");
    expect(buttonSaying(root, "I already have an identity")).toBeDefined();
  });

  it("asks for a password when this device has signed in here before", () => {
    const { root } = openPage({ remembers: true });
    expect(heading(root)).toBe("Sign in to continue");
    expect(buttonSaying(root, "Create an identity here")).toBeDefined();
  });

  it("remembers the device once someone gets in", async () => {
    const { root, device } = openPage({
      answer: (path) =>
        path === "/register"
          ? { ok: true, data: { access_token: "grant" } }
          : {
              ok: true,
              data: {
                challenge_id: "ask-1",
                platform_name: "Sloppy",
                scopes: ["identity:read"],
              },
            },
    });
    fieldNamed(root, "Username").value = "alice";
    fieldNamed(root, "Password").value = "a-long-enough-one";
    fieldNamed(root, "Confirm password").value = "a-long-enough-one";
    submitForm(root);
    await settled();

    expect(heading(root)).toBe("Connect Sloppy?");
    expect(device[DEVICE_KEY]).toBe("yes");
  });

  it("keeps the typed username when someone changes their mind about the door", () => {
    const { root } = openPage();
    fieldNamed(root, "Username").value = "alice";
    buttonSaying(root, "I already have an identity").fire("click");

    expect(heading(root)).toBe("Sign in to continue");
    expect(fieldNamed(root, "Username").value).toBe("alice");
  });
});

describe("what a mistake on the consent page costs", () => {
  it("keeps everything but the second password when the two disagree", () => {
    const { root } = openPage();
    fieldNamed(root, "Username").value = "alice";
    fieldNamed(root, "Display name").value = "Alice";
    fieldNamed(root, "Password").value = "a-long-enough-one";
    fieldNamed(root, "Confirm password").value = "a-long-enough-typo";
    submitForm(root);

    expect(fieldNamed(root, "Username").value).toBe("alice");
    expect(fieldNamed(root, "Display name").value).toBe("Alice");
    expect(fieldNamed(root, "Password").value).toBe("a-long-enough-one");
    expect(fieldNamed(root, "Confirm password").value).toBe("");
    expect(focused(root)).toBe(fieldNamed(root, "Confirm password"));
  });

  it("keeps the username and asks only for the password again when sign-in is refused", async () => {
    const { root, sent } = openPage({
      remembers: true,
      answer: () => ({ ok: false, data: { message: "That did not match." } }),
    });
    fieldNamed(root, "Username").value = "alice";
    fieldNamed(root, "Password").value = "wrong-one";
    submitForm(root);
    await settled();

    expect(sent).toEqual([
      { path: "/login", body: { username: "alice", password: "wrong-one" } },
    ]);
    expect(heading(root)).toBe("Sign in to continue");
    expect(fieldNamed(root, "Username").value).toBe("alice");
    expect(fieldNamed(root, "Password").value).toBe("");
    expect(focused(root)).toBe(fieldNamed(root, "Password"));
  });

  it("announces the problem instead of leaving the form silently rebuilt", async () => {
    const { root } = openPage({
      remembers: true,
      answer: () => ({ ok: false, data: { message: "That did not match." } }),
    });
    fieldNamed(root, "Username").value = "alice";
    fieldNamed(root, "Password").value = "wrong-one";
    submitForm(root);
    await settled();

    const line = problem(root);
    expect(line?.textContent).toBe("That did not match.");
    expect(line?.attributes.role).toBe("alert");
  });
});
