# JSON Endpoints

The JSON Endpoints product gives each product instance one editable JSON document. It is useful for configuration publishing, lightweight shared data, and programmatic reads. The instance page shows its public URL, status, and product usage.

## Create and edit

Create a JSON Endpoint instance in the Developer Products console, then edit and save its JSON content from the instance page. Product permissions, instance limits, and daily quotas follow the current server configuration.

## Access methods

- Use a product API key with `/v1/products/json-endpoints` for programmatic reads and updates.
- A public URL can be shared; when public access is disabled, use the existing password or signature access policy.
- Administrators can continue using `/content/json-endpoints` to manage legacy endpoints and see product association status.

API keys expose only the required prefix and permissions after creation; the full key is returned once and must be stored securely. Read, write, and manage permissions can be granted separately, and calls count toward product quota and call logs.

## Deletion

Deleting a product instance revokes its product API keys and removes the associated JSON endpoint. Existing legacy endpoints are not converted automatically.
