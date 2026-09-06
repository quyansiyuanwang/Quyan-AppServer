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
/// Shared panel buffer the TUI renders. When set, a compact tracing layer
/// mirrors log lines into it so interactive runs can show diagnostics on the
/// "Recent events" panel without writing to stderr (which would corrupt the
/// alternate screen).
static PANEL_SINK: OnceLock<EventBuffer> = OnceLock::new();

/// A bounded, shared log ring used by the TUI's "Recent events" panel.
#[derive(Clone, Debug, Default)]
pub struct EventBuffer {
    entries: Arc<Mutex<VecDeque<String>>>,
}

impl EventBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, level: &str, message: impl Into<String>) {
        let mut entries = self.entries.lock().expect("event buffer poisoned");
        if entries.len() == MAX_EVENTS {
            entries.pop_front();
        }
        entries.push_back(format!("[{level}] {}", message.into()));
    }

    /// Appends a pre-formatted log line (no level bracket added).
    pub fn push_line(&self, line: impl Into<String>) {
        let mut entries = self.entries.lock().expect("event buffer poisoned");
        if entries.len() == MAX_EVENTS {
            entries.pop_front();
        }
        entries.push_back(line.into());
    }

    pub fn entries(&self) -> Vec<String> {
        self.entries
            .lock()
            .expect("event buffer poisoned")
            .iter()
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.entries.lock().expect("event buffer poisoned").len()
    }

    pub fn clear(&self) {
        self.entries.lock().expect("event buffer poisoned").clear();
    }
}

/// Registers the buffer that the TUI's "Recent events" panel reads from. Call
/// before `init` when the process will render an interactive terminal.
pub fn set_panel_sink(sink: EventBuffer) {
    let _ = PANEL_SINK.set(sink);
}

/// Returns a clone of the registered panel sink, if any.
pub fn panel_sink() -> Option<EventBuffer> {
    PANEL_SINK.get().cloned()
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
    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(writer);
    let subscriber = tracing_subscriber::registry().with(filter).with(file_layer);
    if let Some(sink) = panel_sink() {
        // Compact mirror for the TUI panel: no timestamp/target so a row fits
        // the "Recent events" box. Only enabled for interactive runs.
        let panel_writer = PanelSinkWriter { sink };
        let panel_layer = tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .without_time()
            .with_target(false)
            .with_writer(panel_writer);
        subscriber.with(panel_layer).try_init().ok();
    } else {
        subscriber.try_init().ok();
    }
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

/// Writer for the interactive "Recent events" panel. tracing's fmt layer
/// formats one event then writes it as a single record (the backing buffer
/// never reports a short write), so each `write` carries one complete line;
/// push it into the shared panel buffer right away.
#[derive(Clone)]
struct PanelSinkWriter {
    sink: EventBuffer,
}

impl<'a> MakeWriter<'a> for PanelSinkWriter {
    type Writer = PanelSinkLine;

    fn make_writer(&'a self) -> Self::Writer {
        PanelSinkLine {
            sink: self.sink.clone(),
        }
    }
}

/// Receives one formatted log record and stores it as a panel row.
struct PanelSinkLine {
    sink: EventBuffer,
}

impl Write for PanelSinkLine {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let text = String::from_utf8_lossy(bytes);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            // tracing fmt (target-less) renders `INFO <message>`. Compact to
            // `[INFO] <message>` so the row fits the on-screen box.
            let row = match trimmed.find(char::is_whitespace) {
                Some(split) => format!("[{}] {}", &trimmed[..split], &trimmed[split..].trim()),
                None => format!("[{trimmed}]"),
            };
            self.sink.push_line(row);
        }
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
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
        let events = EventBuffer::new();
        for index in 0..100 {
            events.push("INFO", format!("event-{index}"));
        }
        assert_eq!(events.len(), 64);
        assert_eq!(
            events.entries().first().map(String::as_str),
            Some("[INFO] event-36")
        );
    }

    #[test]
    fn panel_lines_are_buffered_like_manual_rows() {
        let events = EventBuffer::new();
        events.push_line("[INFO] a");
        events.push_line("[DEBUG] b");
        assert_eq!(
            events.entries(),
            vec!["[INFO] a".to_string(), "[DEBUG] b".to_string()]
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
