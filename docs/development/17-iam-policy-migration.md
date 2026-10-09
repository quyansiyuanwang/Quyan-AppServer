# IAM policy migration: implemented foundation and rollout gates

## Current implementation

Identity policies accept Version "1", Statement, Sid, Effect, exactly one of Action/NotAction, Resource, and optional typed Condition. Principal is reserved for the separate trust-policy parser. NotAction compiles to the finite set of compatible currently registered Actions before normalization, hashing and persistence; future catalog additions never widen a saved version. Unknown fields and unsupported semantics are rejected. Matching is case-sensitive and only \* is special. Explicit Deny overrides all Allow statements; absent Allow means deny. Shared contracts and the legacy Permission mapping are authoritative. Version history is immutable through the supported repositories and management APIs, with current-document hash conflict checks and a default pointer. The version GET endpoint returns a server-paginated envelope (items/total/page/pageSize/defaultVersionId/defaultDocumentHash); default page size is 20, capped at 100. Restore looks up the selected version directly and uses the current-default hash returned by the history snapshot. The RAM UI provides JSON previews and confirmed restore, without automatic conflict retries.

IAM document writes/bindings require enforce mode, the relevant management Action and conservative delegation proof. A same-account subuser can publish or bind only grants proven covered by its effective authority, retaining resource/authorization scopes and conditions. Unprovable wildcard overlap or a conflicting Deny prevents delegation; the algorithm intentionally rejects uncertain cases rather than claiming a complete symbolic proof. Account-owner recovery remains separately protected. Explicit IAM middleware always enforces IAM. Legacy decorators use legacy/shadow/enforce, defaulting to legacy. No decision cache is enabled: live data is read for each evaluation to avoid stale revocation. Audit fields hash resources and exclude documents, tokens, and secrets.

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

Each plan compares the catalog-derived, account-contained resource decisions for every legacy Permission against the original grant set. Unknown or malformed legacy entries invalidate the entire policy instead of being filtered away. Apply rereads data and checks the exact JSON source snapshot, account, policy kind, active status, and default-pointer state in a transaction before allocating version 1. Concurrent edits/revocation or another migration return source-changed rather than overwrite newer data. Legacy fields remain unchanged for configuration rollback; hash checks and immutable version records allow subsequent policy audits.

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
- Verify resource-scoped permission display and navigation for each migrated business domain. Visual/JSON editing, resource templates, supported-condition builders, scoped authorization/resource-group management, draft-only AI assistance, JSON diagnostics, Schema export, versions and simulation are implemented; their presence does not prove all business endpoints are migrated.
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

The RAM controller declares static Catalog actions with account, collection, concrete-target and batch resolvers on migrated management endpoints, including both create/update alternatives on document validation. User/group/role/policy mutations and paginated reads retain target ownership, delegation, replay and 2FA guards. Route metadata never replaces the service ownership checks, row filtering or ALL batch proof; each business migration has its own denial and parity tests. The simulate endpoint retains its dedicated always-enforced action.

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

Role trust JSON currently has optimistic hashes and mutation audit; an immutable trust-history UI is not implemented. The existing identity-policy version API remains immutable. Service/resource principals, session policies, permission boundaries and resource-group/tag condition providers remain separate extensions and must not be silently accepted. Conservative identity NotAction support is implemented as a finite persisted Action snapshot.

## Concrete control-plane target migration

User update/delete, role delete, session revoke and policy update/delete/versions use named concrete resolvers. Binding requests evaluate both entities with ALL batch semantics. Default-version changes evaluate the policy plus exact version ARN. User group assignment requires group resource access and subset proof for direct, scoped and role-derived group grants. Services retain database ownership and account-recovery checks.

Legacy permission conversion now derives account-contained resource templates from the action catalog to preserve historical target breadth. This does not reinterpret user-authored IAM account statements or mutate immutable versions. Review and publish replacement versions for earlier backfilled account-only documents when needed; a changed backfill hash is a review failure, not automatic widening.

## Developer project management migration

The JWT project management service is separate from public, scheduler and project-key paths. Core routes declare real Catalog actions, a trusted user creation target and concrete developer/project resources. Enforce resolves the stored project's active same-account owner before forwarding existing repository operations; it does not reinterpret the acting principal as the owner.

Collection middleware validates identity, current sessions, policy data and the named collection boundary. It does not manufacture a collection-wide Allow. The management service performs account-isolated candidate pagination and ListProjects evaluation for every returned project; empty filtered pages may have hasNext, with no unfiltered total. The old array endpoint returns the enforce default first page. Shadow compares old individually owned rows and leaves legacy ownership enforcement intact.

## Developer KV and Secret management migration

JWT item routes declare per-operation Actions and named KV/alias resolvers. The canonical developer/kv-item identifier has two segments: project ID and the UTF-8 base64url key without padding. Secret uses project ID and its validated uppercase alias. Resource builders reuse the domain schemas and reject noncanonical inputs; request account fields never override the authenticated owner. Responses expose optional resourceArn metadata for policy authoring.

Enforce checks an active same-account project and its stored owner, then authorizes the exact item ARN before forwarding writes. GetKv uses a read-only query: expired keys return 404 without implicit deletion. Lists paginate metadata-only candidates before item evaluation; project List grants do not manufacture child Allow. The KV page route is /kv/entries/page so /kv/page remains a valid key. Resource groups verify canonical key encoding, live item/project/owner status and account ownership on each policy load. Removal and expiration therefore change scope on the next request. Product-instance/project-key/public paths retain their separate credential boundaries.

## Short Link management migration

Short Link resource identifiers contain project ID and stored link ID, independent of public short codes. Creation authorizes the existing project ARN; every other operation uses a registered short-link resource. GetShortLinkStats is a sensitive Read Action and does not follow from ListShortLinks. Lists use active account-isolated candidates and the shared item page evaluator. Resource-group membership requires an active link, its matching project and its active same-account owner.

Enforce updates/deletes/stats retain active row, project and owner filters in the repository, including the mutation query after outbound URL validation. Paused/expired links remain manageable; disabled rows do not. Existing product-instance, project-key and public redirect paths keep their own credential guards. The public Short Link documentation now describes the visitor IP fields actually returned by analytics.

## Project API key metadata and revocation migration

Project API key ARNs use project ID and credential record ID. ListProjectApiKeys and RevokeProjectApiKey are sensitive declared Actions. The enforce page reads only metadata columns and filters each concrete ARN; no raw key, keyHash or legacyKeyHash enters its candidate projection or page schema. Expired keys can still be inspected/revoked, while status-inactive keys are excluded. Enforce revoke constrains key ID, project ID, status and active stored owner in the mutation query. Resource-group scope checks the same live ownership; revoked members stop contributing grants on the next load.

Key issuance remains an independent migration item: its fixed project-key scopes require delegation proof and a credential-lifetime authority design before same-account issuance can be delegated. The metadata/revocation change does not register an issuance Action or widen existing issuance ownership checks.

## Database identity and IAM case matching

MySQL resource identifier columns currently use case-insensitive collation, while IAM wildcard matching is case-sensitive. Enforce requires the request project/item identifier to equal its stored value before evaluating the resource. KV reads compare returned keys, and KV writes/deletes recheck the stored key in a serializable transaction, rejecting collation aliases instead of creating a second IAM identity. Group membership compares stored project/item identifiers too. This avoids changing database collation or widening valid resource grammar during the rollout.

## Status Monitor management migration

JWT monitor management uses a concrete developer/status-monitor ARN with project ID and stored monitor ID. CreateStatusMonitor authorizes the parent project; ListStatusMonitors evaluates active same-account candidates individually. UpdateStatusMonitor, DeleteStatusMonitor and CheckStatusMonitor are distinct sensitive Write Actions. Listing/configuration writes do not authorize manual HTTP dispatch. The monitor page returns items/page/pageSize/hasNext with optional resourceArn and no total; legacy array reads use the enforce default first page.

The management service preserves the stored project owner and does not reuse JWT authorization for scheduler/public/product-key entry points. Enforce mutations retain active monitor, project and owner constraints after outbound URL validation. Manual checks recheck exact active identity before each redirect dispatch and constrain result persistence in a transaction; loss of target availability does not create history or send notifications. SSRF, request/response configuration, alert timing and product credential guards remain unchanged. Paused monitors remain manageable; resource-group membership checks exact parent/item IDs and live ownership on every load.

## Project Push Channel management migration

JWT channel routes now declare ListPushChannels, CreatePushChannel, UpdatePushChannel and DeletePushChannel; individual channels use developer/push-channel with canonical project ID and stored channel ID. Create checks the project, while lists paginate active same-account candidates before row evaluation, return resourceArn/hasNext and no total, and expose no internal config. Configuration listing is a sensitive Action because user-supplied endpoints may contain credentials. Resource groups check live canonical channel ownership.

Credential-bearing mutations also authorize UseSecret on the resolved backing-project/alias resource: selection/rebinding, destination changes retaining a reference, and enabling a bound channel. Renaming/disabling needs no Secret-use grant; atomic reference removal drops credential use. Reference lookup selects live metadata only and retains the stored project owner's entitlement boundary. Enforce uses a separate management repository, rechecking exact target IDs, active owners/projects, current snapshot fields (not timestamp alone), instance backing-project identity and active Secret metadata in serializable transactions after URL validation. It never decrypts or changes lastUsedAt during management. Legacy/shadow and product-key/scheduler dispatch paths keep their existing ownership/credential checks. Credential issuance remains a separate migration item; project delivery-record migration is described below.

## Project Push Delivery metadata migration

JWT delivery lists and new detail routes declare ListPushDeliveries/GetPushDelivery on developer/push-delivery (project ID and stored delivery ID). Detail and list grants are independent of each other and channel configuration. The metadata projection excludes title, content, idempotency keys and raw error text before filtering. Candidate SQL checks active delivery/project/owner and a channel belonging to the same project. A batched scalar channel lookup verifies exact stored association IDs without Prisma nested-relation hydration of historical case aliases. Candidate eligibility is checked after offset slicing; malformed rows therefore remain invisible without collapsing hasNext or pulling lookahead rows into the current page. Missing or mismatched masks fail closed. Detail and resource-group checks verify the same exact live association.

Every delivery serializer—including legacy/shadow array and product dispatch responses—now returns only safe failureReason metadata, never historical raw error text. The optional old error field remains deprecated in the wire contract but is not populated. Dispatch failures store a fixed identifier rather than provider exception messages; retry scheduling and quota semantics are unchanged. Enforce supports account-isolated per-record delegation and resource groups; legacy/shadow retain personal ownership. Product-instance principal/action migration and project credential issuance remain separate work.

## Article publication migration

The existing native quyan:article:Publish Action now declares article/article resources and is marked sensitive. Publish and unpublish Controllers declare the same concrete resource resolver through the legacy bridge, preserving permission/rollout compatibility rather than silently adding an external or implicit publication grant. The resolver reads only publication metadata, resolves the persisted author/account and rejects cross-account targets, inactive article/author/owner and case aliases. Resource-group existence uses this same live canonical ownership check.

In enforce, the service independently authorizes the exact stored article with trusted request conditions, then a serializable repository transaction rechecks actor/account availability, author identity, publication state/time, visibility, access restriction and updateTime. The transaction rejects changed snapshots, including same-timestamp security-field changes, and does not rely on timestamp alone. Publish sets publishedAt; retract preserves it. Authorization precedes state errors and content loading. The existing full ArticleDto response and business audit remain; publication implies seeing the response content, not editing or deleting it. Assumed roles use their own policies and active sessions; AccessKey follows the authenticated context. No public-reading or site-default-selection behavior is changed. Site-wide default selection still needs its own global mutation boundary, and article list/create migration remains pending; edit/delete follow below.

## Article edit/delete migration

Concrete Update/Delete Controller metadata now shares the article resolver with publishing. ArticleManagementService/Repository unify the former publication boundary with edit/delete ownership, authorization, audit and serializable snapshot checks. All source/test references use the unified names. The metadata projection additionally includes slug, sortOrder and isDefault so same-timestamp changes cannot bypass the optimistic target check. No content is loaded until the requested write Action is authorized. Enforce permits explicit same-account peer delegation; legacy/shadow retain author-only mutation checks.

Editing is normalized against the existing schema at the service boundary and persistence explicitly whitelists DTO fields; author, publication state/time, managed status, default/counter/order fields cannot be supplied indirectly. The public-access invariant is a shared pure validator, and validation uses the authorized metadata followed by transaction revalidation. Slug uniqueness is checked in the transaction across active/inactive rows and unique-key errors return a closed localized reason without exposing another account. Delete returns only identifiers/title for existing business audit, changes only the selected row's managed status, and immediately removes live group eligibility. ArticleDto and public reading remain unchanged; batch reorder follows below; global defaults still require a separate boundary.

## Article batch reorder migration

Reorder declares quyan:article:ReorderArticles with a named batch resolver, not an account or first-ID check. HTTP validation and internal normalization share the IAM resource capacity, canonical ID grammar, duplicate rejection and database Int sort-order range. Metadata uses one bounded scalar article query and batched canonical author lookup; requested order is preserved without nested relation hydration. The same provider serves single-target mutations and resource-group checks.

The enforce service independently proves its actual argument list with authorizeMany using one current policy load and trusted request context. It audits every decision and refuses denied, incomplete or sparse decision batches before persistence. A serializable repository transaction rechecks all live actor/owner/author relationships and every snapshot before the first write, then updates only sortOrder in deterministic ID order. Any later failure rolls back all writes. Database tests include last-ID denial, request-body/argument mismatch, resource-group revocation, state drift, canonical aliases and a deliberate repository-layer Int overflow proving rollback after an earlier valid write. No public-reading or site-default semantics are changed; legacy/shadow continue enforcing the historical update permission.

### Article edit/delete compatibility parity gate

Permission-level projection and shadow comparison alone cannot prove historical author-guard parity. This gate is now covered by subject-aware runtime conversion and source-matrix regression tests: adds, group permissions, user/group/role bindings, AssumeRole, and historical backfilled attachments/scoped authorizations retain author-only edit/delete authority. Explicit same-account JSON peer grants remain intentional. Publication and native reorder preserve their different historical scopes. Global enforce still requires the remaining route/business guard and recovery acceptance gates.

## Separate native reorder capability

ReorderArticles is a distinct Catalog operation with an explicitly registered ARTICLE_UPDATE migration alias. Canonical legacy edit rights can therefore retain author constraints independently from historical reorder rights. The bridge and AST inventory accept only that shared Catalog relation; unrelated action/permission pairs still fail. Inventories record the actual declared Action, not a phantom canonical editing endpoint. Legacy Allow/Remove conversion expands registered aliases, and backfill parity checks include their concrete resource types. Existing explicit editing-only JSON policies must add ReorderArticles to sort; this is an intentional capability split during the pre-enforce migration, not an implicit expansion of JSON grants. Historical backfilled versions and author scope normalization are addressed by the compatibility implementation below.

## Trusted article resource-owner context

The shared Catalog now registers `quyan:ResourceOwnerId` only for article-resource Actions. Statement validation expands Action patterns for condition-key compatibility. Live authorization, batch evaluation, the legacy middleware bridge and identity-draft simulation share the server resource-context boundary. It removes caller-provided principal/resource attributes, reads metadata-only active canonical article/author ownership, and independently rejects missing/foreign/deleted/case-alias resources without suppressing valid siblings. The all-or-nothing management resolver retains its existing batch behavior and transactions. The subject-aware legacy projection below uses this provider; standalone JSON Conditions and draft simulation use the same boundary.

## Subject-aware legacy article compatibility

Live policy loading projects only legacy-source edit/delete Allow statements with `StringEquals` on the stored article author ID, preserving unrelated account actions and publication/reorder rights. Removals remain global Deny. All consumers of executing-principal policies (authorization, middleware, Permission projection and actor delegation proofs) receive that same restricted document. Group/role membership proof loaders intentionally return a conservative candidate upper bound without inventing an execution subject; these are not executable actor grants. An unknown recipient cannot use this upper bound to pass a proof against author-limited actor authority.

Immutable backfills are identified using default-version `createdBy` provenance, validated canonical hash, retained legacy shadow permissions, and the generated Allow shape. Older versions may contain only canonical Actions/account resources or a subset of subsequently registered templates; their actual JSON and hash are not rewritten. A provenance marker alone cannot authorize extra Actions, wildcard resources, Conditions or changed shadow data. A later explicit JSON default remains explicit even when the legacy shadow is retained; restoring the old default restores subject-bound compatibility. No production migration, cache bypass or enforce switch is performed by this patch.
