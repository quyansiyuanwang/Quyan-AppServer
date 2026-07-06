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

## Notes

- The reading-side page is usually `home-articles`.
- Before publishing, review heading hierarchy and important links.
- The default article can affect what users see first.

## Related pages

- `home-articles`
- `legal-policy-management`
