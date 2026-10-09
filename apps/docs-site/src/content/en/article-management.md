# Article management

Use this page to maintain site articles and knowledge content.

## Page purpose

- Create and edit articles.
- Control publish state.
- Set a default article.
- Maintain ordering and categories.

## What you will see

### Article list

- Title, slug, and category.
- Published/default markers.
- Reorder affordances.

### Edit actions

- Create article.
- Edit article.
- Publish or unpublish.
- Set or clear default.
- Delete article.

## Common actions

1. Create an article with title, slug, category, and content.
2. Write Markdown in the editor.
3. Preview before publishing.
4. Set the default article when it should appear first on the reading page.
5. Adjust order when navigation priority changes.

## Permission requirements

| Action                             | Required permission |
| ---------------------------------- | ------------------- |
| View articles                      | `ARTICLE_READ`      |
| Create article                     | `ARTICLE_CREATE`    |
| Update, reorder, set/clear default | `ARTICLE_UPDATE`    |
| Delete article                     | `ARTICLE_DELETE`    |
| Publish / unpublish                | `ARTICLE_PUBLISH`   |

## Creation and account scope

In IAM enforce mode, article creation uses `quyan:article:Create` on the trusted current account, `acs:quyan:*:<accountId>:account`. An article ID does not exist before creation: a grant for an existing article ARN does not grant creation, and resource or resource-group authorizations do not automatically expand into account creation permission.

```json
{
  "Version": "1",
  "Statement": {
    "Effect": "Allow",
    "Action": "quyan:article:Create",
    "Resource": "acs:quyan:*:account-id:account"
  }
}
```

Replace the account ID with your actual account. The author is always the executing user, including AccessKey and role-session requests. A role session uses role grants, not the caller's own creation permission. Only title, slug, category, summary, content, public visibility and access requirements are accepted. New articles always start as drafts; creation cannot select the site default or override managed status or counters. Creation does not grant subsequent editing, deletion, publishing or default-article management.

Slugs are globally unique, including inactive articles. A public article cannot have a nonempty permission requirement. Persistence rechecks active authorship and account ownership: changed identities are denied, while database concurrency conflicts require refreshing and retrying. Legacy/shadow modes retain their previous creation permission checks, with the same input isolation and draft defaults.

## Resource-scoped publishing

In IAM enforce mode, publishing and retracting use the same sensitive native Action, `quyan:article:Publish`, on an exact article resource:

`acs:article:*:<accountId>:article/<articleId>`

A grant can target articles by other authors within your account, or use a resource-group scope. Another account's articles, inactive articles/authors/accounts, and noncanonical IDs are rejected even with a wildcard policy. Explicit Deny overrides Allow. Group membership removal applies to the next request.

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "quyan:article:Publish",
      "Resource": "acs:article:*:account-id:article/article-id"
    }
  ]
}
```

Replace the placeholders with your account and article identifiers. An explicit account ARN alone is not an article grant. Historical `ARTICLE_PUBLISH` permissions retain their account-wide compatibility scope; legacy/shadow rollout modes still enforce the historical permission check.

Publishing can make already-public articles accessible anonymously. Check content, public visibility and access restrictions before confirming. The publish response contains the existing full article DTO, including content. The server rechecks active ownership and the authorized publication snapshot before writing; if state or visibility changed, reload and authorize again. This grant does not authorize creating/editing/deleting articles or changing the site-wide default. Article listing/menu visibility still uses its separate permissions during migration; public reading is unchanged.

## Resource-scoped editing and deletion

In enforce mode, `quyan:article:Update` and `quyan:article:Delete` independently authorize the same concrete article ARN. A policy can delegate an exact same-account peer article, or restrict it to a resource group. The server checks current article/author/account availability and rechecks the authorized snapshot in the write transaction. Cross-account resources, identity aliases, explicit Deny, missing policies and stale targets fail closed.

Editing does not grant publication, deletion or site-default management. The edit response includes the full article DTO. Only title, slug, category, summary, content, public visibility and access requirement are editable: a request cannot replace the author, change publication state/default selection, or overwrite status/counters. Making an already-published article public can expose its contents anonymously; clear any permission requirement explicitly in the same edit. Slugs remain site-wide unique, including inactive articles.

Deletion marks the selected article unavailable; it neither deletes another article nor clears other articles' default flags. The deleted article immediately stops being eligible for resource-group grants. Legacy/shadow modes retain historical permissions and author-only editing/deletion; resource-scoped delegation is enforced after switching to enforce. List/menu permissions remain separate while migration continues.

Migration does not automatically widen editing/deletion. `ARTICLE_UPDATE`/`ARTICLE_DELETE` from user additions, groups, legacy bindings or historical backfilled versions remain limited to the executing user’s authored articles in enforce mode. Legacy role and AssumeRole grants use that same executing-user boundary. To manage another same-account author’s article, an authorized delegator must explicitly publish a resource-scoped JSON policy; legacy removals remain global explicit Deny. Historical reorder and publication were not author-only and keep their own scopes. Legacy author authority alone cannot publish or delegate an unconditioned article-management grant.

## Atomic resource-scoped reordering

In enforce mode, reordering requires `quyan:article:ReorderArticles` on **every** requested article. The server resolves all stored article identities within your account, evaluates the full batch, rechecks every authorized snapshot, then writes all ordering changes in one transaction. A denied, missing, inactive, foreign-account or changed member rejects the whole operation; a later database failure rolls back earlier writes.

Submit each article ID only once and provide a nonnegative integer order within the database integer range. A request is bounded by the server IAM batch limit (currently 500 resources). Resource-group membership and trusted request Conditions apply separately to every member. Editing-only JSON grants do not authorize this separate Action; existing policy drafts that used `quyan:article:Update` for sorting must explicitly add `quyan:article:ReorderArticles`. Historical `ARTICLE_UPDATE` fields still map to both capabilities during migration. Reorder changes only ordering, not author, content, visibility, publication or default selection. It retains the historical edit permission in legacy/shadow mode; listing and site-wide default management remain separate concerns.

## Notes

- The reading-side page is usually `home-articles`.
- Before publishing, review heading hierarchy and important links.
- The default article can affect what users see first.

## Related pages

- `home-articles`
- `legal-policy-management`
