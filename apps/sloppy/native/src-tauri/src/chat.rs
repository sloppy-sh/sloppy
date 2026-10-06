//! The agent this app chats with about the project: where its program is on
//! this machine, how a session is started, said into and ended, and how what it
//! writes out reaches the page — `ChatAccess` in `@sloppy/app-core` declares
//! every act that reaches here, docs/ARCHITECTURE.md § "Asking a tool to write
//! the notes".
//!
//! **What the agent SAYS is carried, never read.** Every line it writes out
//! goes to the page as it arrives, and `chat.ts` in this shell's own source is
//! the one place that knows what a line means — so an agent that speaks some
//! other dialect costs this file nothing.
//!
//! The program, its options and the endpoint it is pointed at are this file's.
//! What a caller hands over is a folder somebody picked, the acts the webview
//! will serve, and words; the words reach the agent on its own input rather
//! than as an argument.

use std::ffi::OsStr;
use std::io::{BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::program::{a_line, drained, end_it, started, trimmed};
use crate::tools::{Advertised, Answered, Called, Endpoint};
use crate::vault::{FileError, Folders};

struct Agent {
    /// The value `ChatAgent` in `@sloppy/types` carries.
    id: &'static str,
    program: &'static str,
    /// Where a person names the program themselves, for a machine keeping it
    /// somewhere the folders looked in do not reach.
    env: &'static str,
    args: &'static [&'static str],
}

/// Headless, holding only the tools that read, and carrying a whole
/// conversation on one pair of pipes. Sloppy's own acts arrive over the
/// endpoint instead, and `--strict-mcp-config` is what keeps anything else a
/// machine happens to have configured out of the session.
const AGENTS: &[Agent] = &[Agent {
    id: "claude_code",
    program: "claude",
    env: "SLOPPY_CHAT_CLAUDE_CODE",
    args: &[
        "--print",
        "--verbose",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--allowedTools",
        "Read,Grep,Glob",
        "--disallowedTools",
        "Bash,Edit,NotebookEdit,Task,WebFetch,WebSearch,Write",
        "--strict-mcp-config",
    ],
}];

/// What one line the agent writes out may run to. A session has no total of its
/// own — a chat runs as long as somebody keeps talking — so the bound is per
/// line, and a program past it is answering nothing and is ended.
const LINE_MAX: usize = 1024 * 1024;

const NO_PROGRAM: &str = "Sloppy could not start that. Check it is installed, then try again.";
const NOTHING_OPEN: &str = "That chat is over. Start another one.";
const DIDNT_START: &str = "That did not start. Try again.";
const DIDNT_FINISH: &str = "That did not finish. Try again.";
const TOO_MUCH: &str = "That answer was too long to read. Ask for less, then try again.";
const NO_PLACE: &str =
    "Sloppy could not give this chat one of its folders. Open it again, or take it off the chat.";

/// Which folder a chat could not be given, named the way the person named it —
/// the last part of where it is, which is what they call that folder.
fn no_place(place: &str) -> ChatError {
    match Path::new(place).file_name().and_then(OsStr::to_str) {
        Some(name) => ChatError::new(format!(
            "Sloppy could not give this chat the folder “{name}”. Open it again, or take it off the chat."
        )),
        None => ChatError::new(NO_PLACE),
    }
}

/// What a person is told where a chat could not start or could not go on.
#[derive(Debug)]
pub struct ChatError(String);

impl ChatError {
    fn new(said: impl Into<String>) -> Self {
        ChatError(said.into())
    }

    pub fn said(&self) -> &str {
        &self.0
    }
}

impl Serialize for ChatError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.said())
    }
}

impl From<FileError> for ChatError {
    fn from(error: FileError) -> Self {
        ChatError(error.said().into())
    }
}

/// Everything a session hands the page, in the order it happened.
#[derive(Serialize)]
#[serde(tag = "from", rename_all = "snake_case")]
pub enum Heard {
    /// One line the agent wrote out, as it wrote it.
    Said { line: String },
    /// A call of one of Sloppy's own acts, waiting on the webview's answer.
    Called {
        call: String,
        act: String,
        arguments: Value,
    },
    /// The session is over. `stopped` is a person who ended it, and `trouble`
    /// is what the agent said about why it could not go on — absent where it
    /// said nothing, and on every session nobody stopped that simply finished.
    Over {
        stopped: bool,
        trouble: Option<String>,
    },
}

/// The one session a device has underway, held so that ending it reaches the
/// program, everything that program started, and the endpoint it was calling.
#[derive(Clone, Default)]
pub struct Chat(Arc<Mutex<Option<Session>>>);

struct Session {
    /// Which session this is. The thread carrying what a session says outlives
    /// the session where another is opened over it, so it names the one it is
    /// reading rather than acting on whatever stands.
    mark: u64,
    /// Taken by whoever ends the session, which reaps the program; absent is a
    /// session already ended.
    child: Option<Child>,
    /// Taken once, when the session ends: what the agent is said into.
    saying: Option<ChildStdin>,
    /// Dropped with the session, which closes the socket it stood on.
    endpoint: Endpoint,
    stopped: bool,
}

/// How a session left off.
struct Ended {
    stopped: bool,
    finished: bool,
}

impl Chat {
    /// Hand over a started session, ending whatever stood.
    fn holds(&self, session: Session) {
        let standing = self.0.lock().unwrap().replace(session);
        if let Some(child) = standing.and_then(|mut standing| standing.child.take()) {
            end_it(child);
        }
    }

    /// Say one line onto the agent's own input.
    fn says(&self, line: &str) -> Result<(), ChatError> {
        let mut held = self.0.lock().unwrap();
        let saying = held
            .as_mut()
            .and_then(|session| session.saying.as_mut())
            .ok_or_else(|| ChatError::new(NOTHING_OPEN))?;
        saying
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|()| saying.flush())
            .map_err(|_| ChatError::new(NOTHING_OPEN))
    }

    /// Hand the webview's answer to the call that is waiting on it.
    fn answers(&self, answered: Answered) -> Result<(), ChatError> {
        let held = self.0.lock().unwrap();
        let session = held.as_ref().ok_or_else(|| ChatError::new(NOTHING_OPEN))?;
        session.endpoint.answer(answered);
        Ok(())
    }

    /// End the session, and with it whatever the agent was doing. No session
    /// is not a failure.
    pub fn close(&self) {
        let mut held = self.0.lock().unwrap();
        let Some(session) = held.as_mut() else {
            return;
        };
        session.stopped = true;
        // Closing the agent's input first lets one that is between turns finish
        // rather than be cut off mid-sentence.
        session.saying.take();
        if let Some(child) = session.child.take() {
            end_it(child);
        }
    }

    /// End the session marked `mark` without it counting as somebody having
    /// stopped it, so that an agent nobody can hear out is reaped rather than
    /// waited on.
    fn cut(&self, mark: u64) {
        let mut held = self.0.lock().unwrap();
        let Some(session) = held.as_mut().filter(|session| session.mark == mark) else {
            return;
        };
        session.saying.take();
        if let Some(child) = session.child.take() {
            end_it(child);
        }
    }

    /// Give the place back once the program is reaped, and say how it left off.
    /// A session another was opened over is already ended, and is reported the
    /// way a person ending one is: nothing went wrong.
    fn ends(&self, mark: u64) -> Ended {
        let mut held = self.0.lock().unwrap();
        if held.as_ref().map(|session| session.mark) != Some(mark) {
            return Ended {
                stopped: true,
                finished: false,
            };
        }
        let mut session = held.take().expect("the session");
        drop(held);
        session.saying.take();
        Ended {
            stopped: session.stopped,
            finished: match session.child.as_mut() {
                Some(child) => child.wait().map(|how| how.success()).unwrap_or(false),
                None => false,
            },
        }
    }
}

/// What the session is called, in the one form the agent takes: sixteen random
/// bytes spelled as a version-4 UUID.
fn named() -> String {
    use ssh_key::rand_core::{OsRng, RngCore as _};

    let mut held = [0u8; 16];
    OsRng.fill_bytes(&mut held);
    held[6] = (held[6] & 0x0f) | 0x40;
    held[8] = (held[8] & 0x3f) | 0x80;
    let spelled: String = held.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &spelled[..8],
        &spelled[8..12],
        &spelled[12..16],
        &spelled[16..20],
        &spelled[20..],
    )
}

/// One more than the session before it, so that no two are the same.
fn marked() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// What a session is opened with, beside where it runs.
struct Opening<'a> {
    tools: &'a [Advertised],
    brief: &'a str,
    /// Absent is whatever the agent would answer with on its own.
    model: Option<&'a str>,
    /// Which conversation this is. Absent is one this app names itself, which
    /// is every chat nobody has opened before.
    session: Option<&'a str>,
    /// Whether that conversation is being picked up where it was left rather
    /// than opened as a new one.
    resume: bool,
    /// The folders the agent may read besides the one it runs in, each already
    /// held to what this app is allowed to reach.
    places: &'a [PathBuf],
}

/// Start the agent in `at`, pointed at an endpoint serving `with.tools`, and
/// carry what it says to `heard` until it is done.
fn open(
    agent: &'static Agent,
    program: &Path,
    at: &Path,
    with: Opening<'_>,
    heard: Arc<dyn Fn(Heard) + Send + Sync>,
    chat: Chat,
) -> Result<(), ChatError> {
    let telling = heard.clone();
    let endpoint = Endpoint::start(
        with.tools,
        Arc::new(move |called: Called| {
            telling(Heard::Called {
                call: called.call,
                act: called.act,
                arguments: called.arguments,
            });
        }),
    )
    .map_err(|_| ChatError::new(DIDNT_START))?;
    let mut child = start(program, agent.args, &endpoint.config(), &with, at)?;
    let saying = child
        .stdin
        .take()
        .ok_or_else(|| ChatError::new(DIDNT_START))?;
    let out = child.stdout.take();
    let trouble = drained(child.stderr.take(), LINE_MAX);
    let mark = marked();
    chat.holds(Session {
        mark,
        child: Some(child),
        saying: Some(saying),
        endpoint,
        stopped: false,
    });
    thread::spawn(move || {
        let heard_out = out.map(|out| hear(out, heard.as_ref())).unwrap_or(true);
        if !heard_out {
            chat.cut(mark);
        }
        let ended = chat.ends(mark);
        let said = trouble.and_then(|held| held.join().ok()).flatten();
        heard(Heard::Over {
            stopped: ended.stopped,
            trouble: match (heard_out, ended.stopped || ended.finished) {
                (false, _) => Some(TOO_MUCH.to_owned()),
                (true, true) => None,
                (true, false) => Some(said.unwrap_or_else(|| DIDNT_FINISH.to_owned())),
            },
        });
    });
    Ok(())
}

/// The options this one session is opened under — `config` and everything on
/// `with`; the agent's own standing options are `args`.
///
/// A conversation picked up restores what was SAID in it and not the folders it
/// was given, so every place is passed again on every open.
fn start(
    program: &Path,
    args: &[&str],
    config: &str,
    with: &Opening<'_>,
    at: &Path,
) -> Result<Child, ChatError> {
    let mut how = Command::new(program);
    how.args(args);
    match with.session.filter(|_| with.resume) {
        Some(session) => how.arg("--resume").arg(session),
        None => how
            .arg("--session-id")
            .arg(with.session.map_or_else(named, str::to_owned)),
    };
    how.arg("--mcp-config")
        .arg(config)
        .arg("--append-system-prompt")
        .arg(with.brief)
        .current_dir(at)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for place in with.places {
        how.arg("--add-dir").arg(place);
    }
    if let Some(model) = with.model {
        how.arg("--model").arg(model);
    }
    started(&mut how).map_err(|_| ChatError::new(NO_PROGRAM))
}

/// Where each of a chat's places is, every one of them held to what this app
/// may reach and still there. A place it may not reach, or one that has moved,
/// is REFUSED rather than left out: a chat that quietly cannot read a folder
/// somebody added to it answers wrongly and says nothing about why.
fn places_in(folders: &Folders, places: &[String]) -> Result<Vec<PathBuf>, ChatError> {
    places
        .iter()
        .map(|place| {
            folders
                .opened(place)
                .ok()
                .map(|held| held.to_path_buf())
                .filter(|held| held.is_dir())
                .ok_or_else(|| no_place(place))
        })
        .collect()
}

/// Every line the agent writes out, handed on as it arrives. `false` is a line
/// that ran past `LINE_MAX`.
fn hear(out: ChildStdout, heard: &(dyn Fn(Heard) + Send + Sync)) -> bool {
    let mut reader = BufReader::new(out);
    let mut line = Vec::new();
    loop {
        let Some(read) = a_line(&mut reader, &mut line, LINE_MAX) else {
            return false;
        };
        if read == 0 {
            return true;
        }
        heard(Heard::Said {
            line: String::from_utf8_lossy(trimmed(&line)).into_owned(),
        });
    }
}

fn found(agent: &Agent) -> Option<PathBuf> {
    crate::program::found(agent.program, std::env::var_os(agent.env).as_deref())
}

/// The agents this device can reach. An empty list is a device with none.
#[tauri::command]
pub async fn chat_agents() -> Vec<&'static str> {
    // Looking for a program is a walk over folders, off the page's thread.
    tauri::async_runtime::spawn_blocking(|| {
        AGENTS
            .iter()
            .filter(|agent| found(agent).is_some())
            .map(|agent| agent.id)
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// What the page asks a session be opened with.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asked {
    pub agent: String,
    pub root: String,
    pub tools: Vec<Advertised>,
    pub brief: String,
    pub model: Option<String>,
    /// The conversation to open as, or to pick up where `resume`. Absent is a
    /// chat nobody has opened before, which this app names itself.
    pub session: Option<String>,
    pub resume: bool,
    /// The folders this chat reads besides its own project, as the page holds
    /// them. Each is checked against what this app may reach before anything
    /// starts.
    pub places: Vec<String>,
}

/// Start a session, ending whatever stood. `tools` are the acts the webview
/// will serve, as `advertisedChatTools` in `@sloppy/types` answered; `brief` is
/// what the agent is told before it hears the person, which is `chatBrief` in
/// `@sloppy/local` and without which it does not know it is in Sloppy at all;
/// `model` absent is whatever the agent would answer with on its own; `places`
/// are the folders this chat reads besides its own project, and a session is
/// refused rather than started where this app may not reach one of them.
#[tauri::command]
pub async fn chat_open(
    folders: State<'_, Folders>,
    chat: State<'_, Chat>,
    asked: Asked,
    heard: Channel<Heard>,
) -> Result<(), ChatError> {
    let Asked {
        agent,
        root,
        tools,
        brief,
        model,
        session,
        resume,
        places,
    } = asked;
    let held = AGENTS
        .iter()
        .find(|one| one.id == agent)
        .ok_or_else(|| ChatError::new(NO_PROGRAM))?;
    let at = folders.opened(&root)?.to_path_buf();
    let places = places_in(&folders, &places)?;
    let chat = chat.inner().clone();
    let telling: Arc<dyn Fn(Heard) + Send + Sync> = Arc::new(move |message| {
        let _ = heard.send(message);
    });
    tauri::async_runtime::spawn_blocking(move || {
        let program = found(held).ok_or_else(|| ChatError::new(NO_PROGRAM))?;
        let with = Opening {
            tools: &tools,
            brief: &brief,
            model: model.as_deref(),
            session: session.as_deref(),
            resume,
            places: &places,
        };
        open(held, &program, &at, with, telling, chat)
    })
    .await
    .map_err(|_| ChatError::new(DIDNT_START))?
}

/// One line onto the agent's own input, with the newline this side's. What a
/// line SAYS is the agent's own dialect, which `chat.ts` in this shell spells.
#[tauri::command]
pub fn chat_say(chat: State<'_, Chat>, line: String) -> Result<(), ChatError> {
    chat.says(&line)
}

/// What the webview did with a call, on its way back to the agent.
#[tauri::command]
pub fn chat_answer(
    chat: State<'_, Chat>,
    call: String,
    said: String,
    trouble: bool,
) -> Result<(), ChatError> {
    chat.answers(Answered {
        call,
        said,
        trouble,
    })
}

/// End the session. It is over once `Heard::Over` reaches the page, which is
/// what a caller waiting on the end waits for.
///
/// **Not the end of a TURN.** A person who stops the turn underway keeps the
/// session, and that end is said to the agent on its own input like everything
/// else it is told — `ChatAccess` in `@sloppy/app-core` declares both acts.
#[tauri::command]
pub fn chat_close(chat: State<'_, Chat>) {
    chat.close();
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use super::*;

    /// A session opened with no acts, nothing said first, no model named, no
    /// conversation to pick up and nowhere to read but where it runs.
    fn nothing() -> Opening<'static> {
        Opening {
            tools: &[],
            brief: "",
            model: None,
            session: None,
            resume: false,
            places: &[],
        }
    }

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch(name: &str) -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-chat-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        at
    }

    /// A program standing in for the agent, so that no test asks a real one
    /// anything.
    #[cfg(unix)]
    fn stub(at: &Path, name: &str, script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt as _;

        let file = at.join(name);
        fs::write(&file, format!("#!/bin/sh\n{script}\n")).expect("the stub");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).expect("a stub to run");
        file
    }

    /// Nothing underway is not a failure, and nothing is said into a chat that
    /// is over.
    #[test]
    fn a_chat_that_is_over_is_said_so_rather_than_failing_quietly() {
        let chat = Chat::default();

        chat.close();

        assert_eq!(chat.says("{}").unwrap_err().said(), NOTHING_OPEN);
        assert!(chat.ends(marked()).stopped);
    }

    /// A program standing in for the agent. What it is called and where it is
    /// kept are the test's; nothing here asks a real one anything.
    static STUB: Agent = Agent {
        id: "stub",
        program: "stub",
        env: "SLOPPY_CHAT_STUB",
        args: &[],
    };

    /// Everything a session handed the page, in the order it arrived.
    #[cfg(unix)]
    #[derive(Clone, Default)]
    struct Thread(Arc<Mutex<Vec<Heard>>>);

    #[cfg(unix)]
    impl Thread {
        fn sink(&self) -> Arc<dyn Fn(Heard) + Send + Sync> {
            let held = self.0.clone();
            Arc::new(move |message| held.lock().unwrap().push(message))
        }

        fn lines(&self) -> Vec<String> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .filter_map(|message| match message {
                    Heard::Said { line } => Some(line.clone()),
                    _ => None,
                })
                .collect()
        }

        fn overs(&self) -> Vec<(bool, Option<String>)> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .filter_map(|message| match message {
                    Heard::Over { stopped, trouble } => Some((*stopped, trouble.clone())),
                    _ => None,
                })
                .collect()
        }
    }

    /// Long enough that a machine running the whole suite at once cannot make a
    /// session that ended look like one that never did, and shorter than the
    /// stubs that sit out a session, which a run reaching this never did.
    #[cfg(unix)]
    fn waits(what: &str, until: impl Fn() -> bool) {
        let started = Instant::now();
        while !until() {
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "{what} never happened"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[cfg(unix)]
    #[test]
    fn what_the_agent_says_arrives_line_by_line_and_the_end_is_said() {
        let at = scratch("lines");
        let program = stub(&at, "agent", "echo one; echo two");
        let thread = Thread::default();
        let chat = Chat::default();

        open(&STUB, &program, &at, nothing(), thread.sink(), chat).expect("a session");

        waits("the end", || thread.overs().len() == 1);
        assert_eq!(thread.lines(), ["one", "two"]);
        assert_eq!(thread.overs(), [(false, None)]);
    }

    /// A person who ends a chat is not somebody who hit trouble.
    #[cfg(unix)]
    #[test]
    fn a_session_somebody_ends_says_so_and_says_nothing_else() {
        let at = scratch("stopped");
        let program = stub(&at, "agent", "echo starting; sleep 30");
        let thread = Thread::default();
        let chat = Chat::default();
        open(&STUB, &program, &at, nothing(), thread.sink(), chat.clone()).expect("a session");
        waits("a line", || !thread.lines().is_empty());

        chat.close();

        waits("the end", || thread.overs().len() == 1);
        assert_eq!(thread.overs(), [(true, None)]);
    }

    /// The end is there to be tapped until it reaches the page, so a person
    /// ends a chat twice and the second is the same one end.
    #[cfg(unix)]
    #[test]
    fn a_chat_ended_twice_ends_once() {
        let at = scratch("twice");
        let program = stub(&at, "agent", "echo starting; sleep 30");
        let thread = Thread::default();
        let chat = Chat::default();
        open(&STUB, &program, &at, nothing(), thread.sink(), chat.clone()).expect("a session");
        waits("a line", || !thread.lines().is_empty());

        chat.close();
        chat.close();

        waits("the end", || thread.overs().len() == 1);
        assert_eq!(thread.overs(), [(true, None)]);
    }

    /// The thread carrying what a session says outlives the session where
    /// another is opened over it, so it must end the one it was reading and
    /// leave the one that is there standing.
    #[cfg(unix)]
    #[test]
    fn a_session_opened_over_another_leaves_the_new_one_standing() {
        let at = scratch("replaced");
        let first = stub(&at, "first", "echo one; sleep 30");
        let second = stub(&at, "second", "echo two; sleep 30");
        let thread = Thread::default();
        let chat = Chat::default();
        open(&STUB, &first, &at, nothing(), thread.sink(), chat.clone()).expect("one session");
        waits("the first line", || thread.lines() == ["one"]);

        open(&STUB, &second, &at, nothing(), thread.sink(), chat.clone()).expect("another");

        waits("the end", || thread.overs().len() == 1);
        assert_eq!(thread.overs(), [(true, None)]);
        assert!(chat.says("{}").is_ok(), "the session standing was reaped");
        chat.close();
        waits("the second end", || thread.overs().len() == 2);
    }

    /// An agent reads a project by starting programs of its own, and a person
    /// who ends the chat means all of them — one left running goes on reading
    /// somebody's code after they closed the thread it was answering in.
    #[cfg(unix)]
    #[test]
    fn ending_a_chat_ends_what_the_agent_started() {
        let at = scratch("children");
        let left = at.join("left-behind");
        let program = stub(
            &at,
            "agent",
            &format!(
                "echo started; for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do (sleep 1; echo late >> {}) & done; wait",
                left.display()
            ),
        );
        let thread = Thread::default();
        let chat = Chat::default();
        open(&STUB, &program, &at, nothing(), thread.sink(), chat.clone()).expect("a session");
        waits("a line", || !thread.lines().is_empty());

        chat.close();

        waits("the end", || thread.overs().len() == 1);
        std::thread::sleep(Duration::from_secs(2));
        assert!(!left.exists(), "what the agent started outlived the chat");
    }

    /// The agent takes one form of name and nothing else, so a session it is
    /// refused would be a chat that never starts.
    #[test]
    fn a_session_is_named_in_the_form_the_agent_takes() {
        let named = named();
        let parts: Vec<&str> = named.split('-').collect();

        assert_eq!(
            parts.iter().map(|part| part.len()).collect::<Vec<_>>(),
            [8, 4, 4, 4, 12]
        );
        assert!(named
            .chars()
            .all(|held| held == '-' || held.is_ascii_hexdigit() && !held.is_ascii_uppercase()));
        assert!(parts[2].starts_with('4'));
        assert!(["8", "9", "a", "b"]
            .iter()
            .any(|held| parts[3].starts_with(held)));
        assert_ne!(named, self::named());
    }

    /// A stub that writes out the options it was started with, one to a line,
    /// so a test reads the argv the agent would have been given.
    #[cfg(unix)]
    fn echoing(at: &Path) -> PathBuf {
        stub(at, "agent", "for one in \"$@\"; do echo \"$one\"; done")
    }

    /// What follows `flag` in the options the stub wrote out, and nothing where
    /// the flag is not among them.
    #[cfg(unix)]
    fn after(lines: &[String], flag: &str) -> Option<String> {
        let at = lines.iter().position(|one| one == flag)?;
        lines.get(at + 1).cloned()
    }

    /// Every value `flag` was given, in the order they were given.
    #[cfg(unix)]
    fn every(lines: &[String], flag: &str) -> Vec<String> {
        lines
            .windows(2)
            .filter(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
            .collect()
    }

    /// A chat nobody has opened before is named here, and the agent is told to
    /// open that conversation rather than to pick one up.
    #[cfg(unix)]
    #[test]
    fn a_chat_opened_for_the_first_time_is_given_a_name_of_its_own() {
        let at = scratch("named");
        let program = echoing(&at);
        let thread = Thread::default();

        open(
            &STUB,
            &program,
            &at,
            nothing(),
            thread.sink(),
            Chat::default(),
        )
        .expect("a session");

        waits("the end", || thread.overs().len() == 1);
        let lines = thread.lines();
        let named = after(&lines, "--session-id").expect("a name for the conversation");
        assert_eq!(named.len(), 36);
        assert_eq!(after(&lines, "--resume"), None);
        assert_eq!(every(&lines, "--add-dir"), Vec::<String>::new());
    }

    /// Reopening a thread hands the agent the conversation it already holds,
    /// which is what makes everything said in it still there.
    #[cfg(unix)]
    #[test]
    fn a_chat_opened_again_picks_up_the_conversation_it_left() {
        let at = scratch("resumed");
        let program = echoing(&at);
        let thread = Thread::default();
        let with = Opening {
            session: Some("the-conversation"),
            resume: true,
            ..nothing()
        };

        open(&STUB, &program, &at, with, thread.sink(), Chat::default()).expect("a session");

        waits("the end", || thread.overs().len() == 1);
        let lines = thread.lines();
        assert_eq!(
            after(&lines, "--resume").as_deref(),
            Some("the-conversation")
        );
        assert_eq!(after(&lines, "--session-id"), None);
    }

    /// A conversation named but not picked up is the one the session opens as,
    /// so the thread that asked for it finds it again.
    #[cfg(unix)]
    #[test]
    fn a_chat_opening_under_a_name_it_was_given_opens_as_that_one() {
        let at = scratch("as-named");
        let program = echoing(&at);
        let thread = Thread::default();
        let with = Opening {
            session: Some("the-conversation"),
            resume: false,
            ..nothing()
        };

        open(&STUB, &program, &at, with, thread.sink(), Chat::default()).expect("a session");

        waits("the end", || thread.overs().len() == 1);
        let lines = thread.lines();
        assert_eq!(
            after(&lines, "--session-id").as_deref(),
            Some("the-conversation")
        );
        assert_eq!(after(&lines, "--resume"), None);
    }

    /// Every place the person added, given again on every open, because
    /// nothing can be added to a session that is already running.
    #[cfg(unix)]
    #[test]
    fn every_place_a_chat_reads_is_given_to_the_agent() {
        let at = scratch("places");
        let program = echoing(&at);
        let thread = Thread::default();
        let places = [at.join("lexer"), at.join("parser")];
        let with = Opening {
            places: &places,
            ..nothing()
        };

        open(&STUB, &program, &at, with, thread.sink(), Chat::default()).expect("a session");

        waits("the end", || thread.overs().len() == 1);
        assert_eq!(
            every(&thread.lines(), "--add-dir"),
            places
                .iter()
                .map(|one| one.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        );
    }

    /// A chat is handed a folder this app may reach, and nothing else — the
    /// page says which places, and this says whether it may.
    #[test]
    fn a_place_this_app_may_not_reach_is_refused_rather_than_left_out() {
        let data = scratch("place-data");
        let picked = scratch("place-picked");
        let elsewhere = scratch("place-elsewhere");
        let folders = Folders::new(data).expect("this app's own data");
        folders.pick(picked.clone()).expect("the folder");
        let spelled = |at: &Path| at.to_string_lossy().into_owned();
        let named = |at: &Path| {
            at.file_name()
                .and_then(OsStr::to_str)
                .expect("a folder with a name")
                .to_owned()
        };

        assert_eq!(
            places_in(&folders, &[spelled(&picked)]).expect("the place"),
            [crate::vault::settled(&picked)]
        );
        // A chat may carry several folders, so knowing WHICH one is what makes
        // the next step the person's to take — and the name is what they call
        // it, never the whole of where it is.
        let refused =
            places_in(&folders, &[spelled(&elsewhere)]).expect_err("a folder nobody opened");
        assert!(
            refused.said().contains(&named(&elsewhere)),
            "{}",
            refused.said()
        );
        assert!(!refused.said().contains(&spelled(&elsewhere)));

        // And one this app may reach that is not where it was: the chat says so
        // rather than starting an agent that cannot read it.
        let moved = picked.join("lexer");
        fs::create_dir_all(&moved).expect("a folder inside it");
        assert!(places_in(&folders, &[spelled(&moved)]).is_ok());
        fs::remove_dir_all(&moved).expect("the folder gone");
        let gone = places_in(&folders, &[spelled(&moved)]).expect_err("a folder that moved");
        assert!(gone.said().contains("lexer"), "{}", gone.said());

        // A folder with no name of its own leaves nothing to say but what went
        // wrong.
        assert_eq!(no_place("/").said(), NO_PLACE);
    }

    /// An agent that loops, or another program that happens to answer to the
    /// same name, must not be able to fill this app's memory or the page's.
    #[cfg(unix)]
    #[test]
    fn a_line_longer_than_an_answer_ends_the_session_rather_than_being_held() {
        let at = scratch("long-line");
        let much = LINE_MAX + 1024;
        let program = stub(
            &at,
            "agent",
            &format!("head -c {much} /dev/zero | tr '\\0' 'a'"),
        );
        let thread = Thread::default();
        let chat = Chat::default();

        open(&STUB, &program, &at, nothing(), thread.sink(), chat).expect("a session");

        waits("the end", || thread.overs().len() == 1);
        assert!(thread.lines().is_empty());
        assert_eq!(thread.overs(), [(false, Some(TOO_MUCH.to_owned()))]);
    }
}
