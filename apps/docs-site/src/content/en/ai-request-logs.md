# AI Request Logs

Investigate AI inference requests by user, token, model, request ID, execution outcome, content and time range. The default window is the last 24 hours, with shortcuts and a custom range available.

## Requirements

- Requires `relay:ai_request_log:read`. This is granted to super administrators by default, not automatically to system administrators.
- Viewing upstream attempts or searching attempt errors also requires `relay:request_diagnostics:read`. Channel, route and pool topology remain subject to their existing permissions on the request diagnostics page.
- Logs can contain full prompts, tool arguments and model output. Limit access to staff responsible for content safety and incident investigation.

## Search and filters

The main search matches request IDs, user/token names or IDs, models, error summaries and saved content. Advanced filters include format, HTTP status, execution outcome, streaming, failure stage, content completeness, IP and duration ranges. Results are paginated on the server, without downloading every body for filtering.

Identity comes from server-side token recognition, never a user identifier in the request body. Unnamed tokens show their ID. Previously unrecorded identities remain marked as not recorded and are not automatically backfilled.

## Read details on demand

Details first display identity and execution metadata, with **Analysis and formatting** selected by default. Content is organized into system instructions, messages, tool definitions, parameters, output, usage and errors. Tools are collapsed by default and expanded content is read in segments. **Raw content**, the second tab, shows the saved sanitized representation, not necessarily the original upstream bytes.

Request and response bodies load separately. Only the first segment loads by default: 20 analysis items per page or up to 32 KiB of raw text per segment. Long text and individual tool definitions are also bounded, and only visible content is rendered.

**Load all saved content** is off by default and applies only to the current view. Enabling it loads in batches with progress. Disabling it, switching views or leaving details stops further loading. It does not change storage limits or restore omitted/truncated data. Copying the current segment and copying all loaded content are separate actions.

Detail search covers all saved content within the selected scope, not just loaded segments. Matches are paginated and locate the corresponding field or nearby stream event. Search is literal text, not a regular expression.

## Failures and recording limits

Streaming and non-streaming inference both capture recognized identity. HTTP status and execution outcome are separate: an HTTP 200 request can still fail due to stream interruption or settlement after the response ends.

- Includes authentication rejection, body parsing/size rejection, quota/routing issues, upstream errors, timeouts, content safety rejection, interruptions and settlement failures.
- Unknown identities, unsafe-to-parse bodies and size rejections retain only safe metadata, not these request bodies.
- Attempts display status, stage, duration and sanitized error text on demand. Errors are limited to 16 KiB per attempt and 64 KiB combined, with truncation indicated.
- Requests retain up to 1 MiB and responses up to 2 MiB. Larger payloads keep their original size, truncation flags and previews.
- Images, files and other binary data retain only type/size metadata. Password, token and key fields are masked; authentication headers are not written to AI logs.
- New fields apply to newly captured records. Information that cannot be established for older records is shown as not recorded. Model-list and quota queries are not inference logs.

## Retention and archive

Hot storage defaults to 90 days and can be adjusted in Data Archive. Older records are archived to OSS; AI request log archives do not automatically expire.

This page searches hot storage only. For older investigations, download the gzip NDJSON artifact from the corresponding archive run. Uploaded artifacts are verified before hot data is deleted.
