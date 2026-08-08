# Data archive and cleanup

The data lifecycle page manages hot-data retention for large tables and lists OSS archive files that were uploaded and verified.

## Requirements

- The data lifecycle management permission is required.
- Updating policies, running an archive manually, and downloading an archive require a 2FA step-up.
- Aliyun OSS must be configured. Without it, no deletion is performed.

## Default Policies

API and notification logs are retained for 90 days. Business logs, relay usage, and monthly-pass usage are retained for 180 days. Tracking and heatmap data are retained for 30 days. Archive files are retained for one year.

Balance transactions are never automatically archived or deleted.

## Execution Rules

1. The policy table shows how many records will be archived and deleted.
2. Select “Run archive” to open a paginated preview dialog with record IDs, timestamps, and redacted summaries. Execution starts only after confirmation.
3. The server writes gzip NDJSON and uploads it to OSS.
4. Hot rows are deleted in batches only after object size and SHA-256 verification succeeds.
5. Run history reports candidate, archived, and deleted counts. Failures preserve source data and can be retried.

## Scheduled Archives

The default schedule runs enabled policies daily at 03:20 (Asia/Shanghai). Administrators can change the time or disable the schedule on the page; saved changes take effect within about one minute.

Archive details are available as administrator downloads in the first release, not as in-app full-text search. Expired archive objects are removed automatically.
