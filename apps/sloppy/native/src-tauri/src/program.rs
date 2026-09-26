//! Starting a program of the person's: where one is on this machine, how it is
//! started so that ending it reaches everything it started, and how what it
//! writes out is read a line at a time — docs/ARCHITECTURE.md § "Asking a tool
//! to write the notes".
//!
//! Two surfaces start a program this way. What they differ in is the program's
//! own options and what a line MEANS, and neither of those is here.

use std::collections::HashSet;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read as _};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, Command};
use std::thread;
use std::thread::JoinHandle;

use crate::vault::settled;

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

/// Where the program is on this machine, and nothing where it is not: a name no
/// folder holds, a folder of that name and a file this app may not run are all
/// the same answer. `named` is a person's own answer, for a machine keeping the
/// program somewhere the folders looked in do not reach.
pub(crate) fn found(program: &str, named: Option<&OsStr>) -> Option<PathBuf> {
    found_in(program, named, &looked_in())
}

/// `named` is a person's own answer and is taken whole; without one it is the
/// first spelling of `program` any of `folders` holds.
///
/// **Every spelling is settled before it is weighed.** What can be run is asked
/// here and what runs is started in the folder somebody opened, so a spelling
/// that is not already one absolute path would be two different files and the
/// folder a person opened would decide which.
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

/// Start the program in a group of its own, so that ending it can reach what
/// it starts.
#[cfg(unix)]
pub(crate) fn started(how: &mut Command) -> std::io::Result<Child> {
    use std::os::unix::process::CommandExt as _;

    how.process_group(0);
    let child = how.spawn()?;
    // The child puts itself in the group as well, before it execs. Where that
    // is what does it, a run ended in the moment between the two would signal a
    // group that is not there yet and leave what the program started running;
    // a child that has already exec'd refuses this, having done it itself.
    let group = child.id() as libc::pid_t;
    unsafe { libc::setpgid(group, group) };
    Ok(child)
}

#[cfg(not(unix))]
pub(crate) fn started(how: &mut Command) -> std::io::Result<Child> {
    how.spawn()
}

/// A program reads a project by starting programs of its own, and a person who
/// ends what is underway means all of them.
///
/// **The group is signalled twice, with the program reaped in between.** A
/// signal reaches the members a group holds at that moment, so a program
/// forking as the first one goes out leaves a child the sweep never saw — and
/// that child holds the pipes open, which is a run nothing is ever heard to end
/// on. Reaping the program is what says no further child can appear, so the
/// second sweep is the last one needed.
///
/// **The program is taken whole, and that is what keeps the sweep this run's.**
/// Reaping gives the number back, so a program ended a second time would
/// signal whatever holds it by then; a caller that cannot end one twice cannot
/// reach another run's children.
#[cfg(unix)]
pub(crate) fn end_it(mut child: Child) {
    // `started` made the program its own group leader, so its pid is the
    // group's, and a group is nobody else's for as long as it holds anyone.
    let group = child.id() as libc::pid_t;
    unsafe { libc::killpg(group, libc::SIGKILL) };
    let _ = child.kill();
    let _ = child.wait();
    unsafe { libc::killpg(group, libc::SIGKILL) };
}

#[cfg(windows)]
pub(crate) fn end_it(mut child: Child) {
    use std::process::Stdio;

    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn end_it(mut child: Child) {
    let _ = child.kill();
}

/// One line, never holding more than `most` of it. `None` is a line that ran
/// past that; `Some(0)` is the end of what the program had to say, which is
/// what a read it could not finish is taken for too.
pub(crate) fn a_line<R: BufRead>(reader: &mut R, line: &mut Vec<u8>, most: usize) -> Option<usize> {
    line.clear();
    match (&mut *reader).take(most as u64 + 1).read_until(b'\n', line) {
        Ok(read) if read > most => None,
        Ok(read) => Some(read),
        Err(_) => Some(0),
    }
}

pub(crate) fn trimmed(line: &[u8]) -> &[u8] {
    let held = line.strip_suffix(b"\n").unwrap_or(line);
    held.strip_suffix(b"\r").unwrap_or(held)
}

/// The first thing the program said about its own trouble, drained as it runs
/// so that a full pipe cannot hold the program up. A line past `most` is
/// drained in pieces, and nothing after it is a sentence a person is shown.
pub(crate) fn drained(
    from: Option<ChildStderr>,
    most: usize,
) -> Option<JoinHandle<Option<String>>> {
    let from = from?;
    Some(thread::spawn(move || {
        let mut reader = BufReader::new(from);
        let mut line = Vec::new();
        let mut found: Option<String> = None;
        let mut listening = true;
        loop {
            let Some(read) = a_line(&mut reader, &mut line, most) else {
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    static NEXT: AtomicUsize = AtomicUsize::new(0);

    fn scratch(name: &str) -> PathBuf {
        let at = std::env::temp_dir().join(format!(
            "sloppy-program-{name}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&at);
        fs::create_dir_all(&at).expect("a scratch folder");
        at
    }

    /// A program standing in for the one a person installed, so that no test
    /// asks a real one anything.
    #[cfg(unix)]
    fn stub(at: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt as _;

        let file = at.join(name);
        fs::write(&file, "#!/bin/sh\necho hi\n").expect("the stub");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).expect("a stub to run");
        file
    }

    /// The PATH a bundled app is given names none of the folders a person
    /// installs a tool into, so a folder is enough to be found in.
    #[cfg(unix)]
    #[test]
    fn a_program_is_found_in_a_folder_it_is_installed_in() {
        let at = scratch("installed");
        let program = stub(&at, "tool");

        assert_eq!(found_in("tool", None, &[at]), Some(settled(&program)));
    }

    #[cfg(unix)]
    #[test]
    fn the_first_folder_holding_it_is_the_one() {
        let first = scratch("first");
        let second = scratch("second");
        let program = stub(&first, "tool");
        stub(&second, "tool");

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

    /// Somebody who keeps it somewhere nothing looks names it themselves, and a
    /// name pointing at nothing is still nothing.
    #[cfg(unix)]
    #[test]
    fn a_program_a_person_names_is_taken_over_the_folders() {
        let named_at = scratch("named");
        let looked = scratch("looked");
        let named = stub(&named_at, "elsewhere");
        stub(&looked, "tool");
        let nowhere = looked.join("nothing-here");
        let folders = [looked];

        assert_eq!(
            found_in("tool", Some(named.as_os_str()), &folders),
            Some(settled(&named))
        );
        assert_eq!(found_in("tool", Some(nowhere.as_os_str()), &folders), None);
    }

    /// What is asked about here is started in the folder somebody opened, so
    /// every way of asking has to come back as the one file.
    #[cfg(unix)]
    #[test]
    fn every_spelling_is_settled_before_it_is_weighed() {
        let at = scratch("spellings");
        let under = at.join("under");
        fs::create_dir_all(&under).expect("the folder");
        let program = stub(&under, "tool");
        let roundabout = under.join("..").join("under");

        let named = found_in("tool", Some(roundabout.join("tool").as_os_str()), &[])
            .expect("the one it was named");
        let over_folders = found_in("tool", None, &[roundabout]).expect("the one in the folder");

        for found in [named, over_folders] {
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
}
