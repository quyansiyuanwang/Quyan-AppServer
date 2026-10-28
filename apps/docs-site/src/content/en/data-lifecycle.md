# Data archive and cleanup

The data lifecycle page manages hot-data retention for large tables and lists OSS archive files that were uploaded and verified.

## Requirements

- The data lifecycle management permission is required.
- Updating policies, running an archive manually, and downloading an archive require a 2FA step-up.
- Aliyun OSS must be configured. Without it, no deletion is performed.

## Default Policies

API logs, notification logs, and AI request logs default to 90 days. Business logs, relay usage, and monthly-pass usage are retained for 180 days. Tracking and heatmap data are retained for 30 days, and server file logs for 14 days. AI request log archives are permanent; other archive files default to one year. The current policy on the page determines actual hot-data retention.

Balance transactions are never automatically archived or deleted.

## Lifecycle read permissions

In IAM enforce mode, lifecycle reads still require lifecycle management eligibility from a platform-managed global user group. The policy list uses `quyan:system:data_lifecycle:ListPolicies`, previews use `quyan:system:data_lifecycle:PreviewPolicy`, and candidates use `quyan:system:data_lifecycle:ListCandidates`, on `acs:platform:*:platform:lifecycle-dataset/<dataset>`. Each action independently controls the selected datasets; none grants archive execution or policy updates.

The list contains only authorized, active datasets. Candidate counts are read only after authorization. Denied datasets are omitted without reading their counts or candidate contents. Candidate summaries remain redacted; unknown datasets, missing security context, or revocation during loading cause the request to fail. Server file logs are also authorized through the `server_logs` dataset.

Schedule reads independently require `quyan:system:data_lifecycle:GetSchedule` on `acs:platform:*:platform:lifecycle-schedule/default`. This grants schedule visibility, not schedule updates or task execution.

## Run history and archive list permissions

In IAM enforce mode, `quyan:system:data_lifecycle:ListRuns` controls run history visibility on `acs:platform:*:platform:lifecycle-run/<runId>`. Runs are filtered before pagination and totals are calculated; denied or inactive runs are omitted.

Archive lists require `quyan:system:data_lifecycle:ListArtifacts` on both the parent run and `acs:platform:*:platform:lifecycle-artifact/<runId>/<artifactId>`. The archive count in run history includes only currently visible files. Runs without archive-list access show zero instead of exposing hidden file counts. File pagination and totals likewise include only authorized, active files.

Authorized files retain the existing object key, checksum, size, expiry and deletion metadata; listing does not grant download access. Changes to runs, files, groups or authorization during loading cause the request to fail rather than release data obtained under stale access.

## Archive download permissions

In IAM enforce mode, downloads independently require `quyan:system:data_lifecycle:DownloadArtifact` on `acs:platform:*:platform:lifecycle-artifact/<runId>/<artifactId>`. The server verifies the actual parent run from the file record; clients cannot choose another parent or object key. Listing, preview and run-history access do not include downloads.

Only active, undeleted, unexpired files attached to active runs can be downloaded. The server authorizes before OSS reads, rechecks before cold-archive restoration and signing, and checks again before returning restore status or a temporary URL. Revocation or file changes during the request cause rejection; an OSS restore already requested is not automatically undone by subsequent revocation. Signed URLs remain valid for 300 seconds; later revocation cannot retroactively invalidate an OSS link already delivered. Do not share these links.

## Policy and schedule update permissions

In IAM enforce mode, `quyan:system:data_lifecycle:UpdatePolicy` controls enablement and hot-data retention on `acs:platform:*:platform:lifecycle-dataset/<dataset>`. `quyan:system:data_lifecycle:UpdateSchedule` controls the schedule switch and time on `acs:platform:*:platform:lifecycle-schedule/default`. Read access does not replace update access, and platform global-group eligibility remains required. Policy update responses retain candidate counts for that dataset, not raw candidate records.

Saving rechecks identity, group, role session, resource versions and current authorization. Revocation or version conflicts inside the transaction reject or roll back the save. Both schedule settings are saved atomically rather than partially. Policy updates cannot change archive retention, dataset identity or background task status. Step-up authentication and replay protection remain required, and successful updates produce audit records.

## Execution Rules

1. The policy table shows how many records will be archived and deleted.
2. Select “Run archive” to open a paginated preview dialog with record IDs, timestamps, and redacted summaries. Execution starts only after confirmation.
3. The server writes gzip NDJSON and uploads it to OSS.
4. Hot rows are deleted in batches only after object size and SHA-256 verification succeeds.
5. Run history reports candidate, archived, and deleted counts. Incomplete source data is retained after a failure; batches already archived and deleted are not rolled back.

Manual archiving requires `quyan:system:data_lifecycle:RunPolicy` on the target dataset. Batch archiving requires the separate `quyan:system:data_lifecycle:RunBatch` action. Both use `acs:platform:*:platform:lifecycle-dataset/<dataset>` and require lifecycle management eligibility from a platform global user group. Policy updates, preview, download, and history permissions do not grant execution permission. Execution still requires two-factor verification and replay protection.

An explicit batch selection is authorized in full before archiving starts. An omitted or empty dataset array processes only the enabled policies selected for that request. Denial on any target prevents execution. During processing, the server repeatedly checks the user, group, role session, policy version, and authorization. Revocation interrupts the request and stops subsequent datasets.

Database source records are deleted only after upload verification, confirmation that the current records match the exported snapshot, and authorization checks within the transaction. Archive metadata, source deletion, and progress are saved together. Server log files are also checked for authorization and content changes before deletion. Archiving advances in batches: a later failure or revocation cannot undo completed uploads or deletions. Review the archived and deleted counts before retrying remaining data. A failure after upload but before metadata is saved retains the source data and may leave an OSS object without a corresponding archive entry; handle such objects through storage operations procedures.

## Scheduled Archives

The default schedule runs enabled policies daily at 03:20 (Asia/Shanghai). Administrators can change the time or disable the schedule on the page; saved changes take effect within about one minute.

Archive details are available as administrator downloads in the first release, not as in-app full-text search. The archive bucket is private by default, so a normal object URL copied from the OSS console has no signature and returns AccessDenied; use the page download button to generate a temporary signed URL. If OSS has transitioned an object to Archive or cold storage, the first download click requests a restore; download it again after OSS finishes restoring the object. The enabled scheduled task cleans up expired archive files. Cleanup may be delayed if scheduling is disabled or OSS is unavailable; do not assume a file is deleted immediately at expiry.

Downloads are gzip-compressed NDJSON containing the original rows. The Dangerous Maintenance page can preview and import supported datasets. Imports use a separate, immediately readable OSS staging bucket, and delete the temporary object after either success or failure. An archive bucket may use Archive or cold storage, but it cannot also be the import staging bucket. `relay_usages` and `monthly_pass_usages` depend on token/pass rows that must still exist; missing dependencies block the import. Balance transactions and AI request logs are outside the import scope; AI request log archives are download-only for auditing.

After database rows are deleted, InnoDB normally marks the pages reusable but does not immediately shrink the `.ibd` file. Reclaiming operating-system disk space requires a separate table rebuild or `OPTIMIZE TABLE` during a low-traffic window; archival runs do not do this automatically. Server log files are removed from local disk after the OSS upload is verified.

## Dangerous maintenance run history

When IAM enforcement is enabled, maintenance history requires the dangerous-maintenance permission from a platform-managed global group. `quyan:system:data_maintenance:ListRuns` controls which runs appear in the list, while `quyan:system:data_maintenance:GetRun` independently controls run details. Account ownership, extra user permissions, or an account-created group cannot independently grant platform maintenance eligibility.

The run resource is `acs:platform:*:platform:maintenance-run/<runId>`. Matching Deny statements exclude runs, and pagination and total counts include only authorized active records. The response contains progress, counts and results without the private temporary import-object key. Requests fail if the run changes or the group's permission, policy or role session is revoked while data is being loaded. History access does not grant import or table optimization.

Optimization previews use `quyan:system:data_maintenance:PreviewOptimize`; import previews use `quyan:system:data_maintenance:PreviewImport`. Each targets `acs:platform:*:platform:maintenance-dataset/<dataset>`. Only datasets supported by dangerous maintenance can be selected. All datasets in an optimization preview must be allowed before the server reads table statistics; a matching Deny rejects the entire request. Import previews return validation counts and summaries, not the original imported record bodies. Both previews retain 2FA, replay protection and CAPTCHA. Preview access does not grant execution.

Creating a table-optimization task requires `quyan:system:data_maintenance:CreateOptimizeRun` on every selected dataset, in addition to platform maintenance eligibility. Preview and history permissions do not grant task creation. The request retains the `OPTIMIZE` confirmation, step-up verification, replay protection and CAPTCHA. The server sets the initiating user, actual table names and initial queued status. If identity, group, role or authorization changes before the queue transaction commits, creation is denied or rolled back. This endpoint queues a maintenance task; it does not execute table optimization synchronously.

Creating an import task requires `quyan:system:data_maintenance:CreateImportRun` on the selected dataset and platform maintenance eligibility. Preview or optimization permissions do not grant import creation. Keep the `IMPORT` confirmation header, step-up verification, replay protection and CAPTCHA. Authorization precedes archive validation and upload; only a verified staging upload can be queued. Failed upload verification or queue authorization triggers temporary-object cleanup, and queue responses do not disclose the private staging object key. If cleanup storage is unavailable, the request still fails and a cleanup error is logged; it never becomes an authorized import.
