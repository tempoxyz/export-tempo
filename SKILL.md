---
name: export-tempo
description: Export funds with a Tempo export key (access key) to a recipient address. Use when asked to export, withdraw, or sweep tokens from Tempo.
---

# export-tempo

CLI tool and programmatic API for exporting authorized funds from a Tempo access key.

## Dryrun (default)

Shows the root account, fee token, and per-token balances/limits for an access key. Outputs a session blob that can be reused with `--session` to skip re-discovery.

```sh
export-tempo <exportKey> --to 0x...
```

The `exportKey` is either:

- `<privateKey>` — walks onchain logs to find the root account and key type.
- `<privateKey>:<signedKeyAuth>` — includes the RLP-encoded signed key authorization inline (avoids onchain lookups).

## Execute (with `--confirm`)

Discovers tokens, then transfers `min(remainingLimit, balance)` for each token to the recipient in a single batched transaction.

```sh
export-tempo <exportKey> --to 0x... --confirm
```

## Execute with session (skips dryrun)

Pass a session blob from a previous dryrun to skip the dryrun step entirely.

```sh
export-tempo <exportKey> --to 0x... --confirm --session <blob>
```

## Flags

| Flag          | Required         | Description                                                       |
| ------------- | ---------------- | ----------------------------------------------------------------- |
| `<exportKey>` | Yes (positional) | Access key private key, optionally with signed key auth.          |
| `--to`        | Yes              | Recipient address.                                                |
| `--confirm`   | No               | Execute transfers (dryruns first unless `--session` provided).    |
| `--session`   | No               | Session blob from a previous dryrun.                              |
| `--rpcUrl`    | No               | Tempo RPC URL. Defaults to `https://rpc.tempo.xyz`.               |
| `--feeToken`  | No               | Fee token address. Auto-detected if omitted.                      |
| `--tokens`    | No               | Comma-separated token addresses to export. All tokens if omitted. |

## Examples

```sh
# Dryrun balances
export-tempo 0xabc... --to 0xdef...

# Dryrun + execute in one step
export-tempo 0xabc... --to 0xdef... --confirm

# Two-step: dryrun, then execute with session blob
SESSION=$(export-tempo 0xabc... --to 0xdef... | grep 'Session:' | awk '{print $2}')
export-tempo 0xabc... --to 0xdef... --confirm --session "$SESSION"

# Export specific tokens
export-tempo 0xabc... --to 0xdef... --tokens 0x111...,0x222... --confirm

# Custom RPC and fee token
export-tempo 0xabc... --to 0xdef... --rpcUrl https://rpc.moderato.tempo.xyz --feeToken 0x20c0... --confirm
```
