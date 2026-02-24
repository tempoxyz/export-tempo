import { Mnemonic, Secp256k1 } from 'ox'
import { type Client, createClient, defineChain, http, parseUnits, type Transport } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { tempoLocalnet } from 'viem/chains'
import { Account, Actions } from 'viem/tempo'

import { rpcUrl } from './prool.js'

export const accounts = Array.from({ length: 20 }, (_, i) => {
  const privateKey = Mnemonic.toPrivateKey(
    'test test test test test test test test test test test junk',
    {
      as: 'Hex',
      path: Mnemonic.path({ account: i }),
    },
  )
  return Account.fromSecp256k1(privateKey)
}) as unknown as Account.RootAccount[]

// biome-ignore lint/style/noNonNullAssertion: _
export const account = accounts[0]!

export const chain = defineChain({
  ...tempoLocalnet,
  rpcUrls: { default: { http: [rpcUrl] } },
})

export function getClient<account extends Account.Account | undefined>(
  parameters: { account?: account } = {},
): Client<Transport, typeof chain, account> {
  return createClient({
    pollingInterval: 100,
    chain,
    transport: http(rpcUrl),
    ...parameters,
  }) as never
}

export const addresses = {
  pathUsd: '0x20c0000000000000000000000000000000000000',
  alphaUsd: '0x20c0000000000000000000000000000000000001',
} as const

export async function setupAccessKey(
  client: Client,
  account: Account.RootAccount,
  parameters: { limits?: { token: `0x${string}`; limit: bigint }[] } = {},
) {
  const { limits } = parameters
  const privateKey = Secp256k1.randomPrivateKey()
  const accessKey = Account.fromSecp256k1(privateKey, { access: account })

  const keyAuthorization = await Account.signKeyAuthorization(account, {
    key: accessKey,
    expiry: Math.floor((Date.now() + 120_000) / 1000),
    limits,
  })

  await sendTransactionSync(client, {
    account,
    keyAuthorization,
    chain: null,
  } as never)
  await new Promise((resolve) => setTimeout(resolve, 1000))

  return { accessKey, keyAuthorization, privateKey }
}

export async function setupToken(client: Client, account: Account.RootAccount) {
  const { token } = await Actions.token.createSync(client, {
    account,
    currency: 'USD',
    name: 'Test Token',
    symbol: 'TST',
  } as never)
  await Actions.token.grantRolesSync(client, {
    account,
    roles: ['issuer'],
    to: account.address,
    token,
  } as never)
  await Actions.token.mintSync(client, {
    account,
    amount: parseUnits('1000', 6),
    to: account.address,
    token,
  } as never)
  return token
}
