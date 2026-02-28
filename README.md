# ordinals-renderer

An [OPNet](https://opnet.org) node plugin that serves Ordinals inscription content for **any OP721 contract** whose `tokenURI(tokenId)` returns an inscription ID.

Any OPNet node running this plugin becomes a full NFT content and metadata resolver — no per-collection configuration needed.

---

## Endpoints

All routes are namespaced under `/plugins/ordinals-renderer`:

### `GET /metadata/:contractAddress/:tokenId`

Returns OP721-compatible metadata JSON.

```
GET /plugins/ordinals-renderer/metadata/op1q.../42
```

```json
{
    "name":         "op1q... #42",
    "description":  "",
    "image":        "content/op1q.../42",
    "external_url": "https://ordinals.com/inscription/abc123...i0",
    "attributes": [
        { "trait_type": "Inscription ID",     "value": "abc123...i0" },
        { "trait_type": "Contract",           "value": "op1q..." },
        { "trait_type": "Inscription Number", "value": 123456 },
        { "trait_type": "Content Type",       "value": "image/webp" },
        { "trait_type": "Genesis Block",      "value": 850000 }
    ]
}
```

### `GET /content/:contractAddress/:tokenId`

Returns the raw inscription content as base64-encoded data.

```
GET /plugins/ordinals-renderer/content/op1q.../42
```

```json
{
    "contractAddress": "op1q...",
    "tokenId":         "42",
    "inscriptionId":   "abc123...i0",
    "contentType":     "image/webp",
    "data":            "<base64-encoded bytes>"
}
```

Decode:
```js
const bytes = Buffer.from(response.data, 'base64');
// browser:
const bytes = Uint8Array.from(atob(response.data), c => c.charCodeAt(0));
```

---

## Requirements

- OPNet node with plugin support
- Local [`ord`](https://github.com/ordinals/ord) node running with `--http`:
  ```bash
  ord --bitcoin-rpc-url http://127.0.0.1:8332 server --http --http-port 80
  ```
- The OP721 contract's `tokenURI(tokenId)` must return an Ordinals inscription ID (e.g. `"a3f...c2i0"`)

---

## How It Works

```
GET /content/:contractAddress/:tokenId
    │
    ├── contract.tokenURI(tokenId)   [OP_721_ABI, OPNet RPC]
    │       → returns inscriptionId (e.g. "abc123...i0")
    │
    └── GET http://localhost/inscription/{id}/content  [local ord node]
            → raw bytes + Content-Type
            → returned as base64
```

No contract-specific configuration — just point it at any OP721 address.

---

## Installation

```bash
npm install
npm run build
```

Copy `dist/` and `plugin.json` to your OPNet node's plugin directory.

---

## Configuration

```json
{
    "renderer": {
        "ordNodeUrl":  "http://localhost:80",
        "opnetRpcUrl": "https://mainnet.opnet.org/json-rpc",
        "network":     "mainnet"
    }
}
```

| Field | Description |
|-------|-------------|
| `ordNodeUrl` | Local ord node HTTP URL |
| `opnetRpcUrl` | OPNet JSON-RPC endpoint |
| `network` | `mainnet` or `regtest` |

---

## Notes

- Content is returned as base64 because OPNet plugin route handlers communicate through worker thread messaging — binary streaming is not supported at the plugin boundary.
- The `image` field in `/metadata` is a relative path resolved against the plugin base URL by the client.
- Returns an error object `{ "error": "..." }` if the token doesn't exist, isn't minted, or the `tokenURI` is not a valid inscription ID.

---

## Related

- [ordinals-vault](https://github.com/Lafourkad/ordinals-vault) — OP721 contract that bridges Bitcoin Ordinals to OPNet
- [ordinals-vault-oracle](https://github.com/Lafourkad/ordinals-vault-oracle) — Plugin to watch burns and attest them on-chain
- [OPNet Documentation](https://docs.opnet.org)
