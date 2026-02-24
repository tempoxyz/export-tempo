import { P256, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { Account, Actions } from 'viem/tempo'
import { describe, expect, test } from 'vitest'
import { account, addresses, getClient, setupAccessKey, setupToken } from '../test/config.js'
import * as Export from './Export.js'

const client = getClient({ account })

describe('discover', () => {
  test('default', async () => {
    const tokenA = await setupToken(client, account)
    const tokenB = await setupToken(client, account)
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token: tokenA, limit: parseUnits('500', 6) },
        { token: tokenB, limit: parseUnits('300', 6) },
      ],
    })

    const result = await Export.discover(client, { exportKey: privateKey })

    expect(result.account.toLowerCase()).toBe(account.address.toLowerCase())
    expect(result.balances.length).toBe(2)

    const balanceA = result.balances.find(
      (b) => b.token.toLowerCase() === tokenA.toLowerCase(),
    )
    expect(balanceA?.limit).toBe(parseUnits('500', 6))
    expect(balanceA?.balance).toBeGreaterThan(0n)

    const balanceB = result.balances.find(
      (b) => b.token.toLowerCase() === tokenB.toLowerCase(),
    )
    expect(balanceB?.limit).toBe(parseUnits('300', 6))
    expect(balanceB?.balance).toBeGreaterThan(0n)
  })

  test('unknown private key throws', async () => {
    const privateKey = Secp256k1.randomPrivateKey()

    await expect(Export.discover(client, { exportKey: privateKey })).rejects.toThrow(
      'No authorized access key found for this private key.',
    )
  })

  test('revoked key throws', async () => {
    const token = await setupToken(client, account)
    const { accessKey, privateKey } = await setupAccessKey(client, account, {
      limits: [{ token, limit: parseUnits('500', 6) }],
    })

    await Actions.accessKey.revokeSync(client, {
      account,
      accessKey: accessKey.accessKeyAddress,
    })

    await expect(Export.discover(client, { exportKey: privateKey })).rejects.toThrow(
      'Access key is revoked.',
    )
  })

  test('zero remaining limit reports zero', async () => {
    const token = await setupToken(client, account)
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token, limit: 0n },
        { token: addresses.pathUsd, limit: parseUnits('10', 6) },
      ],
    })

    const result = await Export.discover(client, { exportKey: privateKey })
    const entry = result.balances.find(
      (b) => b.token.toLowerCase() === token.toLowerCase(),
    )
    expect(entry?.limit).toBe(0n)
  })

  test('uses supplied tokens instead of walking logs', async () => {
    const tokenA = await setupToken(client, account)
    const tokenB = await setupToken(client, account)
    const tokenC = await setupToken(client, account)
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token: tokenA, limit: parseUnits('500', 6) },
        { token: tokenB, limit: parseUnits('300', 6) },
        { token: tokenC, limit: parseUnits('100', 6) },
      ],
    })

    // Only request tokenA and tokenC — tokenB should be excluded.
    const result = await Export.discover(client, {
      exportKey: privateKey,
      tokens: [tokenA, tokenC],
    })

    expect(result.balances.length).toBe(2)
    expect(result.balances.find((b) => b.token.toLowerCase() === tokenA.toLowerCase())).toBeDefined()
    expect(result.balances.find((b) => b.token.toLowerCase() === tokenB.toLowerCase())).toBeUndefined()
    expect(result.balances.find((b) => b.token.toLowerCase() === tokenC.toLowerCase())).toBeDefined()
  })

  test('discovers via signed key auth (privateKey:signedKeyAuth)', async () => {
    const token = await setupToken(client, account)
    const limits = [
      { token, limit: parseUnits('500', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ]

    const { keyAuthorization, privateKey } = await setupAccessKey(
      client,
      account,
      { limits },
    )

    // Serialize and discover via composite key.
    const serialized = KeyAuthorization.serialize(keyAuthorization)
    const compositeKey = `${privateKey}:${serialized}` as `0x${string}`

    const result = await Export.discover(client, { exportKey: compositeKey })

    expect(result.account.toLowerCase()).toBe(account.address.toLowerCase())
    expect(result.balances.length).toBe(2)

    const entry = result.balances.find(
      (b) => b.token.toLowerCase() === token.toLowerCase(),
    )
    expect(entry?.limit).toBe(parseUnits('500', 6))
    expect(entry?.balance).toBeGreaterThan(0n)
  })

  test('discovers via webAuthn root-signed key auth', async () => {
    // Create a headless webAuthn root account.
    const webAuthnPrivateKey = P256.randomPrivateKey()
    const webAuthnRoot = Account.fromHeadlessWebAuthn(webAuthnPrivateKey, {
      rpId: 'localhost',
      origin: 'http://localhost',
    })

    // Fund the webAuthn root with pathUsd for transaction fees.
    await Actions.token.transferSync(client, {
      account,
      amount: parseUnits('10', 6),
      to: webAuthnRoot.address,
      token: addresses.pathUsd,
    } as never)

    // Create a token and transfer to the webAuthn root.
    const token = await setupToken(client, account)
    await Actions.token.transferSync(client, {
      account,
      amount: parseUnits('500', 6),
      to: webAuthnRoot.address,
      token,
    } as never)

    // Create a secp256k1 access key under the webAuthn root.
    const accessKeyPrivateKey = Secp256k1.randomPrivateKey()
    const accessKey = Account.fromSecp256k1(accessKeyPrivateKey, { access: webAuthnRoot })
    const limits = [
      { token, limit: parseUnits('500', 6) },
      { token: addresses.pathUsd, limit: parseUnits('5', 6) },
    ]

    // Sign key auth with the webAuthn root account.
    const keyAuthorization = await Account.signKeyAuthorization(webAuthnRoot, {
      key: accessKey,
      expiry: Math.floor((Date.now() + 120_000) / 1000),
      limits,
    })

    // Send the authorization transaction from the webAuthn root.
    await sendTransactionSync(getClient({ account: webAuthnRoot }), {
      account: webAuthnRoot,
      keyAuthorization,
      chain: null,
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Discover via composite key.
    const serialized = KeyAuthorization.serialize(keyAuthorization)
    const compositeKey = `${accessKeyPrivateKey}:${serialized}` as `0x${string}`

    const result = await Export.discover(client, { exportKey: compositeKey })

    expect(result.account.toLowerCase()).toBe(webAuthnRoot.address.toLowerCase())
    expect(result.balances.length).toBe(2)

    const entry = result.balances.find(
      (b) => b.token.toLowerCase() === token.toLowerCase(),
    )
    expect(entry?.limit).toBe(parseUnits('500', 6))
    expect(entry?.balance).toBeGreaterThan(0n)
  })
})

describe('execute', () => {
  test('transfers funds to recipient', async () => {
    const token = await setupToken(client, account)
    const recipient = '0x0000000000000000000000000000000000000069'
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token, limit: parseUnits('500', 6) },
        { token: addresses.pathUsd, limit: parseUnits('10', 6) },
      ],
    })

    const { accessKey, balances, feeToken } = await Export.discover(
      client,
      { exportKey: privateKey },
    )
    const transfers = balances
      .filter((b) => b.token !== feeToken)
      .map((b) => ({
        token: b.token,
        amount: b.limit < b.balance ? b.limit : b.balance,
      }))

    const results = await Export.execute(client, {
      account: accessKey,
      feeToken,
      transfers,
      to: recipient,
    })

    expect(results.length).toBeGreaterThanOrEqual(1)

    const tokenResult = results.find(
      (r) => r.token.toLowerCase() === token.toLowerCase(),
    )
    expect(tokenResult?.hash).toBeDefined()
  })

  test('returns empty for no transfers', async () => {
    const { privateKey } = await setupAccessKey(client, account)

    const { accessKey } = await Export.discover(client, { exportKey: privateKey })
    const results = await Export.execute(client, {
      account: accessKey,
      to: '0x0000000000000000000000000000000000000069',
      transfers: [],
    })

    expect(results).toEqual([])
  })

  test('transfers min(limit, balance) when limit < balance', async () => {
    const token = await setupToken(client, account)
    const recipient = '0x0000000000000000000000000000000000000070'
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token, limit: parseUnits('200', 6) },
        { token: addresses.pathUsd, limit: parseUnits('10', 6) },
      ],
    })

    const { accessKey, feeToken } = await Export.discover(client, { exportKey: privateKey })

    const results = await Export.execute(client, {
      account: accessKey,
      feeToken,
      to: recipient,
      transfers: [{ token, amount: parseUnits('200', 6) }],
    })

    expect(results.length).toBe(1)
  })

  test('batches multiple token transfers', async () => {
    const tokenA = await setupToken(client, account)
    const tokenB = await setupToken(client, account)
    const recipient = '0x0000000000000000000000000000000000000074'
    const { privateKey } = await setupAccessKey(client, account, {
      limits: [
        { token: tokenA, limit: parseUnits('400', 6) },
        { token: tokenB, limit: parseUnits('200', 6) },
        { token: addresses.pathUsd, limit: parseUnits('10', 6) },
      ],
    })

    const { accessKey, feeToken } = await Export.discover(client, { exportKey: privateKey })

    const results = await Export.execute(client, {
      account: accessKey,
      feeToken,
      to: recipient,
      transfers: [
        { token: tokenA, amount: parseUnits('400', 6) },
        { token: tokenB, amount: parseUnits('200', 6) },
      ],
    })

    expect(results.length).toBe(2)
    // All transfers share the same tx hash (batched).
    expect(results[0]?.hash).toBe(results[1]?.hash)
  })
})
