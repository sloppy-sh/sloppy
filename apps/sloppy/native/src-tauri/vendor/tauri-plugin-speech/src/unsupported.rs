//! A platform with no recogniser or recorder this plugin speaks to.

use std::path::Path;

use crate::{Authorization, Error, Result, Transcribed};

pub(crate) fn available() -> bool {
    false
}

pub(crate) fn authorization() -> Authorization {
    Authorization::Restricted
}

pub(crate) fn request_authorization() -> Authorization {
    Authorization::Restricted
}

pub(crate) fn transcribe(_wav: &[u8], _locale: Option<&str>) -> Result<Transcribed> {
    Err(Error::Unavailable)
}

pub(crate) fn microphone() -> Authorization {
    Authorization::Restricted
}

pub(crate) fn request_microphone() -> Authorization {
    Authorization::Restricted
}

pub(crate) struct Recorder;

impl Recorder {
    pub(crate) fn start(_at: &Path) -> Result<Self> {
        Err(Error::CannotRecord)
    }

    pub(crate) fn stop(self) {}
}
