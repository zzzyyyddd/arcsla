/**
 * EIP-712 type definition for the ArcSLA fulfillment attestation. Kept free of
 * app imports so scripts and tests can load it outside Vite.
 *
 * Must match ArcSLA.FULFILLMENT_TYPEHASH:
 * Fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expiry)
 */
export const FULFILLMENT_TYPES = {
  Fulfillment: [
    { name: 'agreementId', type: 'uint256' },
    { name: 'specHash', type: 'bytes32' },
    { name: 'provider', type: 'address' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const

export const ATTESTATION_DOMAIN_NAME = 'ArcSLA'
export const ATTESTATION_DOMAIN_VERSION = '1'
