//! The computer's own speech recognition and microphone: whether there are
//! ones, whether the person has let the app use them, a recording made, and a
//! recording turned into words on this computer. macOS has both today; every
//! other platform answers that it has neither.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use error::{Error, Result};
pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
use desktop::platform;
#[cfg(mobile)]
mod mobile;
#[cfg(mobile)]
use mobile::platform;

mod commands;
mod error;
mod models;
mod recorder;
#[cfg(any(mobile, not(target_os = "macos")))]
mod unsupported;
mod wav;

use recorder::Recorder;

/// This computer's recogniser and microphone.
pub struct Speech {
    recorder: Recorder,
}

impl Speech {
    /// Whether this computer has a recogniser the person could let the app use.
    pub fn available(&self) -> bool {
        platform::available()
    }

    pub fn authorization(&self) -> Authorization {
        platform::authorization()
    }

    /// Asks the person, the first time only, and blocks until they answer.
    /// Every later call answers what they said without asking again.
    pub fn request_authorization(&self) -> Authorization {
        platform::request_authorization()
    }

    /// What `wav` says, heard on this computer. Blocks for as long as hearing
    /// takes, two minutes at the most.
    pub fn transcribe(&self, wav: &[u8], locale: Option<&str>) -> Result<Transcribed> {
        platform::transcribe(wav, locale)
    }

    pub fn microphone(&self) -> Authorization {
        platform::microphone()
    }

    /// Asks the person, the first time only, and blocks until they answer.
    pub fn request_microphone(&self) -> Authorization {
        platform::request_microphone()
    }

    /// Starts recording from the microphone, asking the person first where they
    /// have not been asked. One recording at a time.
    pub fn start_recording(&self) -> Result<()> {
        self.request_microphone();
        self.recorder.start(recorder::LONGEST)
    }

    /// The recording as a WAV of mono 16-bit PCM at 16 kHz, ended. One still
    /// running at a minute was ended there, and is answered as it stands.
    pub fn stop_recording(&self) -> Result<Vec<u8>> {
        self.recorder.stop()
    }
}

pub trait SpeechExt<R: Runtime> {
    fn speech(&self) -> &Speech;
}

impl<R: Runtime, T: Manager<R>> SpeechExt<R> for T {
    fn speech(&self) -> &Speech {
        self.state::<Speech>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("speech")
        .invoke_handler(tauri::generate_handler![
            commands::available,
            commands::authorization,
            commands::request_authorization,
            commands::transcribe,
            commands::microphone,
            commands::request_microphone,
            commands::start_recording,
            commands::stop_recording,
        ])
        .setup(|app, _api| {
            app.manage(Speech {
                recorder: Recorder::default(),
            });
            Ok(())
        })
        .build()
}
