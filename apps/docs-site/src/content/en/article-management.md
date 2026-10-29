# Article management

Use Article Management to create, edit, and publish site articles, adjust reading order, and select a default article. Readers use [Home / Articles]({{DOCS_BASE_URL}}/en/home-articles). Publish legal agreements through [Legal policy management]({{DOCS_BASE_URL}}/en/legal-policy-management).

## Prerequisites and page scope

Open **Article Management** on the management site. Page and operation permissions apply separately: list visibility, content retrieval, editing, publishing, deletion, and reordering are distinct grants. Seeing an article does not grant every operation.

| Task                                    | Page permission identifier |
| --------------------------------------- | -------------------------- |
| Read content                            | `ARTICLE_READ`             |
| Create a draft                          | `ARTICLE_CREATE`           |
| Edit, reorder, set or clear the default | `ARTICLE_UPDATE`           |
| Publish or unpublish                    | `ARTICLE_PUBLISH`          |
| Delete                                  | `ARTICLE_DELETE`           |

Desktop rows show the title, Slug, categories, publication state, author, views, and creation time; a star marks the default. Mobile uses cards. There is no search, pagination, export, or polling. Articles sort by saved order, then newest creation time. Refresh to reload. A failed load may retain the old list, and an empty list may mean no resources are visible.

## Create a draft

1. Select **Create Article** and enter a title, Slug, and Markdown content.
2. Optionally add categories and a summary, and configure public access and required permissions.
3. Check headings, links, and content in **Preview**. Desktop also offers a split preview; mobile uses editor and preview tabs.
4. Select **Confirm** to save. New articles always start as drafts and require a separate publish operation.

| Field                | Requirement or effect                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title                | 1–200 characters after trimming surrounding whitespace                                                                                             |
| Slug                 | 1–200 lowercase letters, digits, underscores, or hyphens; unique across the deployment, including identifiers held by deleted or inactive articles |
| Categories           | Multiple tags saved as a comma-separated value of at most 100 characters in total; does not create a separate category-management directory        |
| Summary              | Up to 500 characters                                                                                                                               |
| Content              | Required on creation; Markdown editor and preview                                                                                                  |
| Public access        | Off by default for new articles; publication is still needed for anonymous reading                                                                 |
| Required permissions | Optional additional reading condition for non-public articles; saved permission field limited to 100 characters                                    |

The current reading check treats the permission field as one complete permission value. Select only one valid permission. Multiple selections do not implement an “any” or “all” match and may make the article unreadable.

The editor has no autosave, version history, or draft recovery. Keep content in another secure location before submitting. Cancelling, closing, or a failed submission may clear the form. After a lost response, refresh and check whether the article was created before creating it again.

## Edit an existing article

1. Select **Edit** on the row or card and wait for the title, content, and access settings to load successfully. Content retrieval has separate requirements; being allowed to list another author's draft does not guarantee that the editor can read it.
2. Edit and preview. Saving a published article updates its current content directly, without creating a separate version awaiting publication. Unpublish first if changes need review before readers see them.
3. Select **Confirm**, refresh, and reopen to check the result.

After a loading failure, the dialog may remain open with an empty form. Close it, resolve the error, and reopen. A failed submission can also reset the form; do not rely on the window retaining your draft. For uncertain outcomes, inspect saved server content before retrying.

Clearing categories, summary, or required permissions omits those empty fields from the save request, so old values may remain. Switching to public access also does not explicitly clear an existing permission requirement and may be rejected. An authorized maintainer must explicitly submit an empty string through the article update API when clearing old conditions, then verify the result. An empty selector does not prove removal. A public article cannot retain a nonempty permission condition.

Changing the Slug breaks links that locate the article by its old Slug; the platform does not automatically redirect the old identifier. Saving does not replace the author or change publication state, the default flag, or view counts.

## Publish, withdraw, and control access

| State                 | Who can read                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Draft                 | No anonymous reading; signed-in content retrieval also has author and permission conditions |
| Published, non-public | Requires sign-in, content-read authorization, and any additional permission condition       |
| Published, public     | Can be read anonymously through public reading endpoints                                    |

Review the content and access scope before selecting **Publish**. It submits immediately without another confirmation. Public articles may then be read by signed-out visitors. Changing an already-published article to public and saving can also immediately widen access without publishing again.

**Unpublish** immediately returns the article to draft. It does not delete content, reset views, clear the default flag, or retract copies readers already made. Publishing again updates the publication time. If the default flag remains and another default selection has not replaced it, the article may appear as the default again. Publishing and unpublishing use the same permission without granting editing or deletion.

## Set the default article

1. Select **Set Default** on a published article. It submits immediately and clears other active articles' default flags.
2. To remove the selection, use **Clear Default** on the starred article. This clears the deployment's active default selection without deleting or unpublishing content.
3. Check the reader page both signed in and signed out. When the default article is unavailable to the reader, the page tries the first listed article without relaxing access requirements.

The default applies to the entire deployment, rather than one selection per user or account. Confirm its effect on other readers. Setting it uses the update action on the target article; clearing it uses the update action on an account resource. These are different grant scopes, so resource-specific editing does not guarantee permission to clear the site default.

## Reorder and delete articles

On desktop, drag the handle on the left of the list. Releasing it submits automatically without a separate save. Mobile has no drag-reordering entry. Every submission includes all articles in the current list and requires reorder permission on each; permission on only the moved article may be insufficient.

In IAM enforce mode, the entire reorder succeeds or fails together, with at most 500 articles per request. This interface cannot reorder the complete list when it exceeds that limit. A failure attempts to reload the list. If reloading also fails, the displayed order may still be unsaved; confirm after a successful refresh. Reordering does not change content, authors, access, publication, or the default selection.

Deletion requires confirmation and removes the article from available lists and reading endpoints. The console has no restore operation. Deletion does not release its Slug, delete other articles, or clear their default flags. Save a copy first if needed; unpublish when you only need to stop reading temporarily.

Views count content reads, including repeat visits and editor loading. Asynchronous updates may be delayed or fail. This is not a unique-visitor, complete-reading, or read-confirmation count, and the management list does not continually refresh it.

## IAM resource authorization reference

IAM enforce mode supports management of specific resources within one account. Article ARNs use `acs:article:*:<accountId>:article/<articleId>`. Creation and clearing the default use `acs:quyan:*:<accountId>:account`. Use actual account and article IDs; an account ARN cannot substitute for a specific article grant.

| Operation                | Action                          | Resource                                                   |
| ------------------------ | ------------------------------- | ---------------------------------------------------------- |
| List management metadata | `quyan:article:ListArticles`    | Each visible article                                       |
| Read content             | `quyan:article:Read`            | Target article, also subject to content-reading conditions |
| Create a draft           | `quyan:article:Create`          | Current account                                            |
| Edit or set the default  | `quyan:article:Update`          | Target article                                             |
| Clear the default        | `quyan:article:Update`          | Current account                                            |
| Publish or unpublish     | `quyan:article:Publish`         | Target article                                             |
| Delete                   | `quyan:article:Delete`          | Target article                                             |
| Reorder a batch          | `quyan:article:ReorderArticles` | Every article in the submission                            |

Lists return authorized metadata without content or an unfiltered global total. Grants can target another author in the same account or use resource groups. Additional article permission conditions still affect listing; foreign-account or unavailable articles, authors, and accounts do not become accessible. `Read` does not imply `ListArticles`, `Update` does not imply the separate `ReorderArticles`, and creation does not grant later operations. Successful edit, publish, and set-default responses can include complete content; grant their actual capabilities accordingly.

Removing resource-group membership affects subsequent requests, and matching Deny takes priority. Role sessions use the role's own grants while authorship remains the executing user. Create and update APIs accept content and access settings, without replacing the author, publication state, or counters; use the appropriate dedicated operation.

For legacy-permission compatibility, `ARTICLE_READ` lists the executing user's drafts or published articles. `ARTICLE_UPDATE` and `ARTICLE_DELETE` retain author-only editing/deletion, while historical reordering and publishing keep their own scopes. An identity with delegation authority must explicitly grant resource actions to manage other authors' articles in the same account. Legacy removed permissions still deny first. Legacy/shadow deployments retain their earlier checks. Menu visibility, lists, and content retrieval cannot replace one another.

Concurrent resource or ownership changes may reject an operation. Reload and check before resubmitting. See [RAM management]({{DOCS_BASE_URL}}/en/ram-management) for policy configuration.

## Troubleshooting

| Symptom                                                 | Action                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Readers cannot see a newly saved article                | Check draft state, public access, and reader permissions; saving is separate from publishing                    |
| Listed article fails to load in the editor              | Check content-read grants, draft authorship, and additional conditions; close the empty dialog before retrying  |
| Clearing permissions or switching to public still fails | The interface may omit removal of the old condition; explicitly clear it and verify the saved result            |
| Some readers cannot see the default                     | Default selection does not bypass publication and access conditions; check identity and public access           |
| Dragged order reverts                                   | Check grants for the complete list, the 500-article limit, and refresh results                                  |
| The list stays old after a success notice               | Writing and subsequent loading may succeed or fail separately; refresh successfully before repeating the action |
