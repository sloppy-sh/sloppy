use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("This computer cannot recognise speech.")]
    Unavailable,
    #[error("Speech recognition is not allowed for this app. Allow it in the system's privacy settings.")]
    NotAllowed,
    #[error("That recording could not be read.")]
    Unreadable,
    #[error("No words could be heard in that recording.")]
    Unheard,
    #[error("Recognising that took too long.")]
    TooSlow,
    #[error("Sloppy cannot record here.")]
    CannotRecord,
    #[error("Sloppy is not allowed to use the microphone. Allow it in System Settings → Privacy & Security → Microphone.")]
    MicrophoneNotAllowed,
    #[error("The microphone could not be started. Try again.")]
    Unrecorded,
    #[error("Sloppy is already listening.")]
    AlreadyRecording,
    #[error("Sloppy was not listening.")]
    NotRecording,
    #[error("The recording could not be kept long enough to hear it.")]
    Io(#[from] std::io::Error),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
