// What the desk turns a reader's voice into words with — docs/ARCHITECTURE.md
// § "A headset beside the desk".

import type { ChatReach } from "./chat.js";

/** The speech agents a desk can hear with, the computer's own first. Another
 *  one is a value here and a row in {@link SPEECH_ENDPOINTS}, and touches no
 *  shape and no surface. */
export const SPEECH_AGENTS = [
  "system",
  "whisper_cpp",
  "openai",
  "groq",
] as const;
export type SpeechAgent = (typeof SPEECH_AGENTS)[number];

const SPEECH_NAMES: Record<SpeechAgent, string> = {
  system: "This computer",
  whisper_cpp: "whisper.cpp",
  openai: "OpenAI",
  groq: "Groq",
};

/** What a speech agent is called where somebody reads it. */
export function speechAgentName(agent: SpeechAgent): string {
  return SPEECH_NAMES[agent];
}

/** What a speech agent is reached through: a chat agent's two, and the
 *  computer's own recogniser, which needs neither. */
export type SpeechReach = ChatReach | "system";

const SPEECH_REACH: Record<SpeechAgent, SpeechReach> = {
  system: "system",
  whisper_cpp: "program",
  openai: "key",
  groq: "key",
};

/** The computer's own recogniser, a program on the desk with a model file the
 *  person picks, or an endpoint a key this device holds opens. */
export function speechAgentReach(agent: SpeechAgent): SpeechReach {
  return SPEECH_REACH[agent];
}

/** Where a `key` agent hears: `<baseUrl>/audio/transcriptions`, and the models
 *  it offers, the first the one asked where nobody chose. **`null` is a
 *  `program` or `system` agent**, which has no endpoint. */
export const SPEECH_ENDPOINTS: Record<
  SpeechAgent,
  { baseUrl: string; models: readonly string[] } | null
> = {
  system: null,
  whisper_cpp: null,
  openai: {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"],
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["whisper-large-v3-turbo", "whisper-large-v3"],
  },
};

/** The longest recording heard, in milliseconds. */
export const SPEECH_LONGEST_MS = 60_000;

/** The rate a recording is heard at, in samples a second: mono, 16-bit PCM. */
export const SPEECH_RATE = 16_000;

/** One recording to hear, and with what. */
export interface SpeechAsked {
  agent: SpeechAgent;
  /** As the agent names its models; for a `program` or `system` agent,
   *  whatever it is told. */
  model: string;
  /** The key a `key` agent is opened with. **Absent on any other.** */
  key?: string;
  /** The model file a `program` agent hears with, as the platform spells a
   *  path. **Absent on any other.** */
  programModel?: string;
}

/** What a recording said. */
export interface SpeechHeard {
  said: string;
}
