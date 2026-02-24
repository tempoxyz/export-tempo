import { type Instance, Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'

export const port = 9545

export const rpcUrl = `http://localhost:${port}/${Number(process.env.VITEST_POOL_ID ?? 1)}`

export async function createServer() {
  const args = {
    blockTime: '2ms',
    port,
  } satisfies Instance.tempo.Parameters

  return Server.create({
    instance: TestContainers.Instance.tempo({
      ...args,
      image: 'ghcr.io/tempoxyz/tempo:sha-580324a',
    }),
    port,
  })
}
