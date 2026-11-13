use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// A recording on disk for as long as this is held, and gone after.
pub(crate) struct Recording(PathBuf);

impl Recording {
    pub(crate) fn written(wav: &[u8]) -> std::io::Result<Self> {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let mut salt = [0u8; 8];
        let _ = getrandom::getrandom(&mut salt);
        let at = std::env::temp_dir().join(format!(
            "speech-{}-{}-{}.wav",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            salt.iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&at)?;
        let recording = Recording(at);
        file.write_all(wav)?;
        Ok(recording)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recording_is_on_disk_while_held_and_gone_after() {
        let recording = Recording::written(b"RIFFsound").expect("written");
        let at = recording.path().to_path_buf();

        assert_eq!(at.extension().and_then(|it| it.to_str()), Some("wav"));
        assert_eq!(fs::read(&at).unwrap(), b"RIFFsound");

        drop(recording);
        assert!(!at.exists());
    }

    #[test]
    fn two_recordings_never_share_a_file() {
        let one = Recording::written(b"one").unwrap();
        let two = Recording::written(b"two").unwrap();

        assert_ne!(one.path(), two.path());
        assert_eq!(fs::read(one.path()).unwrap(), b"one");
        assert_eq!(fs::read(two.path()).unwrap(), b"two");
    }
}
