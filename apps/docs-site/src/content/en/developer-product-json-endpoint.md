# JSON Endpoints

The JSON Endpoints product gives each product instance one editable JSON document. It is useful for configuration publishing, lightweight shared data, and programmatic reads. The instance page shows its public URL, status, and product usage.

## Create and edit

Create a JSON Endpoint instance in the Developer Products console, then edit and save its JSON content from the instance page. A new instance starts with `{}` and is public by default: anyone with its address can read it, so check that content contains no secrets before saving. Product permissions, instance limits, and daily quotas follow the current server configuration.

## Access methods

- Use a product API key with `GET /v1/products/json-endpoints` to read and `PUT /v1/products/json-endpoints` to update. The update body is `{ "jsonContent": <JSON value> }`. `DELETE` clears the content to `{}` without deleting the instance. Writes also require replay protection.
- The public URL shown on the instance page can be shared. See [JSON endpoint management]({{DOCS_BASE_URL}}/en/json-endpoint-management) for password and signature protection and the required request format.
- Administrators can continue using `/content/json-endpoints` to manage legacy endpoints and see product association status.

API keys expose only the required prefix and permissions after creation; the full key is returned once and must be stored securely. Read, write, and manage permissions can be granted separately, and calls count toward product quota and call logs.

## Deletion

Deleting a product instance revokes its product API keys and removes the associated JSON endpoint. Existing legacy endpoints are not converted automatically.
