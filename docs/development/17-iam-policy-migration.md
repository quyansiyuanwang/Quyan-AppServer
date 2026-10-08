# IAM policy migration: implemented foundation and rollout gates

## Current implementation

Identity policies accept only Version "1", Statement, Sid, Effect, Action, and Resource. Unknown fields are rejected. Matching is case-sensitive and only \* is special. Explicit Deny overrides all Allow statements; absent Allow means deny. Shared contracts and the legacy Permission mapping are authoritative. Version history is immutable through the supported repositories and management APIs, with current-document hash conflict checks and a default pointer.

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

## Rollout gates still outstanding

- Produce an AST-based JWT route inventory and a CI gate for complete server Action/Resource definitions.
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
