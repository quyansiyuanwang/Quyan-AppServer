use anyhow::{Context, Result};
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tracing_subscriber::{
    fmt::MakeWriter, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter,
};

const MAX_EVENTS: usize = 64;
static CURRENT_LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Debug)]
pub struct EventBuffer {
    entries: VecDeque<String>,
}

impl EventBuffer {
    pub fn new() -> Self {
        Self {
            entries: VecDeque::with_capacity(MAX_EVENTS),
        }
    }

    pub fn push(&mut self, level: &str, message: impl Into<String>) {
        if self.entries.len() == MAX_EVENTS {
            self.entries.pop_front();
        }
        self.entries
            .push_back(format!("[{level}] {}", message.into()));
    }

    pub fn entries(&self) -> impl Iterator<Item = &String> {
        self.entries.iter()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

impl Default for EventBuffer {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug)]
pub struct LogHandle {
    path: PathBuf,
}

impl LogHandle {
    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

pub fn init(debug: bool, mirror_to_stderr: bool) -> Result<LogHandle> {
    let path = log_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("failed to create Quyan log directory")?;
    }
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .context("failed to open Quyan log file")?;
    let writer = DualWriter {
        file: Arc::new(Mutex::new(file)),
        mirror_to_stderr,
    };
    let filter = if debug {
        EnvFilter::new("debug")
    } else {
        EnvFilter::new("info")
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(writer),
        )
        .try_init()
        .ok();
    let _ = CURRENT_LOG_PATH.set(path.clone());
    Ok(LogHandle { path })
}

pub fn log_path() -> PathBuf {
    let root = dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(|| PathBuf::from(".quyan"));
    let directory = root.join("Quyan").join("logs");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    directory.join(format!("quyan-{stamp}-{}.log", std::process::id()))
}

pub fn current_log_path() -> Option<&'static PathBuf> {
    CURRENT_LOG_PATH.get()
}

pub fn platform_description() -> String {
    format!("{} {}", std::env::consts::OS, std::env::consts::ARCH)
}

pub fn redact(message: &str) -> String {
    let mut output = message.to_string();
    for prefix in ["ak_", "rlt_", "dpk_"] {
        let mut offset = 0;
        while let Some(position) = output[offset..].find(prefix) {
            let start = offset + position;
            let end = output[start..]
                .find(|character: char| {
                    !(character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.'))
                })
                .map(|index| start + index)
                .unwrap_or(output.len());
            output.replace_range(start..end, "[REDACTED]");
            offset = start + "[REDACTED]".len();
        }
    }
    if let Some(position) = output.find("Authorization:") {
        let end = output[position..]
            .find('\n')
            .map(|index| position + index)
            .unwrap_or(output.len());
        output.replace_range(position..end, "Authorization: [REDACTED]");
    }
    output
}

#[derive(Clone)]
struct DualWriter {
    file: Arc<Mutex<File>>,
    mirror_to_stderr: bool,
}

struct DualWriterGuard {
    file: Arc<Mutex<File>>,
    stderr: Option<io::Stderr>,
}

impl<'a> MakeWriter<'a> for DualWriter {
    type Writer = DualWriterGuard;

    fn make_writer(&'a self) -> Self::Writer {
        DualWriterGuard {
            file: self.file.clone(),
            stderr: self.mirror_to_stderr.then(io::stderr),
        }
    }
}

impl Write for DualWriterGuard {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let stderr_result = self
            .stderr
            .as_mut()
            .map_or(Ok(bytes.len()), |stderr| stderr.write(bytes));
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(bytes);
            let _ = file.flush();
        }
        stderr_result
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stderr.as_mut().map_or(Ok(()), Write::flush)
    }
}

#[cfg(test)]
mod tests {
    use super::{redact, EventBuffer};

    #[test]
    fn event_buffer_is_bounded() {
        let mut events = EventBuffer::new();
        for index in 0..100 {
            events.push("INFO", format!("event-{index}"));
        }
        assert_eq!(events.len(), 64);
        assert_eq!(
            events.entries().next().map(String::as_str),
            Some("[INFO] event-36")
        );
    }

    #[test]
    fn redacts_credentials_and_authorization_headers() {
        let message =
            "Authorization: Bearer secret\nrlt_abc-123 dpk_abc.456 ak_test-789 should not log";
        let redacted = redact(message);
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("rlt_abc-123"));
        assert!(!redacted.contains("dpk_abc.456"));
        assert!(!redacted.contains("ak_test-789"));
        assert!(redacted.contains("[REDACTED]"));
    }
}
