# ordinals-renderer

An [OPNet](https://opnet.org) node plugin that serves Ordinals inscription content directly from OPNet nodes.

Resolves `tokenURI(tokenId)` on the [OrdinalsVault](https://github.com/Lafourkad/ordinals-vault) OP721 contract to get an inscription ID, then proxies the content from a local `ord` node. Any OPNet node running this plugin becomes a full NFT metadata and content resolver.

---

## Endpoints

All routes are namespaced under the plugin base path (`/plugins/ordinals-renderer`):

### `GET /metadata/:tokenId`

Returns OP721-compatible JSON metadata for wallets and marketplaces.

```json
{
    "name": "My Collection #42",
    "description": "Ordinals bridged to OPNet",
    "image": "content/42",
    "external_url": "https://ordinals.com/inscription/abc123...i0",
    "attributes": [
        { "trait_type": "Inscription ID",     "value": "abc123...i0" },
        { "trait_type": "Inscription Number", "value": 123456 },
        { "trait_type": "Content Type",       "value": "image/webp" },
        { "trait_type": "Genesis Block",      "value": 850000 }
    ]
}
```

### `GET /content/:tokenId`

Returns the raw inscription content as base64-encoded data.

```json
{
    "contentType":   "image/webp",
    "data":          "<base64-encoded bytes>",
    "inscriptionId": "abc123...i0",
    "tokenId":       "42"
}
```

Decode with:
```js
const bytes = Buffer.from(response.data, 'base64');
// or in the browser:
const bytes = Uint8Array.from(atob(response.data), c => c.charCodeAt(0));
```

---

## How It Works

```
GET /metadata/:tokenId  or  GET /content/:tokenId
    │
    ├── resolveInscriptionId(tokenId)
    │       └── contract.tokenURI(tokenId)  [OP_721_ABI, OPNet RPC]
    │               → returns inscriptionId (e.g. "abc123...i0")
    │
    └── OrdClient.getInscription(inscriptionId)    [metadata route]
        OrdClient.getInscriptionContent(inscriptionId)  [content route]
                └── GET http://localhost/inscription/{id}[/content]
                        [local ord node]
```

---

## Requirements

- OPNet node with plugin support
- Local [`ord`](https://github.com/ordinals/ord) node running with `--http`:
  ```bash
  ord --bitcoin-rpc-url http://127.0.0.1:8332 server --http --http-port 80
  ```

---

## Installation

```bash
npm install
npm run build
```

Copy `dist/` and `plugin.json` to your OPNet node's plugin directory.

---

## Configuration

Copy `plugin.config.example.json` to `plugin.config.json` and fill in your values:

```json
{
    "renderer": {
        "vaultContractAddress": "op1q...",
        "ordNodeUrl":           "http://localhost:80",
        "opnetRpcUrl":          "https://mainnet.opnet.org/json-rpc",
        "network":              "mainnet",
        "collectionName":       "My Ordinals Collection",
        "collectionDescription": "Ordinals bridged to OPNet"
    }
}
```

| Field | Description |
|-------|-------------|
| `vaultContractAddress` | Deployed OrdinalsVault contract address |
| `ordNodeUrl` | Local ord node HTTP URL |
| `opnetRpcUrl` | OPNet JSON-RPC endpoint |
| `network` | `mainnet` or `regtest` |
| `collectionName` | Collection name used in metadata `name` field |
| `collectionDescription` | Collection description used in metadata |

---

## Plugin Permissions

```json
{
    "api": {
        "addEndpoints": true,
        "basePath": "/plugins/ordinals-renderer",
        "routes": [
            { "path": "metadata/:tokenId", "method": "GET" },
            { "path": "content/:tokenId",  "method": "GET" }
        ]
    },
    "filesystem": { "configDir": true }
}
```

---

## Notes

- Content is returned as base64 because OPNet plugin route handlers communicate over worker thread messaging — binary streaming is not supported at the plugin boundary.
- The `image` field in `/metadata` is a relative path (`content/{tokenId}`), resolved against the plugin base URL by the client.
- Token IDs not yet minted or without a set inscription will return a 404-equivalent error object.

---

## Related

- [ordinals-vault](https://github.com/Lafourkad/ordinals-vault) — The OrdinalsVault OP721 contract
- [ordinals-vault-oracle](https://github.com/Lafourkad/ordinals-vault-oracle) — Plugin to watch burns and mint OP721 tokens
- [OPNet Documentation](https://docs.opnet.org)
