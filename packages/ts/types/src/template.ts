// The shapes a note can be started from: a name, and the sections it opens
// with. The app writes them and `.sloppy/AGENT.md` teaches them, so they sit
// here rather than in either — docs/ARCHITECTURE.md § "Blocks and ink".

import { DECISION_WHY_HEADING } from "./document.js";

export type TemplateId =
  | "claim"
  | "question"
  | "source"
  | "objection"
  | "synthesis"
  | "walkthrough"
  | "decision";

/** What a seeded section opens on. Absent is somewhere to write. */
export type SectionOpening = "writing" | "drawing" | "compass";

export interface TemplateSection {
  heading: string;
  opens?: SectionOpening;
}

export interface NoteTemplate {
  /** Names this shape in a list of them, and reaches no further. */
  id: TemplateId;
  name: string;
  sections: readonly TemplateSection[];
}

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
  {
    id: "claim",
    name: "Claim",
    sections: [
      { heading: "The claim in one sentence" },
      { heading: "What makes me believe it" },
      { heading: "What would change my mind" },
      { heading: "Draw the mechanism", opens: "drawing" },
    ],
  },
  {
    id: "question",
    name: "Question",
    sections: [
      { heading: "The question, sharpened" },
      { heading: "What hangs on it" },
      { heading: "Where I've looked" },
    ],
  },
  {
    id: "source",
    name: "Source",
    sections: [
      { heading: "What it says in my words" },
      { heading: "Quotes worth keeping, with locators" },
      { heading: "What I take from it" },
    ],
  },
  {
    id: "objection",
    name: "Objection",
    sections: [
      { heading: "The objection" },
      { heading: "What survives if I am right" },
    ],
  },
  {
    id: "synthesis",
    name: "Synthesis",
    sections: [
      { heading: "What the run establishes" },
      { heading: "What it does not" },
      { heading: "Where next" },
    ],
  },
  {
    id: "walkthrough",
    name: "Walkthrough",
    sections: [
      { heading: "Start here" },
      { heading: "The path it takes" },
      { heading: "Where it can go wrong" },
    ],
  },
  {
    id: "decision",
    name: "Decision",
    sections: [
      { heading: "Where this sits", opens: "compass" },
      { heading: DECISION_WHY_HEADING },
    ],
  },
];
