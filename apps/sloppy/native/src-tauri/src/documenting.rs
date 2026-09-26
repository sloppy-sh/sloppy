//! Starting a tool that reads the project and hands its writing back, and
//! ending the one underway — `DocumentingAccess` in `@sloppy/app-core`
//! declares every act that reaches here, docs/ARCHITECTURE.md § "Asking a tool
//! to write the notes".
//!
//! The program and its options are this file's. What a caller hands over is a
//! folder somebody picked and a prompt, and the prompt reaches the tool on its
//! own input rather than as an argument.

use std::io::{BufReader, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::program::{a_line, drained, end_it, started, trimmed};
use crate::vault::{FileError, Folders};

struct Tool {
    /// The value `DocumentingTool` in `@sloppy/types` carries.
    id: &'static str,
    program: &'static str,
    /// Where a person names the program themselves, for a machine keeping it
    /// somewhere the folders looked in do not reach.
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
        "Bash,Edit,NotebookEdit,Task,WebFetch,WebSearch,Write",
    ],
}];

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
    /// Absent before the program starts in the place, and once whoever ends
    /// the run has taken it, which reaps it.
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
    fn holds(&self, child: Child) {
        let mut held = self.0.lock().unwrap();
        let Some(started) = held.as_mut() else {
            end_it(child);
            return;
        };
        if started.stopped {
            end_it(child);
            return;
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
        if let Some(child) = started.child.take() {
            end_it(child);
        }
    }

    /// End what is underway without it counting as somebody having stopped it,
    /// so that a program nobody can hear out is reaped rather than waited on.
    fn cut(&self) {
        let mut held = self.0.lock().unwrap();
        if let Some(child) = held.as_mut().and_then(|started| started.child.take()) {
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
    let trouble = drained(child.stderr.take(), HEARD_MAX);
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
        let Some(read) = a_line(&mut reader, &mut line, HEARD_MAX) else {
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

fn start(program: &Path, args: &[&str], at: &Path, prompt: &str) -> Result<Child, RunError> {
    let mut how = Command::new(program);
    how.args(args)
        .current_dir(at)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = started(&mut how).map_err(|_| RunError::new(NO_PROGRAM))?;
    if let Some(mut stdin) = child.stdin.take() {
        let prompt = prompt.to_owned();
        thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
        });
    }
    Ok(child)
}

fn found(tool: &Tool) -> Option<PathBuf> {
    crate::program::found(tool.program, std::env::var_os(tool.env).as_deref())
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

    /// Stopping is there to be tapped until the run comes back, so a person
    /// stops it twice and the second is the same one stop.
    #[cfg(unix)]
    #[test]
    fn a_run_stopped_twice_stops_once() {
        let at = scratch("twice");
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
