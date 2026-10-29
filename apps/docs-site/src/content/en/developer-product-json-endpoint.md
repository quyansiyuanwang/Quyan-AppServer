# JSON Endpoints

The JSON Endpoints product gives each product instance one editable JSON document. It is useful for configuration publishing, lightweight shared data, and programmatic reads. The instance page shows its public URL, status, and product usage.

## Create and edit

Create a JSON Endpoint instance in the Developer Products console, then edit its JSON content on the instance page. With update permission, select **Save** to publish changes. A new instance starts with `{}` and is public by default: anyone with its address can read it, so check that content contains no secrets before saving. The product editor does not configure access protection. For password or signature protection, use the [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management) workflow with the required permissions. Product permissions, instance limits, and daily quotas follow the current server configuration.

The editor supports visual and code modes. In code mode, move focus out of the text box and confirm there is no JSON parsing error before saving. If parsing fails, saving may submit the previous valid content instead of the current text. Quick templates replace the current draft, so save anything you need to keep first. Switching instances or reloading the page also discards unsaved edits; copy or save them beforehand. If saving times out or the connection is interrupted, the change may have taken effect. Keep a copy of the draft, reopen the instance, and check the saved content before deciding whether to retry.

## Access methods

- Use a product API key with `GET /v1/products/json-endpoints` to read and `PUT /v1/products/json-endpoints` to update. The update body is `{ "jsonContent": <JSON value> }`. `DELETE` clears the content to `{}` without deleting the instance. Writes also require replay protection.
- The public URL shown on the instance page can be shared. See [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management) for password and signature protection and the required request format.
- Administrators can continue using `/content/json-endpoints` to manage legacy endpoints and see product association status.

API keys expose only the required prefix and permissions after creation; the full key is returned once and must be stored securely. Read, write, and manage permissions can be granted separately, and calls count toward product quota and call logs.

## Deletion

Deleting a product instance revokes its product API keys and removes the associated JSON endpoint. Existing legacy endpoints are not converted automatically.
