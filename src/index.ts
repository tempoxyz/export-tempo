#!/usr/bin/env node

import * as p from '@clack/prompts'
import { defineCommand, runMain } from 'citty'
import { type Address, createClient, formatUnits, http } from 'viem'
import { tempo } from 'viem/chains'
import { Account } from 'viem/tempo'

import pkg from '../package.json' with { type: 'json' }
import * as Export from './Export.js'
import * as Session from './Session.js'

const main = defineCommand({
  meta: {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
  },
  args: {
    exportKey: {
      type: 'positional',
      description: 'Export key.',
      required: true,
    },
    rpcUrl: {
      type: 'string',
      description: 'Tempo RPC URL.',
      default: 'https://rpc.tempo.xyz',
    },
    to: {
      type: 'string',
      description: 'Recipient address.',
      required: true,
    },
    feeToken: {
      type: 'string',
      description: 'Fee token address (auto-detected if omitted).',
    },
    tokens: {
      type: 'string',
      description: 'Comma-separated token addresses to export (all tokens if omitted).',
    },
    confirm: {
      type: 'boolean',
      description: 'Execute the transfers.',
      default: false,
    },
    session: {
      type: 'string',
      description: 'Session blob from a dryrun.',
    },
  },
  async run({ args }) {
    p.intro('Tempo Export')

    const client = createClient({
      chain: tempo,
      transport: http(args.rpcUrl),
    })

    const exportKey = args.exportKey as `0x${string}`

    // If --session is provided, skip dryrun and use the cached session.
    if (args.confirm && args.session) {
      const session = Session.decode(args.session)

      const [privateKey] = exportKey.split(':') as [`0x${string}`]
      const accessKey =
        session.keyType === 'p256'
          ? Account.fromP256(privateKey, { access: session.account })
          : Account.fromSecp256k1(privateKey, { access: session.account })

      const transfers = session.transfers.map((t) => ({
        token: t.token,
        amount: BigInt(t.amount),
      }))

      const feeToken = (args.feeToken as Address) ?? session.feeToken
      if (!feeToken) {
        p.cancel('No fee token found. Specify one with --feeToken.')
        process.exit(1)
      }

      const s = p.spinner()
      s.start('Executing transfers...')

      const results = await Export.execute(client, {
        account: accessKey,
        feeToken,
        to: args.to as Address,
        transfers,
      })

      s.stop('Transfers complete')

      const lines = results.map(({ amount, token }) => {
        const t = session.transfers.find((s) => s.token.toLowerCase() === token.toLowerCase())
        const decimals = t?.decimals ?? 6
        const symbol = t?.symbol ?? token
        const formatted = Number(formatUnits(amount, decimals)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: decimals,
        })
        return `  ${symbol.padEnd(10)} ${formatted.padStart(20)}`
      })
      p.log.success(`Exported to ${args.to}:\n${lines.join('\n')}`)

      const hash = results[0]?.hash
      const explorer = args.rpcUrl.includes('moderato')
        ? 'https://explore.moderato.tempo.xyz'
        : client.chain?.blockExplorers?.default?.url ?? 'https://explore.mainnet.tempo.xyz'
      p.outro(hash ? `\u001b]8;;${explorer}/tx/${hash}\u0007${explorer}/tx/${hash}\u001b]8;;\u0007` : 'Done')
      return
    }

    const s = p.spinner()

    s.start('Loading account...')

    const result = await Export.discover(client, { exportKey })

    s.stop('Account loaded.')

    const feeToken = (args.feeToken as Address) ?? result.feeToken

    // Filter to requested tokens if specified.
    const tokenFilter = args.tokens?.split(',').map((t) => t.trim().toLowerCase())
    const balances = tokenFilter
      ? result.balances.filter((b) => tokenFilter.includes(b.token.toLowerCase()))
      : result.balances

    // Compute transfers: min(limit, balance), skip zeros.
    const transfers = balances
      .map((b) => ({
        amount: b.limit < b.balance ? b.limit : b.balance,
        token: b.token,
      }))
      .filter((t) => t.amount > 0n)

    // Print dryrun results.
    p.log.info(`Account: ${result.account}`)

    const transferLines = balances.map(({ balance, limit, metadata }) => {
      const decimals = metadata.decimals
      const exportable = limit < balance ? limit : balance
      const formatted = Number(formatUnits(exportable, decimals)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals,
      })
      const note = limit < balance ? ' (limited)' : ''
      return `  ${metadata.symbol.padEnd(10)} ${formatted.padStart(20)}${note}`
    })
    p.log.info(`Exportable:\n${transferLines.join('\n')}`)

    // Build session blob.
    const blob =
      transfers.length > 0 && feeToken
        ? Session.encode({
            account: result.account,
            keyType: result.accessKey.keyType,
            feeToken,
            transfers: transfers.map((t) => {
              const meta = balances.find(
                (b) => b.token.toLowerCase() === t.token.toLowerCase(),
              )?.metadata
              return {
                token: t.token,
                amount: t.amount.toString(),
                symbol: meta?.symbol ?? t.token,
                decimals: meta?.decimals ?? 6,
              }
            }),
          })
        : undefined

    if (!args.confirm) {
      if (blob) {
        p.outro(
          `Run export with: export-tempo <exportKey> --to ${args.to} --confirm --session ${blob}`,
        )
      } else {
        p.outro('No tokens to export.')
      }
      return
    }

    // Execute transfers.
    if (!feeToken) {
      p.cancel('No fee token found. Specify one with --feeToken.')
      process.exit(1)
    }

    if (transfers.length === 0) {
      p.outro('No tokens to export.')
      return
    }

    s.start('Executing transfers...')

    const results = await Export.execute(client, {
      account: result.accessKey,
      feeToken,
      to: args.to as Address,
      transfers,
    })

    s.stop('Transfers complete')

    const lines = results.map(({ amount, token }) => {
      const meta = result.balances.find(
        (b) => b.token.toLowerCase() === token.toLowerCase(),
      )?.metadata
      const decimals = meta?.decimals ?? 6
      const symbol = meta?.symbol ?? token
      const formatted = Number(formatUnits(amount, decimals)).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals,
      })
      return `  ${symbol.padEnd(10)} ${formatted.padStart(20)}`
    })
    p.log.success(`Exported to ${args.to}:\n${lines.join('\n')}`)

    const hash = results[0]?.hash
    const explorer = args.rpcUrl.includes('moderato')
      ? 'https://explore.moderato.tempo.xyz'
      : client.chain?.blockExplorers?.default?.url ?? 'https://explore.mainnet.tempo.xyz'
    p.outro(hash ? `\u001b]8;;${explorer}/tx/${hash}\u0007${explorer}/tx/${hash}\u001b]8;;\u0007` : 'Done')
  },
})

runMain(main)
