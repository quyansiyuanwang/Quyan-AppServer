//! Named, bounded transport policies shared by server, process control and tests.
use std::time::Duration;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const RESPONSE_HEADER_TIMEOUT: Duration = Duration::from_secs(120);
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
pub const CONTROL_TIMEOUT: Duration = Duration::from_secs(3);
pub const START_TIMEOUT: Duration = Duration::from_secs(20);
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);
pub const STOP_TIMEOUT: Duration = Duration::from_secs(10);
pub const POLL_INTERVAL: Duration = Duration::from_millis(250);
pub const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_CONCURRENT_REQUESTS: usize = 32;
pub const RECENT_REQUEST_LIMIT: usize = 20;
pub const RETRY_STATUSES: [u16; 6] = [408, 429, 500, 502, 503, 504];

pub const HEALTH_FAILURE_THRESHOLD: u32 = 3;
pub const HEALTH_COOLDOWN: Duration = Duration::from_secs(30);
pub const REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(30);
