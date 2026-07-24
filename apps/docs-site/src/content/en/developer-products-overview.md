# Developer products

Create an instance in the product console, then create an API key bound to the RAM principal that will call the product. Send the key as `Authorization: Bearer dpk_...`.

Keys inherit the real-time RAM permissions of their bound principal. Disable an instance to immediately reject its external API calls. Secret values are never returned after being written.
