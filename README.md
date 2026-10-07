# TrustGraph

TrustGraph is a responsive interface for weighted, wallet-native freelancer reputation.

## Run locally

```sh
npm install
npm run dev
```

## Configure

Paste a deployed contract address into the dashboard and save it. The address persists in local storage.
Choose Sepolia, Ethereum, or Base for public reads. Connect MetaMask on a supported network to submit transactions.
Only the connected contract owner can add anchors. The sybil simulator is an offline visual demo and never calls the chain.

## Source map

- `src/Dashboard.tsx`: wallet, contract, profile, graph, and simulator workflows.
- `src/components/`: React Bits Aurora, CountUp, and Click Spark source.
- `src/wagmi.ts` and `src/main.tsx`: MetaMask connector and application providers.
- `src/dashboard.css`: responsive glass UI, network graph, and motion styling.

## Validate

```sh
npm run build
npm run lint
```
