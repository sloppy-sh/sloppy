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

use std::collections::HashSet;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::State;

use crate::tools::{Advertised, Answered, Called, Endpoint};
use crate::vault::{settled, FileError, Folders};

struct Agent {
    /// The value `ChatAgent` in `@sloppy/types` carries.
    id: &'static str,
    program: &'static str,
    /// Where a person names the program themselves, for a machine keeping it
    /// somewhere `ALSO_LOOKED_IN` does not reach.
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

/// An app started from the Finder or the Dock is given launchd's PATH, which
/// names none of the folders a person installs a tool into, so these are looked
/// in whether or not the PATH says to.
#[cfg(not(windows))]
const ALSO_LOOKED_IN: &[&str] = &[
    "~/.local/bin",
    "~/bin",
    "~/.bun/bin",
    "~/.deno/bin",
    "~/.volta/bin",
    "~/.yarn/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
];

#[cfg(windows)]
const ALSO_LOOKED_IN: &[&str] = &["~/AppData/Roaming/npm", "~/.bun/bin", "~/.local/bin"];

/// Long enough for a sentence a program says about its own trouble, short
/// enough that a person reads it in one go.
const SAID_MAX: usize = 400;

/// What one line the agent writes out may run to. A session has no total of its
/// own — a chat runs as long as somebody keeps talking — so the bound is per
/// line, and a program past it is answering nothing and is ended.
const LINE_MAX: usize = 1024 * 1024;

const NO_PROGRAM: &str = "Sloppy could not start that. Check it is installed, then try again.";
const NOTHING_OPEN: &str = "That chat is over. Start another one.";
const DIDNT_START: &str = "That did not start. Try again.";
const DIDNT_FINISH: &str = "That did not finish. Try again.";
const TOO_MUCH: &str = "That answer was too long to read. Ask for less, then try again.";

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
    child: Child,
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
        if let Some(mut standing) = standing {
            end_it(&mut standing.child);
            let _ = standing.child.wait();
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
        end_it(&mut session.child);
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
        end_it(&mut session.child);
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
            finished: session
                .child
                .wait()
                .map(|how| how.success())
                .unwrap_or(false),
        }
    }
}

/// One more than the session before it, so that no two are the same.
fn marked() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// Start the agent in `at`, pointed at an endpoint serving `tools`, and carry
/// what it says to `heard` until it is done.
fn open(
    agent: &'static Agent,
    program: &Path,
    at: &Path,
    tools: &[Advertised],
    heard: Arc<dyn Fn(Heard) + Send + Sync>,
    chat: Chat,
) -> Result<(), ChatError> {
    let telling = heard.clone();
    let endpoint = Endpoint::start(
        tools,
        Arc::new(move |called: Called| {
            telling(Heard::Called {
                call: called.call,
                act: called.act,
                arguments: called.arguments,
            });
        }),
    )
    .map_err(|_| ChatError::new(DIDNT_START))?;
    let mut child = start(program, agent.args, &endpoint.config(), at)?;
    let saying = child
        .stdin
        .take()
        .ok_or_else(|| ChatError::new(DIDNT_START))?;
    let out = child.stdout.take();
    let trouble = drained(child.stderr.take());
    let mark = marked();
    chat.holds(Session {
        mark,
        child,
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

fn start(program: &Path, args: &[&str], config: &str, at: &Path) -> Result<Child, ChatError> {
    let mut how = Command::new(program);
    how.args(args)
        .arg("--mcp-config")
        .arg(config)
        .current_dir(at)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apart(&mut how);
    how.spawn().map_err(|_| ChatError::new(NO_PROGRAM))
}

/// Every line the agent writes out, handed on as it arrives. `false` is a line
/// that ran past `LINE_MAX`.
fn hear(out: ChildStdout, heard: &(dyn Fn(Heard) + Send + Sync)) -> bool {
    let mut reader = BufReader::new(out);
    let mut line = Vec::new();
    loop {
        let Some(read) = a_line(&mut reader, &mut line) else {
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

/// One line, never holding more than `LINE_MAX` of it. `None` is a line that
/// ran past that; `Some(0)` is the end of what the program had to say, which is
/// what a read it could not finish is taken for too.
fn a_line<R: BufRead>(reader: &mut R, line: &mut Vec<u8>) -> Option<usize> {
    line.clear();
    match (&mut *reader)
        .take(LINE_MAX as u64 + 1)
        .read_until(b'\n', line)
    {
        Ok(read) if read > LINE_MAX => None,
        Ok(read) => Some(read),
        Err(_) => Some(0),
    }
}

fn trimmed(line: &[u8]) -> &[u8] {
    let held = line.strip_suffix(b"\n").unwrap_or(line);
    held.strip_suffix(b"\r").unwrap_or(held)
}

/// The first thing the program said about its own trouble, drained as it runs
/// so that a full pipe cannot hold the program up. A line past `LINE_MAX` is
/// drained in pieces, and nothing after it is a sentence a person is shown.
fn drained(from: Option<ChildStderr>) -> Option<JoinHandle<Option<String>>> {
    let from = from?;
    Some(thread::spawn(move || {
        let mut reader = BufReader::new(from);
        let mut line = Vec::new();
        let mut found: Option<String> = None;
        let mut listening = true;
        loop {
            let Some(read) = a_line(&mut reader, &mut line) else {
                listening = false;
                continue;
            };
            if read == 0 {
                return found;
            }
            if !listening {
                continue;
            }
            let said = String::from_utf8_lossy(trimmed(&line));
            let said = said.trim();
            if found.is_none() && !said.is_empty() {
                found = Some(said.chars().take(SAID_MAX).collect());
            }
        }
    }))
}

/// Where the program is on this machine, and nothing where it is not: a name no
/// folder holds, a folder of that name and a file this app may not run are all
/// the same answer.
fn found(agent: &Agent) -> Option<PathBuf> {
    found_in(
        agent.program,
        std::env::var_os(agent.env).as_deref(),
        &looked_in(),
    )
}

/// `named` is a person's own answer and is taken whole; without one it is the
/// first spelling of `program` any of `folders` holds.
fn found_in(program: &str, named: Option<&OsStr>, folders: &[PathBuf]) -> Option<PathBuf> {
    if let Some(named) = named.filter(|held| !held.is_empty()) {
        let at = settled(&PathBuf::from(named));
        return absolute_and_runnable(&at).then_some(at);
    }
    for folder in folders {
        for name in spellings(program) {
            let at = settled(&folder.join(name));
            if absolute_and_runnable(&at) {
                return Some(at);
            }
        }
    }
    None
}

/// The PATH this process was given and `ALSO_LOOKED_IN` after it, each folder
/// once and in that order.
fn looked_in() -> Vec<PathBuf> {
    let told = std::env::var_os("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    let also = ALSO_LOOKED_IN
        .iter()
        .filter_map(|at| match at.strip_prefix("~/") {
            Some(under) => home.as_ref().map(|home| PathBuf::from(home).join(under)),
            None => Some(PathBuf::from(at)),
        });
    let mut seen = HashSet::new();
    std::env::split_paths(&told)
        .chain(also)
        .filter(|folder| !folder.as_os_str().is_empty() && seen.insert(folder.clone()))
        .collect()
}

/// Whether this is a program that can be run, and one spelling of it.
///
/// **A relative path is refused rather than resolved.** What can be run is
/// asked of this process's own folder, and what runs is started in the folder
/// somebody opened — so a relative spelling is two different files, and which
/// one runs is Rust's own documented "platform specific and unstable". The
/// folder a person opened would then decide what executes.
fn absolute_and_runnable(at: &Path) -> bool {
    at.is_absolute() && runnable(at)
}

#[cfg(unix)]
fn runnable(at: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;

    std::fs::metadata(at)
        .map(|held| held.is_file() && held.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn runnable(at: &Path) -> bool {
    at.is_file()
}

/// What a program of this name is called where it is installed. An npm install
/// on Windows leaves a `.cmd` and nothing under the bare name.
#[cfg(windows)]
fn spellings(program: &str) -> Vec<String> {
    ["exe", "cmd", "bat"]
        .iter()
        .map(|ending| format!("{program}.{ending}"))
        .chain([program.to_owned()])
        .collect()
}

#[cfg(not(windows))]
fn spellings(program: &str) -> Vec<String> {
    vec![program.to_owned()]
}

/// Start the program on its own, so that ending it can reach what it starts.
#[cfg(unix)]
fn apart(how: &mut Command) {
    use std::os::unix::process::CommandExt as _;

    how.process_group(0);
}

#[cfg(not(unix))]
fn apart(_how: &mut Command) {}

/// An agent reads a project by starting programs of its own, and a person who
/// ends a chat means all of them.
#[cfg(unix)]
fn end_it(child: &mut Child) {
    // `apart` made the program its own group leader, so its pid is the group's.
    unsafe { libc::killpg(child.id() as libc::pid_t, libc::SIGKILL) };
    let _ = child.kill();
}

#[cfg(windows)]
fn end_it(child: &mut Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn end_it(child: &mut Child) {
    let _ = child.kill();
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

/// Start a session, ending whatever stood. `tools` are the acts the webview
/// will serve, as `advertisedChatTools` in `@sloppy/types` answered.
#[tauri::command]
pub async fn chat_open(
    folders: State<'_, Folders>,
    chat: State<'_, Chat>,
    agent: String,
    root: String,
    tools: Vec<Advertised>,
    heard: Channel<Heard>,
) -> Result<(), ChatError> {
    let held = AGENTS
        .iter()
        .find(|one| one.id == agent)
        .ok_or_else(|| ChatError::new(NO_PROGRAM))?;
    let at = folders.opened(&root)?.to_path_buf();
    let chat = chat.inner().clone();
    let telling: Arc<dyn Fn(Heard) + Send + Sync> = Arc::new(move |message| {
        let _ = heard.send(message);
    });
    tauri::async_runtime::spawn_blocking(move || {
        let program = found(held).ok_or_else(|| ChatError::new(NO_PROGRAM))?;
        open(held, &program, &at, &tools, telling, chat)
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

    /// The PATH a bundled app is given names none of the folders a person
    /// installs a tool into, so a folder is enough to be found in.
    #[cfg(unix)]
    #[test]
    fn a_program_is_found_in_a_folder_it_is_installed_in() {
        let at = scratch("installed");
        let program = stub(&at, "agent", "echo hi");

        assert_eq!(found_in("agent", None, &[at]), Some(settled(&program)));
    }

    #[cfg(unix)]
    #[test]
    fn a_file_this_app_may_not_run_is_not_a_program() {
        let at = scratch("unrunnable");
        fs::write(at.join("agent"), "#!/bin/sh\n").expect("the file");
        fs::create_dir_all(at.join("folder")).expect("the folder");
        let folders = [at];

        assert_eq!(found_in("agent", None, &folders), None);
        assert_eq!(found_in("folder", None, &folders), None);
    }

    /// Somebody who keeps it somewhere nothing looks names it themselves.
    #[cfg(unix)]
    #[test]
    fn a_program_a_person_names_is_taken_over_the_folders() {
        let named_at = scratch("named");
        let looked = scratch("looked");
        let named = stub(&named_at, "elsewhere", "echo hi");
        stub(&looked, "agent", "echo hi");
        let folders = [looked];

        assert_eq!(
            found_in("agent", Some(named.as_os_str()), &folders),
            Some(settled(&named))
        );
    }

    /// What can be run is asked of this process's own folder and what runs is
    /// started in the folder somebody opened, so a relative spelling would be
    /// two different files and the folder a person opened would pick which.
    /// Nothing here moves this process's own folder: that is shared by every
    /// test running beside it.
    #[cfg(unix)]
    #[test]
    fn a_program_spelled_relatively_is_refused_rather_than_resolved() {
        let at = scratch("relative");
        stub(&at, "agent", "echo hi");
        let folder = at.file_name().expect("a name");

        assert!(!absolute_and_runnable(Path::new("agent")));
        assert!(!absolute_and_runnable(Path::new("./agent")));
        assert_eq!(
            found_in("agent", Some(OsStr::new("./agent")), &[]),
            found_in(
                "agent",
                Some(OsStr::new("./agent")),
                &[PathBuf::from(folder)]
            ),
        );
    }

    /// Everything `found_in` answers is one absolute spelling, whichever way it
    /// was asked for.
    #[cfg(unix)]
    #[test]
    fn what_is_found_is_always_one_absolute_spelling() {
        let at = scratch("absolute");
        let program = stub(&at, "agent", "echo hi");
        let over_path = found_in("agent", None, &[at]).expect("over the folders");
        let named = found_in("agent", Some(program.as_os_str()), &[]).expect("named");

        for found in [over_path, named] {
            assert!(found.is_absolute());
            assert_eq!(found, settled(&program));
        }
    }

    #[test]
    fn where_it_is_looked_for_names_each_folder_once() {
        let folders = looked_in();
        let mut seen = HashSet::new();

        assert!(folders.iter().all(|folder| seen.insert(folder.clone())));
        assert!(!folders.is_empty());
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

    #[cfg(unix)]
    fn waits(until: impl Fn() -> bool) {
        let started = Instant::now();
        while !until() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "it never happened"
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

        open(&STUB, &program, &at, &[], thread.sink(), chat).expect("a session");

        waits(|| thread.overs().len() == 1);
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
        open(&STUB, &program, &at, &[], thread.sink(), chat.clone()).expect("a session");
        waits(|| !thread.lines().is_empty());

        chat.close();

        waits(|| thread.overs().len() == 1);
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
        open(&STUB, &first, &at, &[], thread.sink(), chat.clone()).expect("one session");
        waits(|| thread.lines() == ["one"]);

        open(&STUB, &second, &at, &[], thread.sink(), chat.clone()).expect("another");

        waits(|| thread.overs().len() == 1);
        assert_eq!(thread.overs(), [(true, None)]);
        assert!(chat.says("{}").is_ok(), "the session standing was reaped");
        chat.close();
        waits(|| thread.overs().len() == 2);
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

        open(&STUB, &program, &at, &[], thread.sink(), chat).expect("a session");

        waits(|| thread.overs().len() == 1);
        assert!(thread.lines().is_empty());
        assert_eq!(thread.overs(), [(false, Some(TOO_MUCH.to_owned()))]);
    }
}
