import { Address, P256, Rlp, Secp256k1 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { maxUint256, type Client, type Hex } from 'viem'
import {
  getBlockNumber,
  getContractEvents,
  getTransaction,
  prepareTransactionRequest,
  sendTransactionSync,
} from 'viem/actions'
import { Abis, Account, Actions, Addresses } from 'viem/tempo'

const feeTokens = [
  '0x20c0000000000000000000000000000000000000', // pathUsd
  '0x20C000000000000000000000b9537d11c60e8b50', // USDC.e
] as const

/**
 * Discovers the root account, access key type, and token balances eligible
 * for export from a given access key private key.
 */
export async function prepare(
  client: Client,
  options: prepare.Options,
): Promise<prepare.ReturnType> {
  // Parse the export key input. Supports two formats:
   // 1. `<privateKey>` — requires walking onchain logs to find the root account.
   // 2. `pk_<privateKey>:ka_<signedKeyAuth>` — composite format where the signed
   //    key authorization contains the root account signature, limits, and key type.
  const { account, keyAuthorization, accessKey } = await (async () => {
    const { privateKey, keyAuthorization: keyAuthorization_serialized } = parseKey(
      options.exportKey,
    )

    if (keyAuthorization_serialized) {
      const keyAuthorization = decodeKeyAuthorization(keyAuthorization_serialized)

      // Derive the root account address from the signature envelope.
      const account = SignatureEnvelope.extractAddress({
        payload: KeyAuthorization.getSignPayload(keyAuthorization),
        signature: keyAuthorization.signature,
        root: true,
      })

      const accessKey = (() => {
        if (keyAuthorization.type === 'p256')
          return Account.fromP256(privateKey, { access: account })
        return Account.fromSecp256k1(privateKey, { access: account })
      })()

      return { account, keyAuthorization, accessKey }
    }

    // Derive access key addresses for both key types (secp256k1 and p256).
    const addresses = (() => {
      const result: Address.Address[] = []
      try {
        result.push(Address.fromPublicKey(P256.getPublicKey({ privateKey })))
      } catch {}
      try {
        result.push(Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })))
      } catch {}
      return result
    })()

    // Walk backwards through blocks in 100k chunks to find the KeyAuthorized event.
    const logs = await walkLogs(client, {
      async getEvents({ fromBlock, toBlock }) {
        const value = await getContractEvents(client, {
          address: Addresses.accountKeychain,
          abi: Abis.accountKeychain,
          eventName: 'KeyAuthorized',
          args: { publicKey: addresses },
          fromBlock,
          toBlock,
        })
        return { continue: value.length === 0, value }
      },
    })
    const auth = logs[0]
    if (!auth?.args.account || !auth.args.publicKey)
      throw new Error('No authorized access key found for this private key.')

    const { account, publicKey } = auth.args
    const transactionHash = auth.transactionHash as Hex

    // Fetch onchain metadata to detect key type and validate status.
    const metadata = await Actions.accessKey.getMetadata(client, {
      accessKey: publicKey,
      account,
    })

    if (metadata.isRevoked) throw new Error('Access key is revoked.')
    if (metadata.expiry > 0n && metadata.expiry < BigInt(Math.floor(Date.now() / 1000)))
      throw new Error('Access key is expired.')

    const accessKey = (() => {
      if (metadata.keyType === 'p256') return Account.fromP256(privateKey, { access: account })
      return Account.fromSecp256k1(privateKey, { access: account })
    })()

    // Extract key authorization from the authorization transaction.
    const transaction = await getTransaction(client, { hash: transactionHash })
    // biome-ignore lint/suspicious/noExplicitAny: _
    const keyAuthorization = (transaction as any).keyAuthorization as
      | { address: Address.Address; limits: readonly KeyAuthorization.TokenLimit[] }
      | undefined

    return { account, keyAuthorization: { address: publicKey, ...keyAuthorization }, accessKey }
  })()

  // Resolve tokens: use supplied list, extract from limits, or walk logs.
  const tokens: Address.Address[] = options.tokens
    ? [...options.tokens]
    : (keyAuthorization.limits?.map((l) => l.token) ?? [])

  if (tokens.length === 0) {
    // Walk backwards through blocks to find Transfer events to this account.
    const logs = await walkLogs(client, {
      async getEvents({ fromBlock, toBlock }) {
        const value = await getContractEvents(client, {
          abi: Abis.tip20,
          eventName: 'Transfer',
          args: { to: account },
          fromBlock,
          toBlock,
        })
        return { continue: true, value }
      },
    })

    const seen = new Set<string>()
    for (const log of logs) {
      const addr = log.address.toLowerCase()
      if (!seen.has(addr)) {
        seen.add(addr)
        tokens.push(log.address)
      }
    }
  }

  // Check if the key has unlimited spending (no limits enforced).
  const { spendPolicy } = await Actions.accessKey.getMetadata(client, {
    accessKey: keyAuthorization.address,
    account,
  })

  // Fetch remaining spending limit, account balance, and AMM liquidity
  // for each token.
  const balances: prepare.Balance[] = []
  let feeToken: Address.Address | undefined
  for (const token of tokens) {
    const [limit, balance, metadata, pool] = await Promise.all([
      spendPolicy === 'unlimited'
        ? Promise.resolve(maxUint256)
        : Actions.accessKey.getRemainingLimit(client, {
            accessKey: keyAuthorization.address,
            account,
            token,
          }),
      Actions.token.getBalance(client, {
        account,
        token,
      }),
      Actions.token.getMetadata(client, { token }),
      Actions.amm
        .getPool(client, {
          userToken: token,
          validatorToken: Addresses.pathUsd,
        })
        .catch(() => undefined),
    ])

    // Known fee tokens (pathUsd, USDC.e) are always eligible. Other
    // tokens require AMM liquidity (reserves in a validator token pool).
    const isKnownFeeToken = feeTokens.some((t) => t.toLowerCase() === token.toLowerCase())
    const hasLiquidity =
      isKnownFeeToken ||
      (pool ? pool.reserveUserToken > 0n && pool.reserveValidatorToken > 0n : false)

    // Pick the best fee token: must have a spending limit, balance, and
    // liquidity. Prefer pathUsd if eligible.
    if (limit > 0n && balance > 0n && hasLiquidity && (!feeToken || isKnownFeeToken))
      feeToken = token

    balances.push({
      balance,
      limit,
      metadata,
      token,
    })
  }

  return {
    account,
    accessKey,
    balances,
    feeToken,
    keyAuthorization: 'signature' in keyAuthorization ? keyAuthorization : undefined,
  }
}

export declare namespace prepare {
  type Options = {
    /**
     * Access key private key, optionally paired with its signed key authorization.
     *
     * - `<privateKey>` — the access key's private key. The root account and key
     *   type are resolved by walking onchain `KeyAuthorized` events.
     * - `pk_<privateKey>:ka_<signedKeyAuth>` — composite format with the access
     *   key's private key and an RLP-encoded signed key authorization that
     *   contains the root account signature, spending limits, and key type
     *   inline (avoids onchain lookups).
     */
    exportKey: Hex
    /** Token addresses to check. If omitted, all tokens are discovered via onchain logs. */
    tokens?: Address.Address[] | undefined
  }

  type Balance = {
    /** Account balance of the token. */
    balance: bigint
    /** Remaining spending limit for the access key on this token. */
    limit: bigint
    /** Token metadata (name, symbol, decimals). */
    metadata: Actions.token.getMetadata.ReturnValue
    /** Token contract address. */
    token: Address.Address
  }

  type ReturnType = {
    /** The access key account derived from the export key. */
    accessKey: Account.AccessKeyAccount
    /** The root account address that owns the assets. */
    account: Address.Address
    /** Token balances and limits for the root account. */
    balances: readonly Balance[]
    /** Auto-detected fee token address, if any. */
    feeToken: Address.Address | undefined
    /** Signed key authorization, if the export key included one with a signature. */
    keyAuthorization: KeyAuthorization.KeyAuthorization<true> | undefined
  }
}

/**
 * Transfers the selected tokens to a recipient address in a single
 * batched transaction.
 */
export async function execute(
  client: Client,
  options: execute.Options,
): Promise<execute.ReturnType> {
  const { account, feeToken, keyAuthorization, to } = options
  let { transfers } = options

  if (transfers.length === 0) return []

  // Batch all token transfers into a single transaction.
  const calls = transfers.map(({ token, amount }) =>
    Actions.token.transfer.call({ amount, to, token }),
  )

  // Prepare the transaction to get gas estimates.
  const prepared = await prepareTransactionRequest(client, {
    account: account as never,
    calls,
    feeToken,
    keyAuthorization,
  } as never)

  // If the fee token is being transferred, reduce its amount to leave
  // room for gas.
  const calls_adjusted = await (async () => {
    if (!feeToken) return calls
    const feeTokenIndex = transfers.findIndex(
      (t) => t.token.toLowerCase() === feeToken.toLowerCase(),
    )
    if (feeTokenIndex === -1) return calls
    const feeCostWei = (prepared.gas! * BigInt(prepared.maxFeePerGas!) * 120n) / 100n
    const { decimals } = await Actions.token.getMetadata(client, { token: feeToken })
    const feeCost = feeCostWei / 10n ** BigInt(18 - decimals)
    const original = transfers[feeTokenIndex]!.amount
    const adjusted = original > feeCost ? original - feeCost : 0n
    transfers = transfers.map((t, i) => (i === feeTokenIndex ? { ...t, amount: adjusted } : t))
    return calls.map((c, i) =>
      i === feeTokenIndex
        ? Actions.token.transfer.call({
            amount: adjusted,
            to,
            token: transfers[feeTokenIndex]!.token,
          })
        : c,
    )
  })()

  const { transactionHash: hash } = await sendTransactionSync(client, {
    ...prepared,
    calls: calls_adjusted,
  } as never)

  return transfers.map(({ token, amount }) => ({
    amount,
    token,
    hash,
  }))
}

export declare namespace execute {
  type Options = {
    account: Account.Account
    feeToken?: Address.Address | undefined
    keyAuthorization?: KeyAuthorization.KeyAuthorization<true> | undefined
    transfers: readonly {
      token: Address.Address
      amount: bigint
    }[]
    to: Address.Address
  }

  type ReturnType = readonly {
    token: Address.Address
    amount: bigint
    hash: `0x${string}`
  }[]
}

/**
 * Parses an export key string into its private key and optional key authorization parts.
 *
 * Supports two formats:
 * - `<privateKey>` — bare private key hex.
 * - `pk_<privateKey>:ka_<keyAuth>` — composite format with prefixed parts.
 */
export function parseKey(key: string): {
  privateKey: Hex
  keyAuthorization: Hex | undefined
} {
  if (key.startsWith('pk_')) {
    const parts = key.split(':ka_')
    return {
      privateKey: parts[0]!.slice(3) as Hex,
      keyAuthorization: parts[1] ? (parts[1] as Hex) : undefined,
    }
  }
  return { privateKey: key as Hex, keyAuthorization: undefined }
}

/**
 * Decodes an RLP-encoded signed key authorization hex string.
 */
export function decodeKeyAuthorization(serialized: Hex): KeyAuthorization.KeyAuthorization<true> {
  const tuple = Rlp.toHex(serialized) as KeyAuthorization.Tuple<true>
  return KeyAuthorization.fromTuple(tuple)
}

// biome-ignore lint/correctness/noUnusedVariables: _
async function walkLogs<logs extends readonly { address: Address.Address }[]>(
  client: Client,
  options: walkLogs.Options<logs>,
): Promise<logs[number][]> {
  const { chunkSize = 100_000n, concurrency = 5, getEvents } = options
  const blockNumber = await getBlockNumber(client)
  const results: logs[number][] = []

  let cursor = blockNumber
  let done = false
  while (cursor >= 0n && !done) {
    const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
    for (let i = 0; i < concurrency && cursor >= 0n; i++) {
      const fromBlock = cursor > chunkSize ? cursor - chunkSize : 0n
      ranges.push({ fromBlock, toBlock: cursor })
      if (fromBlock === 0n) break
      cursor = fromBlock - 1n
    }

    const batches = await Promise.all(ranges.map((r) => getEvents(r)))
    for (const batch of batches) {
      for (const log of batch.value) results.push(log)
      if (!batch.continue) {
        done = true
        break
      }
    }

    if (ranges.at(-1)?.fromBlock === 0n) break
  }

  return results
}

declare namespace walkLogs {
  type Options<logs extends readonly { address: Address.Address }[]> = {
    chunkSize?: bigint | undefined
    concurrency?: number | undefined
    getEvents: (parameters: {
      fromBlock: bigint
      toBlock: bigint
    }) => Promise<{ continue: boolean; value: logs }>
  }
}

