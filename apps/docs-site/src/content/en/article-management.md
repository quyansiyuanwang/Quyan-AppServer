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

## Notes

- The reading-side page is usually `home-articles`.
- Before publishing, review heading hierarchy and important links.
- The default article can affect what users see first.

## Related pages

- `home-articles`
- `legal-policy-management`
