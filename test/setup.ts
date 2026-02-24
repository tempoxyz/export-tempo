import { parseUnits } from 'viem'
import { Actions } from 'viem/tempo'
import { beforeAll } from 'vitest'
import { account, addresses, getClient } from './config.js'

const client = getClient({ account })

beforeAll(async () => {
  // Mint liquidity for fee tokens so transactions can pay fees.
  await Promise.all(
    [1n, 2n, 3n].map((id) =>
      Actions.amm.mintSync(client, {
        feeToken: addresses.pathUsd,
        nonceKey: 'expiring',
        userTokenAddress: id,
        validatorTokenAddress: addresses.pathUsd,
        validatorTokenAmount: parseUnits('1000', 6),
        to: account.address,
      }),
    ),
  )
})