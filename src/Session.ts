import { Base64 } from 'ox'
import type { Address } from 'viem'

export type Session = {
  account: Address
  keyType: string
  feeToken: Address | undefined
  transfers: { token: Address; amount: string; symbol: string; decimals: number }[]
}

export function encode(session: Session): string {
  return Base64.fromString(JSON.stringify(session), { url: true })
}

export function decode(blob: string): Session {
  return JSON.parse(Base64.toString(blob))
}
