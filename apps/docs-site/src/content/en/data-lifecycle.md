# Data archive and cleanup

**Data archive** uploads records older than the hot retention period to OSS, verifies the upload, and deletes the corresponding hot data. Configure retention and scheduling, preview candidates, inspect runs, and download artifacts here. **Dangerous data maintenance** separately provides historical record imports and table optimization.

After archival, the original business pages generally stop querying those records. There is no one-click undo or complete restore here. Choose retention periods that meet investigation, reporting, and historical query needs before executing.

## Requirements

- Archival requires `system:data_lifecycle:manage`. Dangerous maintenance requires the separate `system:data_maintenance:manage`. IAM enforcement additionally requires platform global group eligibility and resource actions, described below.
- Policy/schedule changes, manual archival, and downloads require 2FA step-up and replay protection. Maintenance previews and task creation also require CAPTCHA; execution requires a confirmation phrase.
- Archival and downloads require working server-side OSS archive storage. Without it, archival does not proceed to delete source data. Import task creation also needs separately configured staging storage whose objects are immediately readable.
- These management operations do not accept OAuth access tokens. Archives may contain business data and log bodies; control downloads and storage according to the original data's sensitivity.

## Understand default retention

| Dataset                                                              | Default hot retention | Default archive retention |
| -------------------------------------------------------------------- | --------------------- | ------------------------- |
| API logs `api_logs`                                                  | 90 days               | 365 days                  |
| Business logs `business_logs`                                        | 180 days              | 365 days                  |
| Notification logs `notification_logs`                                | 90 days               | 365 days                  |
| Tracking `track_events`, heatmaps `heatmap_points`                   | 30 days               | 365 days                  |
| AI request logs `ai_request_logs`                                    | 90 days               | No automatic expiry       |
| Relay usage `relay_usages`, monthly pass usage `monthly_pass_usages` | 180 days              | 365 days                  |
| Server log files `server_logs`                                       | 14 days               | 365 days                  |

Use the current policies and each artifact's displayed expiry as authoritative. **Forever** means this feature sets no automatic expiry, not protection against deletion in external storage. Balance transactions are excluded from these archival, import, and optimization datasets.

## Change a policy

1. Open **Data archive**, locate the dataset, and check its hot retention and candidate count.
2. Change its enabled state or hot retention days. Days must be an integer from 1 through 3650. **Each change submits a save**; there is no combined policy save button.
3. Complete verification and confirm success. The row's **Reset default** control restores only that dataset's default hot retention days, not all settings.
4. Select **Refresh** to confirm the server's saved policy and updated candidate count. After a failed save, the displayed input or switch alone does not prove the setting took effect.

Archive retention cannot be edited here. Reducing hot retention can increase candidates for the next run, but saving the policy does not itself archive or delete records.

Disabling a policy excludes it from scheduled archival. **Manual archival that explicitly selects the dataset can still run**, including a manually selected batch. Disabled does not mean that every operator is prohibited from executing it.

## Archive manually

1. Save and refresh policies first to confirm current retention.
2. Select **Run archive** on the target row. Inspect record IDs, times, and sanitized summaries in the candidate dialog; server logs show candidate files.
3. Confirm the scope, select **Run archive** again within the dialog, and complete verification.
4. Check status, candidate, archived and deleted counts, and errors under **Runs**. Refresh when you need current results.

For a batch, select policies, choose the batch archive control, and confirm the dataset count and candidate total. The page requires at least one selection. An API batch with no datasets supplied, or an empty array, selects the policies enabled for that request.

Candidate previews reflect query time and do not lock records. Execution determines the scope again using the effective policy. **To archive** and **To delete** both show the candidate count, not two unrelated sets. Server log counts represent files, not lines inside files.

Database records are exported in batches as gzip NDJSON. The uploaded size and SHA-256 metadata are checked before corresponding hot records are deleted. Server logs are uploaded as individual compressed files, verified, and then removed locally.

A task can fail after partial success. Completed deletions do not roll back; an error, timeout, or lost connection also does not prove that nothing ran. Check run records and actual counts before retrying. A failure after upload but before artifact bookkeeping can leave an OSS object unlinked to a run; a storage administrator must investigate it.

## Schedule archival

The default is daily at **03:20, Asia/Shanghai**. Times on this page use that timezone regardless of the browser's location.

1. Set the enabled state and time under scheduled archival.
2. Select **Save schedule**, complete verification, and confirm success. Editing the form alone does not save it.
3. Refresh to confirm the saved settings. Other service instances normally synchronize in about a minute.

Disabling the daily schedule does not undo previous archival or prevent explicit manual runs. Expired artifact cleanup runs with the daily schedule. Physical deletion can be delayed if the schedule is disabled, OSS is unavailable, or cleanup fails. Maintenance queue processing is independent of this daily switch.

## View and download archives

1. Locate a run and open its archives. Inspect artifacts, checksums, sizes, counts, expiry, and deletion times. A run can produce multiple files; download every artifact needed for the investigation.
2. Select an artifact's download control and complete verification. Deleted artifacts no longer provide downloads.
3. If OSS restoration is requested or in progress, wait for storage restoration and select download again. The page does not automatically poll or finish the download.
4. Save and inspect files in a controlled environment, checking their actual format.

| Source            | Downloaded content                                                       | Restore within the application                                      |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Database datasets | `.ndjson.gz`, with one JSON record per decompressed line                 | Preview/import only for datasets supported by dangerous maintenance |
| AI request logs   | Gzip NDJSON, potentially including saved bodies                          | No maintenance import; download for inspection only                 |
| Server log files  | Gzip log files; already compressed files retain their compressed content | Cannot be imported as database records                              |

There is no full-text archive search in the application. Ordinary private OSS object URLs may deny access; use the page's temporary signed link. It lasts **300 seconds**; request another download when it expires. Revoking application access cannot retroactively cancel an already delivered signed link. Do not forward it. OSS restoration already requested is likewise not automatically withdrawn by later permission revocation.

An expiry time does not guarantee immediate physical deletion. With IAM enforcement, expired/deleted artifacts or artifacts linked to an invalid run are denied download even if still listed.

## Import historical records

Use **Dangerous data maintenance** for the seven datasets above other than AI request logs and server log files. Imports write historical records to the selected dataset; they do not restore the entire system or replay business operations such as charging.

1. Select the dataset matching the file contents and a `.ndjson.gz` file. An extension alone does not prove its format.
2. Preview the import, complete verification, and inspect total, new, duplicate, invalid, and missing-reference counts plus errors.
3. Correct invalid records or missing references and preview again. Duplicates are skipped without overwriting existing records. Preview counts are not execution results.
4. Confirm that the dataset and file still match the preview. Start the import, enter `IMPORT`, and complete verification.
5. Inspect maintenance history for queue/execution status and actual inserted, skipped, and failed counts. A task-created message does not mean import has completed.

The default compressed upload limit is 100 MiB, subject to deployment configuration. Decompressed content is limited to 512 MiB, each line to 2 MiB, and the archive to 2,000,000 records. For larger files, split valid records into compliant gzip NDJSON files in a controlled environment and preview each separately.

Relay usage requires existing relay tokens and any logical requests referenced by the records. Monthly pass usage requires the corresponding user monthly pass. Missing references block import. Validation runs both when creating the task and during execution, so an earlier successful preview does not guarantee later success.

Imports write batches; a later failure does not undo already inserted batches. Check actual results before retrying; existing records are treated as duplicates. Import staging uses immediately readable storage. Cleanup is attempted when a task finishes or creation fails, but unavailable storage can leave temporary objects for administrators to handle. This does not automatically delete the original archive.

## Optimize tables

After archival deletes database records, their space can remain available for database reuse without immediately shrinking table files on disk. To reclaim space, evaluate **Optimize tables** in dangerous maintenance during an off-peak window:

1. Select supported tables and preview the impact. Inspect table names, record counts, and data/index sizes.
2. Preview again if the selection changes; the preview does not lock the execution scope.
3. Start optimization, enter `OPTIMIZE`, and complete verification.
4. Inspect maintenance history and wait for the queued task's result.

Optimization can lock tables or consume substantial resources. It is a separate operation, not an automatic step after every archive. This page does not support optimizing AI request log or server log datasets. Server log archival instead removes corresponding local files after verification.

## Configure lifecycle IAM permissions

With IAM enforcement, the operator's actual platform global user group must provide lifecycle management eligibility. Account ownership, added permissions, private account groups, and wildcard policies alone do not replace this eligibility. Reading, previews, changes, execution, and downloads are separate grants.

All actions below use the prefix `quyan:system:data_lifecycle:`. All resources use `acs:platform:*:platform:`.

| Action suffix                   | Resource suffix                                                                   | Purpose                                                       |
| ------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `ListPolicies`                  | `lifecycle-dataset/<dataset>`                                                     | List authorized policies and candidate counts                 |
| `PreviewPolicy`                 | `lifecycle-dataset/<dataset>`                                                     | Read candidate summary previews, including batch confirmation |
| `ListCandidates`                | `lifecycle-dataset/<dataset>`                                                     | Page through candidate summaries                              |
| `UpdatePolicy`                  | `lifecycle-dataset/<dataset>`                                                     | Change enabled state and hot retention                        |
| `RunPolicy`                     | `lifecycle-dataset/<dataset>`                                                     | Archive one dataset                                           |
| `RunBatch`                      | Each target's `lifecycle-dataset/<dataset>`                                       | Batch archival, separate from single-run permission           |
| `GetSchedule`, `UpdateSchedule` | `lifecycle-schedule/default`                                                      | Read and save the schedule separately                         |
| `ListRuns`                      | `lifecycle-run/<runId>`                                                           | View run history                                              |
| `ListArtifacts`                 | Both parent `lifecycle-run/<runId>` and `lifecycle-artifact/<runId>/<artifactId>` | List artifacts                                                |
| `DownloadArtifact`              | `lifecycle-artifact/<runId>/<artifactId>`                                         | Separately authorize downloads                                |

Lists filter before pagination; totals contain visible resources only. A run's artifact count includes authorized files only and can be zero without artifact-list access. It does not prove that no archive exists.

Batch runs authorize every target before processing; any denial prevents startup. Authorization and policy versions are rechecked during processing. Revocation can stop further work but cannot undo completed uploads or deletions. IAM enforcement also checks database rows against the export snapshot and authorization inside the deletion transaction, and checks access and file contents before deleting server logs.

Revocation or resource changes during saves, reads, or download signing can cause failure. Policies allow only enabled-state and hot-retention changes; schedule state and time save together. After conflicts, refresh to confirm server state before retrying the required operation.

## Configure maintenance IAM permissions

Dangerous maintenance requires separate platform global group maintenance eligibility, not lifecycle eligibility. Actions use `quyan:system:data_maintenance:` and resources use `acs:platform:*:platform:`.

| Action suffix       | Resource suffix                               | Purpose                     |
| ------------------- | --------------------------------------------- | --------------------------- |
| `PreviewOptimize`   | Each selected `maintenance-dataset/<dataset>` | Preview table optimization  |
| `CreateOptimizeRun` | Each selected `maintenance-dataset/<dataset>` | Create an optimization task |
| `PreviewImport`     | `maintenance-dataset/<dataset>`               | Validate an import preview  |
| `CreateImportRun`   | `maintenance-dataset/<dataset>`               | Create an import task       |
| `ListRuns`          | `maintenance-run/<runId>`                     | List maintenance history    |
| `GetRun`            | `maintenance-run/<runId>`                     | Independently read details  |

Preview and history permissions do not grant execution. Multi-table operations require authorization for every target. Identity or authorization changes during creation can prevent enqueueing. Imports are queued only after file and staged-upload verification. Task results do not expose private staging object keys.

## Troubleshooting

| Symptom                                                | Suggested action                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Candidate count did not change after editing retention | Confirm save success and refresh; statistics do not update continuously                                                             |
| A disabled policy can still run manually               | Disabled controls scheduling and unspecified-dataset batch selection; explicitly selected datasets can run manually                 |
| Archive failed or request timed out                    | Inspect run counts and errors. Some batches may have completed; do not assume all data was retained or deleted                      |
| Run exists with zero artifacts                         | There may be no candidates or no artifact-list permission; check run counts and IAM access separately                               |
| Artifact list failed to load                           | Use the drawer's reload control and check parent-run and artifact-list access; a failed load does not mean no files exist           |
| Download restoration is pending or link expired        | Wait, then select download again, or request a new signed link; do not keep reusing an old URL                                      |
| Disk space remains after hot deletion                  | The database may retain reusable space; evaluate off-peak optimization for supported tables                                         |
| Import remains queued or fails                         | Check maintenance history, backend scheduling, staging storage, and related records. Task creation does not prove execution success |

## Related pages

- [AI request logs]({{DOCS_BASE_URL}}/en/ai-request-logs)
