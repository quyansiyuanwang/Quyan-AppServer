# IAM policy migration: implemented foundation and rollout gates

## Current implementation

Identity policies accept only Version "1", Statement, Sid, Effect, Action, and Resource. Unknown fields are rejected. Matching is case-sensitive and only \* is special. Explicit Deny overrides all Allow statements; absent Allow means deny. Shared contracts and the legacy Permission mapping are authoritative. Version history is immutable through the supported repositories and management APIs, with current-document hash conflict checks and a default pointer. The version GET endpoint returns a server-paginated envelope (items/total/page/pageSize/defaultVersionId/defaultDocumentHash); default page size is 20, capped at 100. Restore looks up the selected version directly and uses the current-default hash returned by the history snapshot. The RAM UI provides JSON previews and confirmed restore, without automatic conflict retries.

IAM document writes/bindings require enforce mode and an account owner with the relevant endpoint permission. Subusers cannot delegate documents. This is a first-release privileged delegation boundary, not a general wildcard subset proof. Explicit IAM middleware always enforces IAM. Legacy decorators use legacy/shadow/enforce, defaulting to legacy. No decision cache is enabled: live data is read for each evaluation to avoid stale revocation. Audit fields hash resources and exclude documents, tokens, and secrets.

Do not treat enabling enforce as complete JWT route coverage. Unmigrated self-service endpoints and resource-sensitive services still require explicit action metadata, row filtering, per-item batch checks, and ownership validation. DNS actions and resolvers do not create a DNS controller.

## Account-scoped policy backfill

The backfill covers only active custom identity RamPolicy records with legacy format and no default version. Existing attachments are preserved. User additions/removals and group grants remain runtime compatibility sources; this tool does not delete or replace them. System-managed policies and empty grants are reported as skipped; empty grants are not converted into wildcard grants.

Run from the repository root:

Default dry-run (all candidate accounts):

    pnpm --filter @quyan/backend run iam:backfill-policies

Account-scoped dry-run:

    pnpm --filter @quyan/backend run iam:backfill-policies -- --account-owner-id <ACCOUNT_OWNER_ID>

Explicit apply (requires account owner scope):

    pnpm --filter @quyan/backend run iam:backfill-policies -- --apply --account-owner-id <ACCOUNT_OWNER_ID>

The tool never defaults to apply. It emits bounded per-policy events with identifiers, a safe reason, and a canonical document hash, plus scanned/planned/migrated/skipped/invalid/changed counts. It does not print documents or unrecognized raw values. An invalid mapping or changed source causes a nonzero exit code; partial successful conversions are not undone automatically, and reruns skip converted policies. Database failures stop execution without dumping credentials or exception contents.

Each plan compares the generated account-resource decision for every legacy Permission against the original grant set. Unknown or malformed legacy entries invalidate the entire policy instead of being filtered away. Apply rereads data and checks the exact JSON source snapshot, account, policy kind, active status, and default-pointer state in a transaction before allocating version 1. Concurrent edits/revocation or another migration return source-changed rather than overwrite newer data. Legacy fields remain unchanged for configuration rollback; hash checks and immutable version records allow subsequent policy audits.

Apply is an explicit operational migration and bypasses interactive HTTP step-up prompts. Only an authorized operator with scoped database access should run it. Schedule changes to minimize concurrent policy edits and review dry-run errors before apply.

## Route coverage audit

The audit reads TSOA controller globs and resolves actual decorator imports, aliases, class-level security, method overrides, NoSecurity, JWT/local-or-jwt, legacy Permission actions, and explicit IAM action/resource metadata. Output is derived from source, not a manually maintained endpoint registry.

    pnpm --filter @quyan/backend run iam:routes:audit
    pnpm --filter @quyan/backend run iam:routes:audit -- --json
    pnpm --filter @quyan/backend run iam:routes:audit -- --check --base-ref <BASE_COMMIT>
    pnpm --filter @quyan/backend run iam:routes:audit -- --require-complete

The regression gate reads Controllers from the actual base commit using Git and that commit's TSOA globs. New JWT endpoints must have explicit catalog actions, resource kinds and named server resolvers. Existing authorization coverage cannot decrease and JWT protection cannot be removed silently. No stored allowlist or mutable count baseline is used. Deleted routes are omitted; changes in action semantics still require business review. Quality Check fetches commit history and supplies the PR base SHA (or the event base for manual/push runs).

The complete check intentionally fails while any JWT endpoint is missing explicit metadata, including legacy account bridges. Resolver body/ownership semantics, row filtering and batch behavior require runtime tests; passing a syntactic audit is not proof of complete business authorization.

## Rollout gates still outstanding

- Use the AST route audit below to finish every JWT server Action/Resource definition. The PR gate prevents new gaps and regressions; it does not grandfather routes for production enforcement.
- Migrate each resource-sensitive business API, including collection filtering and preflight authorization of every batch item.
- Review shadow differences and administrator bootstrap behavior for actual deployment data.
- Add the frontend JSON editor, action completion, version UI, and simulator UI.
- Implement delegation subset proofs only with explicit semantics and independent tests, not wildcard approximations.
- Consider distributed policy/decision caching only after versioned invalidation and revocation tests exist.

The switch must be deliberate. Never automatically fall back from enforce on missing policies, invalid documents, resource resolution failures, or database/cache errors. Reverting the configuration to legacy does not grant old permissions to JSON-only policies whose legacy arrays were empty.

## Targeted validation

    pnpm --filter @quyan/backend test -- tests/unit/iam tests/database/permissions tests/contract/openapi-schema.contract.test.ts tests/unit/schema/ram-policy.schema.unit.test.ts
    pnpm --filter @quyan/backend type-check

Changes to Controller/DTO/schema additionally require the full OpenAPI generation pipeline and affected frontend type checking. No full test/build/precommit is required for a scoped implementation checkpoint.

## Batch writes and paginated resource reads

Explicit IAM middleware accepts resourceKind "batch" and a named server resolver returning every concrete resource. It rejects an empty, sparse, malformed or over-capacity batch before evaluation (maximum 500 targets). All targets use one policy snapshot; any explicit or implicit Deny blocks the entire downstream handler. Every resolved decision is retained and audited with batch size/index. A partial evaluation response or policy-loading failure cannot authorize a write. Business services still verify target ownership and use transactions for their mutations.

Use accountEntityBatchResourceResolver for validated user/group/role/relay-channel IDs: it constructs each ARN with the authentication account, never a client account value, and rejects the whole list if one ID is unresolved. This factory does not establish database ownership.

List services can pass an already account-scoped database page to IamAuthorizationService.filterAuthorizedPage. It loads policies once, preserves allowed row order, and removes both explicit and implicit denial. Invalid resource resolution fails the page rather than dropping an unresolved row silently. Apply database pagination before this step; do not load an unbounded collection or expose its unfiltered total as an authorized count. These helpers are migration building blocks; existing list/batch business endpoints must be integrated and tested individually.

## RAM endpoint metadata migration

CheckPermission accepts an optional fourth IAM definition (or one definition per declared Permission for ALL/ANY). Its Action must exactly match the shared legacy map. Runtime setup rejects missing mappings and mismatched actions; CI also rejects non-static definitions and unnamed resolvers. Declared resources are evaluated directly, avoiding a second account-only IAM check that would reject a resource-scoped Allow. A batch alternative must allow every target; ANY chooses an entirely allowed alternative, not a different action for each row.

The RAM controller now declares account resource metadata on its legacy-protected endpoints, including both create/update alternatives on document validation. This freezes existing coarse management semantics while providing server-controlled Action and Resource declarations. All old business ownership checks, replay and 2FA guards remain. Single-resource/list filtering migration is a separate business change and must have its own parity tests. The simulate endpoint retains its dedicated always-enforced action.

The fourth-argument path follows IAM_AUTHORIZATION_MODE: legacy uses the old permission result, shadow compares declared resources and records evaluation failures while enforcing legacy, and enforce rejects unresolved resources or unavailable policies. Rollback therefore remains possible for migrated RAM management endpoints; it does not weaken dedicated always-enforced IAM endpoints.
