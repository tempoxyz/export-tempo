import { execFile } from 'node:child_process'
import { parseUnits } from 'viem'
import { Actions } from 'viem/tempo'
import { expect, test } from 'vitest'

import { account, addresses, getClient, setupAccessKey, setupToken } from '../test/config.js'
import { rpcUrl } from '../test/prool.js'

const client = getClient({ account })

test('prints balances in dryrun mode', async () => {
  const token = await setupToken(client, account)
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [{ token, limit: parseUnits('500', 6) }],
  })

  const { stdout } = await cli([privateKey, '--to', account.address, '--rpcUrl', rpcUrl])

  expect(stdout).toContain(`Account: ${account.address}`)
  expect(stdout).toContain('Exportable:')
  expect(stdout).toContain('TST')
  expect(stdout).toContain('500')
  expect(stdout).not.toContain('Exported to')
})

test('prints session blob in dryrun mode', async () => {
  const token = await setupToken(client, account)
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token, limit: parseUnits('500', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout } = await cli([privateKey, '--to', account.address, '--rpcUrl', rpcUrl])

  expect(stdout).toContain('--session')
  const blob = extractSession(stdout)
  expect(blob).toBeTruthy()
})

test('executes transfers with session blob', async () => {
  const token = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000072'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token, limit: parseUnits('500', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  // Step 1: dryrun
  const { stdout: dryrun } = await cli([privateKey, '--to', recipient, '--rpcUrl', rpcUrl])
  const blob = extractSession(dryrun)

  // Step 2: execute with session blob
  const { stdout } = await cli([
    privateKey,
    '--to',
    recipient,
    '--rpcUrl',
    rpcUrl,
    '--confirm',
    '--session',
    blob,
  ])

  expect(stdout).toContain('Exported to')

  const balance = await Actions.token.getBalance(client, {
    account: recipient,
    token,
  })
  expect(balance).toBe(parseUnits('500', 6))
})

test('executes multiple token transfers with session blob', async () => {
  const tokenA = await setupToken(client, account)
  const tokenB = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000075'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token: tokenA, limit: parseUnits('500', 6) },
      { token: tokenB, limit: parseUnits('300', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout: dryrun } = await cli([privateKey, '--to', recipient, '--rpcUrl', rpcUrl])
  const blob = extractSession(dryrun)

  const { stdout } = await cli([
    privateKey,
    '--to',
    recipient,
    '--rpcUrl',
    rpcUrl,
    '--confirm',
    '--session',
    blob,
  ])

  expect(stdout).toContain('Exported to')

  const balanceA = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenA,
  })
  expect(balanceA).toBe(parseUnits('500', 6))

  const balanceB = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenB,
  })
  expect(balanceB).toBe(parseUnits('300', 6))
})

test('exports tokens with --confirm (no session blob)', async () => {
  const token = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000077'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token, limit: parseUnits('500', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout } = await cli([privateKey, '--to', recipient, '--rpcUrl', rpcUrl, '--confirm'])

  expect(stdout).toContain('Account:')
  expect(stdout).toContain('Exportable:')
  expect(stdout).toContain('Exported to')

  const balance = await Actions.token.getBalance(client, {
    account: recipient,
    token,
  })
  expect(balance).toBe(parseUnits('500', 6))
})

test('exports multiple tokens with --confirm (no session blob)', async () => {
  const tokenA = await setupToken(client, account)
  const tokenB = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000078'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token: tokenA, limit: parseUnits('500', 6) },
      { token: tokenB, limit: parseUnits('300', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout } = await cli([privateKey, '--to', recipient, '--rpcUrl', rpcUrl, '--confirm'])

  expect(stdout).toContain('Exported to')

  const balanceA = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenA,
  })
  expect(balanceA).toBe(parseUnits('500', 6))

  const balanceB = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenB,
  })
  expect(balanceB).toBe(parseUnits('300', 6))
})

test('revoked key shows error', async () => {
  const token = await setupToken(client, account)
  const { accessKey, privateKey } = await setupAccessKey(client, account, {
    limits: [{ token, limit: parseUnits('500', 6) }],
  })

  await Actions.accessKey.revokeSync(client, {
    account,
    accessKey: accessKey.accessKeyAddress,
  })

  const { stderr, exitCode } = await cli([privateKey, '--to', account.address, '--rpcUrl', rpcUrl])

  expect(exitCode).not.toBe(0)
  expect(stderr).toContain('Access key is revoked.')
})

test('filters to single token with --tokens', async () => {
  const tokenA = await setupToken(client, account)
  const tokenB = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000073'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token: tokenA, limit: parseUnits('500', 6) },
      { token: tokenB, limit: parseUnits('300', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout } = await cli([
    privateKey,
    '--to',
    recipient,
    '--rpcUrl',
    rpcUrl,
    '--tokens',
    tokenA,
    '--confirm',
  ])

  expect(stdout).toContain('Exported to')

  const balanceA = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenA,
  })
  expect(balanceA).toBe(parseUnits('500', 6))

  const balanceB = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenB,
  })
  expect(balanceB).toBe(0n)
})

test('filters to multiple comma-separated tokens with --tokens', async () => {
  const tokenA = await setupToken(client, account)
  const tokenB = await setupToken(client, account)
  const tokenC = await setupToken(client, account)
  const recipient = '0x0000000000000000000000000000000000000076'
  const { privateKey } = await setupAccessKey(client, account, {
    limits: [
      { token: tokenA, limit: parseUnits('500', 6) },
      { token: tokenB, limit: parseUnits('300', 6) },
      { token: tokenC, limit: parseUnits('200', 6) },
      { token: addresses.pathUsd, limit: parseUnits('10', 6) },
    ],
  })

  const { stdout } = await cli([
    privateKey,
    '--to',
    recipient,
    '--rpcUrl',
    rpcUrl,
    '--tokens',
    `${tokenA},${tokenB}`,
    '--confirm',
  ])

  expect(stdout).toContain('Exported to')

  const balanceA = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenA,
  })
  expect(balanceA).toBe(parseUnits('500', 6))

  const balanceB = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenB,
  })
  expect(balanceB).toBe(parseUnits('300', 6))

  const balanceC = await Actions.token.getBalance(client, {
    account: recipient,
    token: tokenC,
  })
  expect(balanceC).toBe(0n)
})

function extractSession(stdout: string): string {
  const match = stdout.match(/--session\s+(\S+)/)
  if (!match?.[1]) throw new Error('No session blob found in output')
  return match[1].trim()
}

function cli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      'node',
      ['--import', 'tsx', 'src/index.ts', ...args],
      { cwd: process.cwd() },
      (error, stdout, stderr) => {
        resolve({
          exitCode: Number(error?.code ?? 0),
          stderr,
          stdout,
        })
      },
    )
  })
}
