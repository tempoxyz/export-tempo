# export-tempo

CLI to export token balances authorized for an export key (access key) on Tempo to a recipient address.

## Quickprompt

Install the skill:

```
npx skills add tempoxyz/export-tempo
```

Then prompt your agent:

> Export my Tempo wallet

## Usage

By default, `export-tempo` dryruns the export — showing the tokens available to export and their amounts.

```sh
npx export-tempo --exportKey 0x… --to 0x…
```

The dryrun returns a session blob. Pass it with `--confirm` to execute the export — each token is transferred at `min(remainingLimit, balance)` in a single batched transaction.

```sh
npx export-tempo --exportKey 0x… --to 0x… --confirm --session <blob>
```

## Generating an Export Key

An export key is an access key authorized by your passkey to sign transactions on your behalf.

- **From `wallet.tempo.xyz`:** navigate to **Key Management**, select **Create New Key**, and authenticate with your passkey. The key is displayed once – copy and store it securely.
- **If your account can't be serviced:** you will be prompted with a button to export your key. The key is displayed once – copy and store it securely.

[Learn more](https://app.moderato.tempo.xyz/support/key-exports)

## CLI Reference

```
USAGE export-tempo [OPTIONS] <EXPORTKEY> to

ARGUMENTS
  EXPORTKEY    Export key.

OPTIONS
  --to                                 Recipient address.
  --rpcUrl="https://rpc.tempo.xyz"     Tempo RPC URL.
  --feeToken                           Fee token address (auto-detected if omitted).
  --tokens                             Comma-separated token addresses to export (all tokens if omitted).
  --session                            Session blob from a dryrun.
  --confirm                            Execute the transfers.
```

## License

[MIT](/LICENSE) License
