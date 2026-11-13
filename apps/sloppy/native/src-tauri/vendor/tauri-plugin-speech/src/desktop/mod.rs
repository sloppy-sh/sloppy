#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(target_os = "macos")]
mod microphone;
#[cfg(target_os = "macos")]
pub(crate) use macos as platform;

#[cfg(not(target_os = "macos"))]
pub(crate) use crate::unsupported as platform;
