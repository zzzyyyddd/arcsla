import type { Address } from 'viem'

/**
 * Live Arc Testnet runbook (T1 on agreement #4 with a 60-minute deadline; optional T1b on agreement #5).
 * Agreement #3 was used by an earlier create-and-refund run and is not tracked here. These are the project owner's own testnet wallets,
 * taken from the confirmed lifecycle transactions. They are PRE-FILLED SUGGESTIONS only: the
 * Create form lets you change every field, and nothing here ever signs or sends anything.
 */
export const RUNBOOK_WALLETS = {
  customer: '0xCfEfEc595970C6850777ac44A99Dd949fAc472A6',
  provider: '0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc',
  verifier: '0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3',
} as const satisfies Record<string, Address>

export interface RunbookPreset {
  key: 't1' | 't1b'
  /** The agreement ID this test expects, assuming it is created next. */
  expectedId: bigint
  amount: string
  deadlineMinutes: number
  description: string
}

export const RUNBOOK_PRESETS: Record<'t1' | 't1b', RunbookPreset> = {
  t1: {
    key: 't1',
    expectedId: 4n,
    amount: '0.10',
    deadlineMinutes: 60,
    description: 'ArcSLA Arc Testnet evidence T1: verified release of 0.10 test USDC',
  },
  t1b: {
    key: 't1b',
    expectedId: 5n,
    amount: '0.10',
    deadlineMinutes: 5,
    description: 'ArcSLA Arc Testnet evidence T1b: deadline refund of 0.10 test USDC',
  },
}

export function isPresetKey(value: string | null): value is 't1' | 't1b' {
  return value === 't1' || value === 't1b'
}
