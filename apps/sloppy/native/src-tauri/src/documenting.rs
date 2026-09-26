//! Starting a tool that reads the project and hands its writing back, and
//! ending the one underway — `DocumentingAccess` in `@sloppy/app-core`
//! declares every act that reaches here, docs/ARCHITECTURE.md § "Asking a tool
//! to write the notes".
//!
//! The program and its options are this file's. What a caller hands over is a
//! folder somebody picked and a prompt, and the prompt reaches the tool on its
//! own input rather than as an argument.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::thread::JoinHandle;

use crate::vault::settled;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::vault::{FileError, Folders};

struct Tool {
    /// The value `DocumentingTool` in `@sloppy/types` carries.
    id: &'static str,
    program: &'static str,
    /// Where a person names the program themselves, for a machine keeping it
    /// somewhere `ALSO_LOOKED_IN` does not reach.
    env: &'static str,
    args: &'static [&'static str],
}

/// Headless, and holding only the tools that read. A run hands its writing
/// back rather than writing a file, which is what `.sloppy/AGENT.md` tells it;
/// these options are what leave it no other way.
const TOOLS: &[Tool] = &[Tool {
    id: "claude_code",
    program: "claude",
    env: "SLOPPY_DOCUMENTING_CLAUDE_CODE",
    args: &[
        "--print",
        "--allowedTools",
        "Read,Grep,Glob",
        "--disallowedTools",
        "Bash,Edit,MultiEdit,NotebookEdit,Task,WebFetch,WebSearch,Write",
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

/// What an answer may run to, the whole of it and so any one line of it: the
/// tool is asked for JSON, which carries its own newlines escaped, so an
/// answer arrives as a single line. A program past this is not answering, and
/// its run is ended rather than what it writes being held here and sent on to
/// the page.
const HEARD_MAX: usize = 1024 * 1024;

const NO_PROGRAM: &str = "Sloppy could not start that tool. Check it is installed, then try again.";
const ALREADY: &str = "Sloppy is already reading this project. Wait for it to finish, or stop it.";
const DIDNT_FINISH: &str = "That did not finish. Try again.";
const TOO_MUCH: &str = "That answer was too long to read. Ask for less, then try again.";

/// What a person is told where a run could not start or could not go on.
#[derive(Debug)]
pub struct RunError(String);

impl RunError {
    fn new(said: impl Into<String>) -> Self {
        RunError(said.into())
    }

    pub fn said(&self) -> &str {
        &self.0
    }
}

impl Serialize for RunError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.said())
    }
}

impl From<FileError> for RunError {
    fn from(error: FileError) -> Self {
        RunError(error.said().into())
    }
}

/// What a run came to. Everything that kept one from finishing other than
/// somebody ending it is a refusal, so this says only which of the two.
#[derive(Debug, Serialize)]
pub struct Answer {
    pub stopped: bool,
}

/// The one run a device has underway, held so that ending it reaches the
/// program and everything that program started.
#[derive(Clone, Default)]
pub struct Running(Arc<Mutex<Option<Started>>>);

#[derive(Default)]
struct Started {
    /// Absent between taking the place and the program starting in it.
    child: Option<Child>,
    stopped: bool,
}

struct Ended {
    stopped: bool,
    finished: bool,
}

impl Running {
    /// Take the place a run is underway in, refused where something already
    /// has it.
    fn begin(&self) -> Result<(), RunError> {
        let mut held = self.0.lock().unwrap();
        if held.is_some() {
            return Err(RunError::new(ALREADY));
        }
        *held = Some(Started::default());
        Ok(())
    }

    /// Hand the started program over, ended straight away where somebody asked
    /// for the run to end while it was starting.
    fn holds(&self, mut child: Child) {
        let mut held = self.0.lock().unwrap();
        let Some(started) = held.as_mut() else {
            end_it(&mut child);
            let _ = child.wait();
            return;
        };
        if started.stopped {
            end_it(&mut child);
        }
        started.child = Some(child);
    }

    /// Give the place back once the program is reaped, and say how it left off.
    fn ends(&self) -> Ended {
        let taken = self.0.lock().unwrap().take();
        let Some(mut started) = taken else {
            return Ended {
                stopped: false,
                finished: false,
            };
        };
        let finished = match started.child.as_mut() {
            Some(child) => child.wait().map(|how| how.success()).unwrap_or(false),
            None => false,
        };
        Ended {
            stopped: started.stopped,
            finished,
        }
    }

    /// End what is underway. Nothing underway is not a failure.
    pub fn stop(&self) {
        let mut held = self.0.lock().unwrap();
        let Some(started) = held.as_mut() else {
            return;
        };
        started.stopped = true;
        if let Some(child) = started.child.as_mut() {
            end_it(child);
        }
    }

    /// End what is underway without it counting as somebody having stopped it,
    /// so that a program nobody can hear out is reaped rather than waited on.
    fn cut(&self) {
        let mut held = self.0.lock().unwrap();
        if let Some(child) = held.as_mut().and_then(|started| started.child.as_mut()) {
            end_it(child);
        }
    }
}

/// `said` is given each line the tool writes out, as it arrives.
fn ask(
    program: &Path,
    args: &[&str],
    at: &Path,
    prompt: &str,
    said: &dyn Fn(String),
    running: &Running,
) -> Result<Answer, RunError> {
    running.begin()?;
    let mut child = match start(program, args, at, prompt) {
        Ok(child) => child,
        Err(refused) => {
            running.ends();
            return Err(refused);
        }
    };
    let out = child.stdout.take();
    let trouble = drained(child.stderr.take());
    running.holds(child);
    let heard = out.map(|out| hear(out, said)).unwrap_or(true);
    if !heard {
        running.cut();
    }
    let ended = running.ends();
    let said_why = trouble.and_then(|held| held.join().ok()).flatten();
    if ended.stopped {
        return Ok(Answer { stopped: true });
    }
    if !heard {
        return Err(RunError::new(TOO_MUCH));
    }
    if ended.finished {
        return Ok(Answer { stopped: false });
    }
    Err(RunError::new(
        said_why.unwrap_or_else(|| DIDNT_FINISH.into()),
    ))
}

/// Every line the program writes out, handed on as it arrives. `false` is a
/// program that went past `HEARD_MAX`.
fn hear(out: ChildStdout, said: &dyn Fn(String)) -> bool {
    let mut reader = BufReader::new(out);
    let mut line = Vec::new();
    let mut all = 0usize;
    loop {
        let Some(read) = a_line(&mut reader, &mut line) else {
            return false;
        };
        if read == 0 {
            return true;
        }
        all += read;
        if all > HEARD_MAX {
            return false;
        }
        said(String::from_utf8_lossy(trimmed(&line)).into_owned());
    }
}

/// One line, never holding more than `HEARD_MAX` of it. `None` is a line that
/// ran past that; `Some(0)` is the end of what the program had to say, which
/// is what a read it could not finish is taken for too.
fn a_line<R: BufRead>(reader: &mut R, line: &mut Vec<u8>) -> Option<usize> {
    line.clear();
    match (&mut *reader)
        .take(HEARD_MAX as u64 + 1)
        .read_until(b'\n', line)
    {
        Ok(read) if read > HEARD_MAX => None,
        Ok(read) => Some(read),
        Err(_) => Some(0),
    }
}

fn trimmed(line: &[u8]) -> &[u8] {
    let held = line.strip_suffix(b"\n").unwrap_or(line);
    held.strip_suffix(b"\r").unwrap_or(held)
}

fn start(program: &Path, args: &[&str], at: &Path, prompt: &str) -> Result<Child, RunError> {
    let mut how = Command::new(program);
    how.args(args)
        .current_dir(at)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apart(&mut how);
    let mut child = how.spawn().map_err(|_| RunError::new(NO_PROGRAM))?;
    if let Some(mut stdin) = child.stdin.take() {
        let prompt = prompt.to_owned();
        thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
        });
    }
    Ok(child)
}

/// The first thing the program said about its own trouble, drained as it runs
/// so that a full pipe cannot hold the program up. A line past `HEARD_MAX` is
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

/// Where the program is on this machine, and nothing where it is not: a name
/// no folder holds, a folder of that name and a file this app may not run are
/// all the same answer.
fn found(tool: &Tool) -> Option<PathBuf> {
    found_in(
        tool.program,
        std::env::var_os(tool.env).as_deref(),
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

/// The PATH this process was given and `ALSO_LOOKED_IN` after it, each
/// folder once and in that order.
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

/// A tool reads a project by starting programs of its own, and a person who
/// stops a run means all of them.
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

/// The tools this device can reach. An empty list is a device with none.
#[tauri::command]
pub async fn documenting_tools() -> Vec<&'static str> {
    // Looking for a program is a walk over folders, off the page's thread.
    tauri::async_runtime::spawn_blocking(|| {
        TOOLS
            .iter()
            .filter(|tool| found(tool).is_some())
            .map(|tool| tool.id)
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn documenting_ask(
    folders: State<'_, Folders>,
    running: State<'_, Running>,
    tool: String,
    root: String,
    prompt: String,
    said: Channel<String>,
) -> Result<Answer, RunError> {
    let held = TOOLS
        .iter()
        .find(|one| one.id == tool)
        .ok_or_else(|| RunError::new(NO_PROGRAM))?;
    let at = folders.opened(&root)?.to_path_buf();
    let running = running.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let program = found(held).ok_or_else(|| RunError::new(NO_PROGRAM))?;
        ask(
            &program,
            held.args,
            &at,
            &prompt,
            &|line| {
                let _ = said.send(line);
            },
            &running,
        )
    })
    .await
    .map_err(|_| RunError::new(DIDNT_FINISH))?
}

#[tauri::command]
pub fn documenting_stop(running: State<'_, Running>) {
    running.stop();
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    use super::*;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch(name: &str) -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-documenting-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        at
    }

    /// A program standing in for the tool, so that no test asks the real one
    /// anything.
    #[cfg(unix)]
    fn stub(at: &Path, name: &str, script: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt as _;

        let file = at.join(name);
        fs::write(&file, format!("#!/bin/sh\n{script}\n")).expect("the stub");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).expect("a stub to run");
        file
    }

    /// What the tool said, and how the run came out.
    #[cfg(unix)]
    fn asked(program: &Path, at: &Path, prompt: &str) -> (Vec<String>, Result<Answer, RunError>) {
        let heard = Mutex::new(Vec::new());
        let answer = ask(
            program,
            &[],
            at,
            prompt,
            &|line| heard.lock().unwrap().push(line),
            &Running::default(),
        );
        (heard.into_inner().unwrap(), answer)
    }

    #[cfg(unix)]
    #[test]
    fn what_the_tool_says_arrives_line_by_line() {
        let at = scratch("lines");
        let program = stub(&at, "tool", "echo one; echo two");

        let (heard, answer) = asked(&program, &at, "");

        assert_eq!(heard, ["one", "two"]);
        assert!(!answer.expect("a run").stopped);
    }

    #[cfg(unix)]
    #[test]
    fn the_prompt_reaches_the_tool_on_its_own_input() {
        let at = scratch("prompt");
        let program = stub(&at, "tool", "cat");

        let (heard, _) = asked(&program, &at, "Say what the parser does");

        assert_eq!(heard, ["Say what the parser does"]);
    }

    /// Nothing a caller hands over becomes an argument, so a prompt that reads
    /// as one is read as words.
    #[cfg(unix)]
    #[test]
    fn a_prompt_that_reads_as_an_option_is_still_the_prompt() {
        let at = scratch("option");
        let program = stub(&at, "tool", "echo \"args:$*\"; cat");

        let (heard, _) = asked(&program, &at, "--dangerously-skip-permissions");

        assert_eq!(heard, ["args:", "--dangerously-skip-permissions"]);
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_runs_in_the_folder_it_was_given() {
        let at = scratch("where");
        let program = stub(&at, "tool", "pwd");
        let project = at.join("project");
        fs::create_dir_all(&project).expect("the project");

        let (heard, _) = asked(&program, &project, "");

        assert_eq!(heard, [crate::vault::settled(&project).to_string_lossy()]);
    }

    #[cfg(unix)]
    #[test]
    fn a_program_this_machine_has_not_got_is_said_plainly() {
        let at = scratch("missing");

        let (_, answer) = asked(&at.join("nothing-here"), &at, "");

        assert_eq!(answer.unwrap_err().said(), NO_PROGRAM);
    }

    /// A tool that could not go on has words for the person, and they are the
    /// ones it said rather than ours.
    #[cfg(unix)]
    #[test]
    fn what_the_tool_said_about_its_trouble_is_what_comes_back() {
        let at = scratch("trouble");
        let program = stub(&at, "tool", "echo 'Sign in to keep going' >&2; exit 1");

        let (_, answer) = asked(&program, &at, "");

        assert_eq!(answer.unwrap_err().said(), "Sign in to keep going");
    }

    #[cfg(unix)]
    #[test]
    fn a_run_that_fails_silently_still_says_what_to_do() {
        let at = scratch("silent");
        let program = stub(&at, "tool", "exit 3");

        let (_, answer) = asked(&program, &at, "");

        assert_eq!(answer.unwrap_err().said(), DIDNT_FINISH);
    }

    #[cfg(unix)]
    #[test]
    fn a_second_run_is_refused_while_one_is_underway() {
        let at = scratch("second");
        let program = stub(&at, "tool", "echo starting; sleep 30");
        let running = Running::default();
        let held = running.clone();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let saying = heard.clone();
        let where_at = at.clone();
        let first = thread::spawn(move || {
            ask(
                &program,
                &[],
                &where_at,
                "",
                &|line| saying.lock().unwrap().push(line),
                &held,
            )
        });
        waits(|| !heard.lock().unwrap().is_empty());

        let refused = ask(Path::new("/bin/echo"), &[], &at, "", &|_| {}, &running).unwrap_err();

        running.stop();
        first.join().expect("the first run").expect("an answer");
        assert_eq!(refused.said(), ALREADY);
    }

    #[cfg(unix)]
    #[test]
    fn a_run_somebody_stops_says_so_rather_than_refusing() {
        let at = scratch("stopped");
        let program = stub(&at, "tool", "echo starting; sleep 30");
        let running = Running::default();
        let held = running.clone();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let saying = heard.clone();
        let run = thread::spawn(move || {
            ask(
                &program,
                &[],
                &at,
                "",
                &|line| saying.lock().unwrap().push(line),
                &held,
            )
        });
        waits(|| !heard.lock().unwrap().is_empty());

        running.stop();

        assert!(run.join().expect("the run").expect("an answer").stopped);
    }

    /// A tool reads a project by starting programs of its own, and stopping the
    /// run means all of them — half a note is worse than no note.
    #[cfg(unix)]
    #[test]
    fn stopping_a_run_ends_what_the_tool_started() {
        let at = scratch("children");
        let left = at.join("left-behind");
        let program = stub(
            &at,
            "tool",
            &format!(
                "(sleep 2; echo late > {}) & echo started; wait",
                left.display()
            ),
        );
        let running = Running::default();
        let held = running.clone();
        let heard = Arc::new(Mutex::new(Vec::new()));
        let saying = heard.clone();
        let run = thread::spawn(move || {
            ask(
                &program,
                &[],
                &at,
                "",
                &|line| saying.lock().unwrap().push(line),
                &held,
            )
        });
        waits(|| !heard.lock().unwrap().is_empty());

        running.stop();
        run.join().expect("the run").expect("an answer");

        thread::sleep(Duration::from_secs(3));
        assert!(!left.exists(), "the program the tool started outlived it");
    }

    /// Nothing underway is not a failure.
    #[test]
    fn stopping_nothing_is_an_answer() {
        Running::default().stop();
    }

    /// A tool that loops, or another program that happens to answer to the same
    /// name, must not be able to fill this app's memory or the page's.
    #[cfg(unix)]
    #[test]
    fn a_program_that_never_stops_talking_is_ended_rather_than_heard_out() {
        let at = scratch("flood");
        let program = stub(&at, "tool", "yes aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

        let (heard, answer) = asked(&program, &at, "");

        assert_eq!(answer.unwrap_err().said(), TOO_MUCH);
        let held: usize = heard.iter().map(|line| line.len() + 1).sum();
        assert!(held <= HEARD_MAX);
    }

    /// The tool is asked for JSON, which carries its newlines escaped, so the
    /// whole of an answer is one line and a long one is an ordinary answer.
    #[cfg(unix)]
    #[test]
    fn a_whole_answer_on_one_line_is_heard_out() {
        let at = scratch("one-line");
        let much = 200 * 1024;
        let program = stub(
            &at,
            "tool",
            &format!("head -c {much} /dev/zero | tr '\\0' 'a'"),
        );

        let (heard, answer) = asked(&program, &at, "");

        assert!(!answer.expect("a run").stopped);
        assert_eq!(heard.len(), 1);
        assert_eq!(heard[0].len(), much);
    }

    #[cfg(unix)]
    #[test]
    fn one_line_longer_than_an_answer_ends_the_run_rather_than_being_held() {
        let at = scratch("long-line");
        let much = HEARD_MAX + 1024;
        let program = stub(
            &at,
            "tool",
            &format!("head -c {much} /dev/zero | tr '\\0' 'a'"),
        );

        let (heard, answer) = asked(&program, &at, "");

        assert_eq!(answer.unwrap_err().said(), TOO_MUCH);
        assert!(heard.is_empty());
    }

    /// The PATH a bundled app is given names none of the folders a person
    /// installs a tool into, so a folder is enough to be found in.
    #[cfg(unix)]
    #[test]
    fn a_program_is_found_in_a_folder_it_is_installed_in() {
        let at = scratch("installed");
        let program = stub(&at, "tool", "echo hi");

        assert_eq!(found_in("tool", None, &[at]), Some(settled(&program)));
    }

    #[cfg(unix)]
    #[test]
    fn the_first_folder_holding_it_is_the_one() {
        let first = scratch("first");
        let second = scratch("second");
        let program = stub(&first, "tool", "echo hi");
        stub(&second, "tool", "echo hi");

        assert_eq!(
            found_in("tool", None, &[first, second]),
            Some(settled(&program))
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_file_this_app_may_not_run_is_not_a_program() {
        let at = scratch("unrunnable");
        fs::write(at.join("tool"), "#!/bin/sh\n").expect("the file");
        fs::create_dir_all(at.join("folder")).expect("the folder");
        let folders = [at];

        assert_eq!(found_in("tool", None, &folders), None);
        assert_eq!(found_in("folder", None, &folders), None);
    }

    /// What can be run is asked of this process's own folder and what runs is
    /// started in the folder somebody opened, so a relative spelling would be
    /// two different files and the folder a person opened would pick which. A
    /// program is settled to one absolute spelling before it is either.
    #[cfg(unix)]
    #[test]
    fn a_program_spelled_relatively_is_settled_before_it_is_run() {
        let at = scratch("relative");
        let program = stub(&at, "tool", "echo hi");
        let here = std::env::current_dir().expect("a folder");
        std::env::set_current_dir(&at).expect("to move");

        let named = found_in("tool", Some(OsStr::new("./tool")), &[]);
        let over_path = found_in("tool", None, &[PathBuf::from(".")]);

        std::env::set_current_dir(here).expect("to move back");
        for found in [named, over_path] {
            let found = found.expect("the program");
            assert!(found.is_absolute());
            assert_eq!(found, settled(&program));
        }
    }

    /// Somebody who keeps it somewhere nothing looks names it themselves.
    #[cfg(unix)]
    #[test]
    fn a_program_a_person_names_is_taken_over_the_folders() {
        let named_at = scratch("named");
        let looked = scratch("looked");
        let named = stub(&named_at, "elsewhere", "echo hi");
        stub(&looked, "tool", "echo hi");
        let nowhere = looked.join("nothing-here");
        let folders = [looked];

        assert_eq!(
            found_in("tool", Some(named.as_os_str()), &folders),
            Some(settled(&named))
        );
        assert_eq!(found_in("tool", Some(nowhere.as_os_str()), &folders), None);
    }

    #[test]
    fn where_it_is_looked_for_names_each_folder_once() {
        let folders = looked_in();
        let mut seen = HashSet::new();

        assert!(folders.iter().all(|folder| seen.insert(folder.clone())));
        assert!(!folders.is_empty());
    }

    #[cfg(unix)]
    fn waits(until: impl Fn() -> bool) {
        let started = Instant::now();
        while !until() {
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "it never started"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }
}
