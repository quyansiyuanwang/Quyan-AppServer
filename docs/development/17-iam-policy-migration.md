# IAM policy migration: implemented foundation and rollout gates

## Current implementation

Identity policies accept only Version "1", Statement, Sid, Effect, Action, Resource, and optional typed Condition. Unknown fields are rejected. Matching is case-sensitive and only \* is special. Explicit Deny overrides all Allow statements; absent Allow means deny. Shared contracts and the legacy Permission mapping are authoritative. Version history is immutable through the supported repositories and management APIs, with current-document hash conflict checks and a default pointer. The version GET endpoint returns a server-paginated envelope (items/total/page/pageSize/defaultVersionId/defaultDocumentHash); default page size is 20, capped at 100. Restore looks up the selected version directly and uses the current-default hash returned by the history snapshot. The RAM UI provides JSON previews and confirmed restore, without automatic conflict retries.

IAM document writes/bindings require enforce mode and an account owner with the relevant endpoint permission. Subusers cannot delegate documents. This is a first-release privileged delegation boundary, not a general wildcard subset proof. Explicit IAM middleware always enforces IAM. Legacy decorators use legacy/shadow/enforce, defaulting to legacy. No decision cache is enabled: live data is read for each evaluation to avoid stale revocation. Audit fields hash resources and exclude documents, tokens, and secrets.

Do not treat enabling enforce as complete JWT route coverage. Unmigrated self-service endpoints and resource-sensitive services still require explicit action metadata, row filtering, per-item batch checks, and ownership validation. Production action validation rejects unimplemented actions, including external cloud examples; a wildcard must match at least one platform Action. External DNS examples live only in docs/examples/iam and test fixtures. The unused DNS resolver was removed. Existing documents containing external actions fail closed and must be replaced with valid platform policies before enabling enforce.

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
- Finish the visual policy builder, resource/condition pickers, authorization/resource-group UI and AI draft flow. JSON diagnostics, Schema export, versions and simulation UI already exist.
- Extend independently tested conservative delegation proofs to remaining IAM control-plane mutations; trust publication already checks scoped role grants. Scoped authorization grants must retain their scope during proofs.
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

## Structured catalog

Shared Action definitions include service, access level, sensitivity, supported resource type identifiers and legacy/declared migration stage. The old flat catalog is derived from these definitions. API route links are generated from the import-aware Controller inventory during OpenAPI generation, not copied by hand. Catalog APIs expose only actions with actual declared endpoints; compatibility entries remain in the flat catalog to preserve migration behavior. Resource templates do not assert endpoint ownership or row filtering.

## Condition evaluation

Shared operator/key catalogs drive validation and the read API. Request context uses authentication, server time and Express trusted-proxy resolution, never a client body context. Conditions normalize deterministically; unconditional document hashes remain unchanged. Matching conditional statements with unavailable attributes deny the whole evaluation unless Null explicitly tests absence. Resource/MFA condition providers are unavailable and rejected, not silently ignored. The current user-principal simulator supplies only principal/time context and reports missing-condition-context for request-specific attributes.

## Scoped authorizations and resource groups

RamAuthorization is the identity-policy binding source for new grants; account-scoped grants project into RamPolicyAttachment in the same transaction. Legacy attachment reads remain available for historical rows; duplicate account projections are suppressed only after all loaded rows pass integrity validation. Distinct scope grants for the same policy are never collapsed by policy ID.

Scope is evaluated with AND before a statement can match. Resource-group members must be real active current-account resources; every authorization read rechecks ownership. Member additions re-prove resulting grants. Group binding and membership transactions serialize using a shared optimistic group revision; stale policy version/hash proofs cannot commit an authorization. No decision cache is used, so changes take effect on the next policy read.

The new API uses dedicated native IAM actions, not expanded legacy permissions. Lists are account-scoped and bounded (default 50, max 100), then filtered per row for HTTP callers with trusted request conditions. No unfiltered total is returned. Management audit records identifiers and resource hashes; decision audit includes matched authorization IDs. Historical attachments have a separate idempotent backfill command below. Installing the code supplies dual-write/read compatibility; each deployment still needs its own reviewed account-scoped apply run.

## Historical attachment backfill

Run from the repository root:

    pnpm --filter @quyan/backend run iam:backfill-authorizations
    pnpm --filter @quyan/backend run iam:backfill-authorizations -- --account-owner-id <ACCOUNT_OWNER_ID>
    pnpm --filter @quyan/backend run iam:backfill-authorizations -- --apply --account-owner-id <ACCOUNT_OWNER_ID>

Dry-run is the default and makes no writes. Apply requires an explicit account; there is no global apply mode. Reports contain only binding/policy/account identifiers, hashes and closed diagnostic reasons. Invalid or changed sources produce a nonzero exit code. Unknown principal types, missing targets, foreign-account ownership and corrupt versions are not migrated. Inactive principals remain on the compatibility path until restored and re-scanned.

Every account authorization is created under a serializable transaction after rereading the original binding, target ownership, policy version and canonical document hash. Source drift or revocation refuses the conversion. The old attachment remains active, account scope creates no new resource breadth, and repeated runs skip already verified projections. User/group/role targets are supported; resource-scoped relations are never projected back to account scope. Do not delete legacy columns or attachments during the rollout window.

Validation for this tool:

    pnpm --filter @quyan/backend test -- --project backend-unit tests/unit/iam/legacy-authorization-backfill.unit.test.ts
    node --env-file=.env.test ./tests/scripts/run-vitest.mjs run --project backend-database tests/database/permissions/iam-authorization-backfill.db.test.ts

The database command runs from apps/backend in isolated test databases; no account identifiers or credentials should be copied into production defaults.

## Role trust and session identity

Trust documents use a separate strict Principal schema, parser and JSON Schema (policyKind=trust), never the identity parser. This release supports exact current-account RAM user ARNs only. Principal/service wildcards, cross-account trusts and role chaining fail validation/admission. Native UpdateRoleTrustPolicy is independent of the legacy role-update permission. The dedicated PUT roles/{roleId}/trust-policy endpoint and legacy trustPolicy fields use the same publication validation, target lookup and delegation proof.

Enforce-mode assumption requires identity and trust Allow on the concrete role ARN. Both runtime and simulation use the same identity/trust intersection helper. Policy-loading or malformed trust failures close authorization. Role update/issue transactions compare the evaluated role revision; stale document hashes or revisions return 409 and cannot issue a token. Audit carries identifiers, not tokens or JSON. Legacy/shadow admission retains bound-role/owner compatibility; valid trust must be prepared before deployment enforcement.

An assumed-role session is a distinct authorization identity: load only that role's policies and scoped authorizations, not caller user/group grants, removals or other assigned roles. Account ownership, subject, role, status, revocation and expiry remain mandatory. Issued sessions are not reevaluated against trust on every business request; trust updates govern future issuance, and explicit revocation terminates existing sessions. Ordinary users still combine their legacy direct/group/assigned-role sources. Review this intentional identity-isolation change in shadow data, including historical group Deny cases, before rollout.

Role trust JSON currently has optimistic hashes and mutation audit; an immutable trust-history UI is not implemented. The existing identity-policy version API remains immutable. Service/resource principals, session policies, permission boundaries, resource-group/tag conditions and conservative NotAction support remain separate extensions and must not be silently accepted.

## Concrete control-plane target migration

User update/delete, role delete, session revoke and policy update/delete/versions use named concrete resolvers. Binding requests evaluate both entities with ALL batch semantics. Default-version changes evaluate the policy plus exact version ARN. User group assignment requires group resource access and subset proof for direct, scoped and role-derived group grants. Services retain database ownership and account-recovery checks.

Legacy permission conversion now derives account-contained resource templates from the action catalog to preserve historical target breadth. This does not reinterpret user-authored IAM account statements or mutate immutable versions. Review and publish replacement versions for earlier backfilled account-only documents when needed; a changed backfill hash is a review failure, not automatic widening.
