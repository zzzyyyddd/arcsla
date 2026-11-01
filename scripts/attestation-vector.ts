/**
 * Produces a golden EIP-712 vector using the frontend's own typed-data
 * definition and viem. The Foundry suite embeds this output to prove the
 * browser signing path and the contract agree byte for byte.
 *
 *   bun run scripts/attestation-vector.ts
 *
 * The private key below is a public test key (never holds value).
 */
import { hashTypedData, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ATTESTATION_DOMAIN_NAME, ATTESTATION_DOMAIN_VERSION, FULFILLMENT_TYPES } from '../src/lib/fulfillment-types'

const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const account = privateKeyToAccount(privateKey)

const domain = {
  name: ATTESTATION_DOMAIN_NAME,
  version: ATTESTATION_DOMAIN_VERSION,
  chainId: 5042002,
  verifyingContract: '0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47',
} as const

const message = {
  agreementId: 7n,
  specHash: keccak256(toBytes('spec')),
  provider: '0x0000000000000000000000000000000000b0b001',
  evidenceHash: keccak256(toBytes('evidence')),
  expiry: 1900000000n,
} as const

const digest = hashTypedData({ domain, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message })
const signature = await account.signTypedData({ domain, types: FULFILLMENT_TYPES, primaryType: 'Fulfillment', message })

console.log(
  JSON.stringify(
    {
      verifier: account.address,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
      agreementId: message.agreementId.toString(),
      specHash: message.specHash,
      provider: message.provider,
      evidenceHash: message.evidenceHash,
      expiry: message.expiry.toString(),
      digest,
      signature,
    },
    null,
    2,
  ),
)
