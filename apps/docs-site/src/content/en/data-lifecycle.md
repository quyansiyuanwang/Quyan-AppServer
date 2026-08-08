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

1. Preview the candidate count.
2. The server writes gzip NDJSON and uploads it to OSS.
3. Hot rows are deleted in batches only after object size and SHA-256 verification succeeds.
4. Run history reports candidate, archived, and deleted counts. Failures preserve source data and can be retried.

Archive details are available as administrator downloads in the first release, not as in-app full-text search. Expired archive objects are removed automatically.
