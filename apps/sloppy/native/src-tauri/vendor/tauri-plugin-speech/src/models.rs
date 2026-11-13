use serde::{Deserialize, Serialize};

/// What the person has said about the app hearing them.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Authorization {
    Authorized,
    Denied,
    /// Something other than the person rules it out, such as a device policy,
    /// or a platform without the recogniser or the microphone asked about.
    Restricted,
    /// Not asked yet.
    Undecided,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Transcribed {
    pub said: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
pub struct Recorded {
    /// The WAV, base64: the bridge carries JSON.
    pub wav: String,
}
