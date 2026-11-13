//! A desk for the headset's tests: `serve.rs`'s own listener, on this network
//! only and announced nowhere, showing a fixed code for as long as it runs —
//! or none, where the code is `-` — and answering every paired line from a
//! canned project of two notes, worn in Graphite, the first wearing a picture
//! and the second showing one in its writing and written by somebody with a
//! name and a face,
//! with five looks to choose from —
//! the one server the headset is tested against. It hears every recording as
//! "take me to the second note" unless it is `mute`, keeps one chat thread,
//! and answers a `chat/say` with a turn a
//! second at a time, taking the reader to the second note where the words say
//! "take me". While a turn is under way on a connection and not stopped, it
//! will not open that connection another thread. Prints `{"ticket": …}` once it is listening and serves until it is
//! ended.
//!
//! `cargo run --example desk -- <project> <code or -> <kept folder> [tag,tag] [mute]`

use std::collections::HashMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde_json::{json, Value};
use sloppy_native_lib::serve::{Heard, Kept, Listening, Reach, ServeCall, Start};
use tokio::sync::mpsc::{self, UnboundedSender};

const OWNER: &str = "did:syr:z6MkDeskForTheHeadsetsTestsOnly";
const ROOT: &str = "01M75GHRBNNE3RZVF65TTT9EPJ";
const LEAF: &str = "01M75GHRF2M14C1GBX3ENP3SRD";
/// Longer than any test runs, so the code is shown for as long as the desk is.
const SHOWN_FOR: Duration = Duration::from_secs(24 * 60 * 60);
/// A PNG four pixels by two, as `picture/read` answers one.
const PICTURE: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAF0lEQVR4nGM4oaHxX0PjxH8YzYDMAdEAFNUQueTTVycAAAAASUVORK5CYII=";
/// The one picture the second note's writing shows, as its markdown names it.
const LEAF_PICTURE: &str = "media/01M75GHRQ9V2K7D4X8C3B6N5MA";
/// The author `author/read` answers with a name and a face.
const ADA: &str = "w3id:@00000000-0000-5000-8000-000000000001";
/// The author whose profile `author/read` says is not public.
const UNSEEN: &str = "w3id:@00000000-0000-5000-8000-000000000002";
/// A face four pixels square, as `author/read` answers one.
const FACE: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR42mM4URHwHxkzkC4AAGyHKPEW/lxUAAAAAElFTkSuQmCC";
const NOTHING_BY_THAT_NAME: &str =
    "There is nothing here by that name. Everything that can be asked for is in the list of tools.";
const THREAD: &str = "01M75GHRJ8T3S9Q4W6E2Y7Z1AB";
const HEARD: &str = "take me to the second note";
/// The most bytes of sound `SPEECH_LONGEST_MS` holds at `SPEECH_RATE`, mono, 16-bit.
const LONGEST_SOUND: usize = 60 * 16_000 * 2;
const WAV_HEADER: usize = 44;
/// How far apart the events of a turn arrive.
const TURN_PACE: Duration = Duration::from_secs(1);
// `SERVE_REFUSALS` and the words beside them in `@sloppy/types`' `serve.ts`.
const NO_SPEECH: (i32, &str) = (
    -32010,
    "The desk has no speech set up. On the desk, Settings → AI.",
);
const SPEECH_TOO_LONG: (i32, &str) = (
    -32011,
    "That was too long to hear in one go. Hold the button for a minute at most.",
);
const SPEECH_UNREADABLE: (i32, &str) = (
    -32012,
    "That could not be heard. Hold the button and try again.",
);
const ANSWERING: (i32, &str) = (-32020, "The assistant is still answering. Stop it first.");
const NO_SUCH_ASSET: (i32, &str) = (-32040, "That picture is not in this note.");
const NOT_PUBLIC: (i32, &str) = (-32050, "This person's profile is not public.");
const UNREACHED: (i32, &str) = (
    -32051,
    "This person's profile could not be reached. Try again later.",
);
/// How many events a `chat/say` sends after its answer.
const TURN_EVENTS: u32 = 4;

/// One look `look/list` answers: its ground, its ink and its eight hue slots,
/// every one of them different from every other look's.
fn look(id: &str, name: &str, variant: &str, author: Option<&str>, paint: [&str; 10]) -> Value {
    let mut palette = json!({ "--background": paint[0], "--foreground": paint[1] });
    for (slot, colour) in paint[2..].iter().enumerate() {
        palette[format!("--facet-{}", slot + 1)] = json!(colour);
    }
    let mut look = json!({ "id": id, "name": name, "variant": variant, "palette": palette });
    if let Some(author) = author {
        look["author"] = json!(author);
    }
    look
}

/// Two of Sloppy's own, then two light schemes and one dark, as a desk orders them.
fn looks() -> Value {
    json!([
        look(
            "paper",
            "Paper",
            "light",
            None,
            [
                "#f6f3ee", "#2e2a25", "#c4655f", "#b07c3b", "#8a8f3c", "#4f9a6b", "#3c98a0",
                "#5a86c6", "#8a6fc4", "#b8619a",
            ]
        ),
        look(
            "graphite",
            "Graphite",
            "dark",
            None,
            [
                "#1d1f24", "#e3e5e9", "#a9524d", "#94672b", "#71762b", "#3c8056", "#2a7e86",
                "#4870a8", "#735ba7", "#9a4f81",
            ]
        ),
        look(
            "base16-cupertino",
            "Cupertino",
            "light",
            Some("Defman21"),
            [
                "#ffffff", "#404040", "#c41a15", "#eb8500", "#826b28", "#007400", "#318495",
                "#0000ff", "#a90d91", "#826b29",
            ]
        ),
        look(
            "base16-one-light",
            "One Light",
            "light",
            Some("Daniel Pfeifer"),
            [
                "#fafafa", "#383a42", "#ca1243", "#d75f00", "#c18401", "#50a14f", "#0184bc",
                "#4078f2", "#a626a4", "#986801",
            ]
        ),
        look(
            "base16-nord",
            "Nord",
            "dark",
            Some("arcticicestudio"),
            [
                "#2e3440", "#e5e9f0", "#bf616a", "#d08770", "#ebcb8b", "#a3be8c", "#88c0d0",
                "#81a1c1", "#b48ead", "#5e81ac",
            ]
        ),
    ])
}

struct Calls(UnboundedSender<ServeCall>);

impl Heard for Calls {
    fn call(&self, call: ServeCall) {
        let _ = self.0.send(call);
    }
}

struct Project {
    name: String,
    tags: Vec<String>,
    mute: bool,
    /// The thread answering on each connection, and until when.
    answering: Mutex<HashMap<String, (String, Instant)>>,
}

fn refused((code, message): (i32, &str)) -> Value {
    json!({ "error": { "code": code, "message": message } })
}

impl Project {
    fn notes(&self) -> Vec<Value> {
        vec![
            json!({ "note": format!("{OWNER}/{ROOT}"), "address": "1", "title": self.name, "tags": [] }),
            json!({
                "note": format!("{OWNER}/{LEAF}"),
                "address": "1a",
                "title": "a.ts",
                "parent": format!("{OWNER}/{ROOT}"),
                "tags": self.tags,
            }),
        ]
    }

    /// The notes as `field/list` answers them: one page, nothing linked by hand.
    fn field(&self) -> Vec<Value> {
        self.notes()
            .into_iter()
            .map(|mut note| {
                note["links"] = json!([]);
                if note["note"] == format!("{OWNER}/{ROOT}") {
                    note["picture"] = json!(true);
                } else {
                    note["authors"] = json!([ADA]);
                }
                note
            })
            .collect()
    }

    /// Who an author is, as `author/read` answers it: the desk's own owner by
    /// name alone, Ada with a face, the other author not public, and anybody
    /// else not reached.
    fn author(params: &Value) -> Value {
        match params.get("principal").and_then(Value::as_str) {
            Some(OWNER) => json!({ "result": { "name": "Sam" } }),
            Some(ADA) => json!({ "result": { "name": "Ada", "handle": "ada", "picture": FACE } }),
            Some(UNSEEN) => refused(NOT_PUBLIC),
            _ => refused(UNREACHED),
        }
    }

    /// The picture a note's mark wears, as `picture/read` answers it.
    fn picture(note: Option<&str>) -> Value {
        if note == Some(format!("{OWNER}/{ROOT}").as_str()) {
            json!({ "picture": PICTURE, "width": 4, "height": 2 })
        } else {
            json!({ "picture": null })
        }
    }

    /// A picture the note's writing shows, as `asset/read` answers it.
    fn asset(params: &Value) -> Value {
        let note = params.get("note").and_then(Value::as_str);
        let path = params.get("path").and_then(Value::as_str);
        if note == Some(format!("{OWNER}/{LEAF}").as_str()) && path == Some(LEAF_PICTURE) {
            json!({ "result": { "bytes": PICTURE, "mime": "image/png" } })
        } else {
            refused(NO_SUCH_ASSET)
        }
    }

    fn act(&self, name: &str, arguments: &Value) -> Option<Value> {
        match name {
            "read_graph" => Some(json!({ "name": self.name, "owner": OWNER, "ownership": "open" })),
            "list_notes" => {
                let wanted: Vec<&str> = arguments
                    .get("tags")
                    .and_then(Value::as_array)
                    .map(|tags| tags.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let notes: Vec<Value> = self
                    .notes()
                    .into_iter()
                    .filter(|note| {
                        wanted.iter().all(|tag| {
                            note["tags"]
                                .as_array()
                                .is_some_and(|held| held.iter().any(|one| one == tag))
                        })
                    })
                    .collect();
                Some(json!({ "notes": notes }))
            }
            "list_tags" => Some(json!({
                "tags": self.tags.iter().map(|tag| json!({ "tag": tag, "notes": 1 })).collect::<Vec<_>>(),
            })),
            "read_note" => {
                let asked = arguments.get("note").and_then(Value::as_str)?;
                let mut note = self
                    .notes()
                    .into_iter()
                    .find(|note| note["note"] == asked)?;
                if asked == format!("{OWNER}/{LEAF}") {
                    note["authors"] = json!([ADA]);
                }
                note["sections"] = json!([
                    { "markdown": format!("## The file\n\nIt sprang from [[{OWNER}/{ROOT}]].\n\n![The seed]({LEAF_PICTURE})") },
                ]);
                Some(note)
            }
            _ => None,
        }
    }

    fn heard(&self, params: &Value) -> Value {
        if self.mute {
            return refused(NO_SPEECH);
        }
        let Some(sound) = params
            .get("audio")
            .and_then(Value::as_str)
            .and_then(|audio| base64::engine::general_purpose::STANDARD.decode(audio).ok())
            .filter(|wav| {
                wav.len() >= WAV_HEADER && &wav[0..4] == b"RIFF" && &wav[8..12] == b"WAVE"
            })
        else {
            return refused(SPEECH_UNREADABLE);
        };
        if sound.len() - WAV_HEADER > LONGEST_SOUND {
            return refused(SPEECH_TOO_LONG);
        }
        json!({ "result": { "said": HEARD } })
    }

    fn second(&self) -> Value {
        json!({ "note": format!("{OWNER}/{LEAF}"), "title": "a.ts", "address": "1a" })
    }

    fn thread(&self) -> Value {
        json!({ "id": THREAD, "name": "Why the parser reads whole files" })
    }

    /// What a `chat/say` sends after its answer, in order, `TURN_PACE` apart.
    fn later(&self, line: &str) -> Vec<String> {
        let Ok(asked) = serde_json::from_str::<Value>(line) else {
            return vec![];
        };
        if asked.get("method").and_then(Value::as_str) != Some("chat/say") {
            return vec![];
        }
        let params = asked.get("params").cloned().unwrap_or(Value::Null);
        let thread = params.get("thread").cloned().unwrap_or(json!(THREAD));
        let said = |block: &str| json!({ "kind": "said", "said": block });
        let mut events = vec![
            json!({ "event": "started", "session": "canned-session", "tools": ["show_note"] }),
            json!({ "event": "block", "at": 0, "block": said("The second note") }),
            json!({ "event": "block", "at": 0, "block": said("The second note is a.ts.") }),
            json!({ "event": "over" }),
        ]
        .into_iter()
        .map(|event| {
            json!({ "jsonrpc": "2.0", "method": "chat/event", "params": { "thread": thread, "event": event } })
        })
        .collect::<Vec<_>>();
        let words = params.get("said").and_then(Value::as_str).unwrap_or("");
        if words.to_lowercase().contains("take me") {
            events
                .push(json!({ "jsonrpc": "2.0", "method": "view/show", "params": self.second() }));
        }
        events.iter().map(Value::to_string).collect()
    }

    /// Whether a turn on `connection` in a thread other than `thread` is under way.
    fn answering_beside(&self, connection: &str, thread: Option<&str>) -> bool {
        let answering = self.answering.lock().unwrap();
        answering.get(connection).is_some_and(|(answering, until)| {
            Instant::now() < *until && thread != Some(answering.as_str())
        })
    }

    /// A turn begins in `thread` on `connection` (`chat/say`), or ends there.
    fn turn(&self, connection: &str, method: Option<&str>, params: &Value) {
        let thread = params
            .get("thread")
            .and_then(Value::as_str)
            .unwrap_or(THREAD);
        let mut answering = self.answering.lock().unwrap();
        match method {
            Some("chat/say") => {
                let until = Instant::now() + TURN_PACE * TURN_EVENTS;
                answering.insert(connection.to_owned(), (thread.to_owned(), until));
            }
            Some("chat/stop" | "chat/close") => {
                if answering
                    .get(connection)
                    .is_some_and(|(held, _)| held == thread)
                {
                    answering.remove(connection);
                }
            }
            _ => {}
        }
    }

    fn answer(&self, line: &str, connection: &str) -> Option<String> {
        let asked: Value = serde_json::from_str(line).ok()?;
        let id = asked.get("id")?.clone();
        let params = asked.get("params").cloned().unwrap_or(Value::Null);
        let method = asked.get("method").and_then(Value::as_str);
        let named = match method {
            Some("field/list") => params.get("project").or_else(|| asked.get("project")),
            _ => asked.get("project"),
        };
        let elsewhere = named
            .and_then(Value::as_str)
            .is_some_and(|project| project != self.name);
        let said = match method {
            Some("projects/list") => {
                json!({ "result": { "projects": [{ "id": self.name, "name": self.name }] } })
            }
            Some("look/read") => json!({ "result": {
                "name": "Graphite",
                "based_on": "graphite",
                "style": "hardline",
                "density": "compact",
                "effect": [],
                "fonts": { "ui": "atkinson", "heading": "system", "mono": "system" },
            } }),
            Some("look/list") => json!({ "result": { "looks": looks() } }),
            _ if elsewhere => {
                json!({ "error": { "code": -32602, "message": "This desk serves no such project." } })
            }
            Some("field/list") => json!({ "result": { "notes": self.field() } }),
            Some("picture/read") => {
                json!({ "result": Self::picture(params.get("note").and_then(Value::as_str)) })
            }
            Some("asset/read") => Self::asset(&params),
            Some("author/read") => Self::author(&params),
            Some("initialize") => json!({ "result": {
                "protocolVersion": "2025-06-18",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "sloppy", "version": "0.0.1" },
            } }),
            Some("speech/hear") => self.heard(&params),
            Some("chat/threads") => {
                let mut thread = self.thread();
                thread["updated_at"] = json!("2026-11-12T08:00:00.000Z");
                thread["archived"] = json!(false);
                thread["answering"] = json!(false);
                json!({ "result": { "threads": [thread] } })
            }
            Some("chat/open")
                if self
                    .answering_beside(connection, params.get("thread").and_then(Value::as_str)) =>
            {
                refused(ANSWERING)
            }
            Some("chat/open") => {
                let mut thread = self.thread();
                thread["turns"] = json!([
                    {
                        "from": "person",
                        "blocks": [{ "kind": "said", "said": "Why does the parser read whole files?" }],
                        "at": "2026-11-12T07:59:00.000Z",
                    },
                    {
                        "from": "agent",
                        "blocks": [{ "kind": "said", "said": "So it never has to stop halfway through a word." }],
                        "at": "2026-11-12T08:00:00.000Z",
                    },
                ]);
                json!({ "result": { "thread": thread } })
            }
            Some("chat/say" | "chat/stop" | "chat/close") => {
                self.turn(connection, method, &params);
                json!({ "result": {} })
            }
            Some("tools/call") => {
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
                match self.act(name, &arguments) {
                    Some(answer) => json!({ "result": {
                        "content": [{ "type": "text", "text": answer.to_string() }],
                        "isError": false,
                    } }),
                    None => json!({ "result": {
                        "content": [{ "type": "text", "text": NOTHING_BY_THAT_NAME }],
                        "isError": true,
                    } }),
                }
            }
            _ => json!({ "error": { "code": -32601, "message": "Method not found" } }),
        };
        let mut said = said;
        said["jsonrpc"] = json!("2.0");
        said["id"] = id;
        Some(said.to_string())
    }
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(name), Some(code), Some(kept)) = (args.next(), args.next(), args.next()) else {
        eprintln!("cargo run --example desk -- <project> <code or -> <kept folder> [tag,tag]");
        std::process::exit(2);
    };
    let tags: Vec<String> = args
        .next()
        .map(|tags| {
            tags.split(',')
                .map(str::to_owned)
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let mute = args.next().as_deref() == Some("mute");
    let project = Project {
        name,
        tags,
        mute,
        answering: Mutex::default(),
    };
    let (heard, mut calls) = mpsc::unbounded_channel();
    let listening = Arc::new(
        Listening::start(
            Start {
                reach: Reach::Local,
                relay: None,
                name: project.name.clone(),
                kept: Kept::at(kept),
                announce: false,
            },
            Arc::new(Calls(heard)),
        )
        .await
        .unwrap_or_else(|said| {
            eprintln!("{said}");
            std::process::exit(1);
        }),
    );
    if code != "-" {
        listening.pair_on(code, SHOWN_FOR);
    }
    println!("{}", json!({ "ticket": listening.serving().ticket }));
    let _ = std::io::stdout().flush();

    while let Some(call) = calls.recv().await {
        if let Some(answer) = project.answer(&call.line, &call.connection) {
            listening.answer(&call.connection, answer);
        }
        let later = project.later(&call.line);
        if later.is_empty() {
            continue;
        }
        let listening = listening.clone();
        tokio::spawn(async move {
            for line in later {
                tokio::time::sleep(TURN_PACE).await;
                listening.answer(&call.connection, line);
            }
        });
    }
}
