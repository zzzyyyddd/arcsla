/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 *
 * The app chain is selected by VITE_ARC_CHAIN_ID (default: Arc Testnet) and is
 * described by the generated `@/onchain-facts` registry.
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { defineChain, type Chain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { CHAIN } from './lib/env'

const appChain: Chain =
  CHAIN.chainId === arcTestnet.id
    ? arcTestnet
    : defineChain({
        id: CHAIN.chainId,
        name: CHAIN.name,
        nativeCurrency: {
          name: CHAIN.nativeCurrency.symbol,
          symbol: CHAIN.nativeCurrency.symbol,
          decimals: CHAIN.nativeCurrency.decimals,
        },
        rpcUrls: { default: { http: CHAIN.rpcUrls } },
        blockExplorers: { default: { name: 'Explorer', url: CHAIN.explorerBase } },
        testnet: CHAIN.isTestnet,
      })

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(appChain.id, appChain.rpcUrls.default.http[0])

export const config = createConfig({
  chains: [appChain, mainnet] as const, // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [appChain.id]: http(CHAIN.rpcUrls[0]),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
