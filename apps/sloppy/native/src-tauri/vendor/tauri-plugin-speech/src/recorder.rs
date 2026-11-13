//! One recording at a time, made on a thread of its own because the platform's
//! recorder lives on the thread that made it.

use std::fs;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::platform;
use crate::wav::Recording;
use crate::{Error, Result};

/// The longest recording, as `SPEECH_LONGEST_MS` in `@sloppy/types` bounds it.
pub(crate) const LONGEST: Duration = Duration::from_secs(60);

/// How long a recording stopped at `LONGEST` waits to be asked for before it
/// is thrown away.
const KEPT_UNASKED: Duration = Duration::from_secs(60);

type Answer = Sender<Result<Vec<u8>>>;

struct Running {
    stop: Sender<Answer>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub(crate) struct Recorder(Mutex<Option<Running>>);

impl Recorder {
    /// Starts recording, and refuses while a recording is running.
    pub(crate) fn start(&self, longest: Duration) -> Result<()> {
        let mut running = self.0.lock().unwrap_or_else(|held| held.into_inner());
        if running
            .as_ref()
            .is_some_and(|one| !one.thread.is_finished())
        {
            return Err(Error::AlreadyRecording);
        }
        let (started, starting) = mpsc::channel::<Result<()>>();
        let (stop, stopping) = mpsc::channel::<Answer>();
        let thread = thread::spawn(move || {
            let file = match Recording::written(&[]) {
                Ok(file) => file,
                Err(error) => {
                    let _ = started.send(Err(error.into()));
                    return;
                }
            };
            let recorder = match platform::Recorder::start(file.path()) {
                Ok(recorder) => recorder,
                Err(error) => {
                    let _ = started.send(Err(error));
                    return;
                }
            };
            let _ = started.send(Ok(()));
            let asked = stopping.recv_timeout(longest);
            recorder.stop();
            let asked = asked.or_else(|_| stopping.recv_timeout(KEPT_UNASKED));
            if let Ok(answer) = asked {
                let _ = answer.send(fs::read(file.path()).map_err(Error::from));
            }
        });
        starting.recv().map_err(|_| Error::Unrecorded)??;
        *running = Some(Running { stop, thread });
        Ok(())
    }

    /// The recording as it stands, ended; refused where none is running.
    pub(crate) fn stop(&self) -> Result<Vec<u8>> {
        let running = self
            .0
            .lock()
            .unwrap_or_else(|held| held.into_inner())
            .take()
            .ok_or(Error::NotRecording)?;
        let (answer, answered) = mpsc::channel();
        running.stop.send(answer).map_err(|_| Error::NotRecording)?;
        answered.recv().map_err(|_| Error::NotRecording)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stopping_with_nothing_started_is_refused() {
        let recorder = Recorder::default();

        assert!(matches!(recorder.stop(), Err(Error::NotRecording)));
    }

    /// Records only where somebody has already let this program use the
    /// microphone: a test must never put the system's question in front of them.
    #[test]
    fn a_recording_is_a_wav_and_a_second_start_waits_for_it() {
        if platform::microphone() != crate::Authorization::Authorized {
            eprintln!("skipped: this computer has not let the tests record");
            return;
        }
        let recorder = Recorder::default();
        recorder.start(LONGEST).expect("started");
        assert!(matches!(
            recorder.start(LONGEST),
            Err(Error::AlreadyRecording)
        ));
        thread::sleep(Duration::from_millis(300));

        let wav = recorder.stop().expect("stopped");

        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert!(matches!(recorder.stop(), Err(Error::NotRecording)));
    }
}
