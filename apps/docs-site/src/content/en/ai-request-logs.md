# AI request logs

The AI request logs page searches authenticated AI inference requests by user, token, model, request ID, status code, content keyword, and time range.

## Requirements

- The reader needs the `relay:ai_request_log:read` permission. It is granted to the super administrator by default; system administrators do not receive it automatically.
- Results may contain complete user prompts, tool arguments, and model responses. Restrict access to content-safety or incident-investigation staff.

## Recorded scope and limits

- The page covers OpenAI, Anthropic, Gemini, and image inference endpoints. One record represents the final outcome of one logical client request after any channel failover.
- Requests are stored up to 1MB and responses up to 2MB. Larger content keeps its original size, a truncation flag, and a preview.
- Images, files, and other binary content retain only type and size metadata. JSON remains structured, while streaming responses are stored as text.
- Sensitive fields such as passwords, tokens, and secrets are masked. Authentication headers are never stored.

## Retention and archives

Hot data is retained for 90 days by default. Administrators can change the hot retention period on the Data Archive page. Records past that period are archived to OSS, and AI request log archives never expire automatically.

Archived records are not searchable on this page. To investigate older activity, download the relevant gzip NDJSON artifact from Data Archive. Hot records are deleted only after archive upload verification succeeds.
