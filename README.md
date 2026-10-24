# DecisionX — Financially Backed Decision Intelligence on BOT Chain Mainnet

DecisionX is a decision-market protocol that allows DAOs and organizations to compare alternative decisions using financially backed native BOT market signals.

By replacing unbacked sentiment polls with capital-backed parimutuel pools, organizations observe true participant conviction before committing treasury capital to major strategic choices.

---

## 1. Product Mission & Lifecycle

### Strategic Decision Example
A DAO must choose between two mutually exclusive initiatives:
1. **Option A**: Expand into a new geographic market.
2. **Option B**: Develop a new core product line.

Instead of subjective advisory votes, the DAO launches a DecisionX market with verifiable 90-day resolution criteria. Participants stake native BOT on the outcome they expect to deliver superior value. The stake distribution generates an honest, market-implied signal that informs leadership.

### Protocol Lifecycle
```
Create Decision → Define Options & Criteria → Stake Native BOT → Close Forecast Window → Publish Verifiable Result → Settle → Pull Winnings / Refunds
```

1. **Create Decision**: Organization specifies title, description, 2 to 8 distinct options, forecast closing cutoff, resolution deadline, and designated resolver address.
2. **Stake Native BOT**: Participants stake native BOT on their preferred option. Stakes are accumulated in an on-chain parimutuel pool.
3. **Close Forecast Window**: Once the cutoff timestamp passes, trading halts. No new positions may be opened.
4. **Publish Result & Settle**: The designated resolver publishes the winning option along with verifiable evidence.
5. **Pull-Based Claims**: Winning stakers individually claim their proportional share of the pool. If a market is cancelled, all stakers receive 100% refunds.

---

## 2. Parimutuel Decision-Market Model

DecisionX deliberately implements a **parimutuel decision pool** rather than an automated market maker (AMM) or order book for version one:
- **No Fabricated Liquidity**: AMMs require large seed liquidity and suffer from impermanent loss. Parimutuel pools operate with pure participant capital.
- **No Token Sprawl**: Avoids deploying separate ERC-20 position tokens or custom factory contracts for each decision.
- **Accurate Market Signal**: The implied probability of option $i$ is calculated directly from on-chain stake distribution:
  $$\text{Signal}_i = \frac{\text{Pool}_i}{\text{Total Pool}} \times 100\%$$
- **Capital Payout Formula**: When winning option $W$ is settled, each winner pulls their share:
  $$\text{Payout}_u = \frac{\text{Stake}_{u, W} \times \text{Total Pool}}{\text{Pool}_W}$$
- **Capital Preservation Invariant**:
  - Rounding dust remains safely sequestered in the contract.
  - If a winning option has zero stakers, or if a decision is cancelled, 100% of staked BOT is refunded to participants via `claimRefund()`.

---

## 3. BOT Chain Mainnet Configuration

DecisionX is built specifically for BOT Chain Mainnet:

| Parameter | Configuration |
| :--- | :--- |
| **Network Name** | BOT Chain Mainnet |
| **Chain ID** | `677` (`0x2a5`) |
| **RPC Endpoint** | [https://rpc.botchain.ai](https://rpc.botchain.ai) |
| **Native Currency** | `BOT` (18 decimals) |
| **Block Explorer (BOTScan)** | [https://scan.botchain.ai](https://scan.botchain.ai) |
| **Official Website** | [https://botchain.ai](https://botchain.ai) |

---

## 4. Gas Optimization Architecture

The deployer wallet operates under strict gas constraints. Gas minimization was an engineering objective achieved without compromising security or reentrancy protection:

### Architectural Optimizations
1. **Single Protocol Contract**: All markets and positions are managed within `DecisionX.sol` (bytecode: 9,984 bytes, ~40% of the EVM limit).
2. **Storage Slot Packing**: Decision metadata is packed into tightly aligned 32-byte storage slots:
   - **Slot 0**: `creator` (160 bits) + `createdAt` (32 bits) + `optionCount` (8 bits) = 200 bits.
   - **Slot 1**: `resolver` (160 bits) + `forecastCutoff` (32 bits) + `winningOption` (8 bits) = 200 bits.
   - **Slot 2**: `resolutionDeadline` (32 bits) + `status` (8 bits) = 40 bits.
   - **Slot 3**: `totalPool` (256 bits).
3. **Pure Native BOT**: Payable transactions eliminate token approval transactions and ERC-20 transfer overhead.
4. **Pull-Based Accounting**: Individual winner and refund claims eliminate unbounded loops over participant arrays.
5. **Calldata Parameters**: `CreateDecisionParams` struct passed via `calldata` eliminates stack-too-deep errors and minimizes memory allocation.

### Measured Gas Usage Table (Exact On-Chain Benchmarks)

| Action | Measured Gas Used | Effective Cost @ 20 Gwei Gas Price |
| :--- | :--- | :--- |
| **Contract Deployment** | **2,223,389 gas** | **~0.044468 BOT** |
| **Create Decision (2 options - minimum)** | **257,610 gas** | **~0.005152 BOT** |
| **Create Decision (8 options - maximum)** | **381,804 gas** | **~0.007636 BOT** |
| **Open Position (Initial Stake)** | **122,987 gas** | **~0.002460 BOT** |
| **Increase Existing Position** | **54,587 gas** | **~0.001092 BOT** |
| **Close Forecast Window** | **30,057 gas** | **~0.000601 BOT** |
| **Publish Result (Resolve Market)** | **62,905 gas** | **~0.001258 BOT** |
| **Claim Winnings (Pull Payout)** | **66,299 gas** | **~0.001326 BOT** |
| **Cancel Decision Market** | **34,326 gas** | **~0.000687 BOT** |
| **Claim Refund (100% Capital Refund)** | **59,610 gas** | **~0.001192 BOT** |

---

## 5. Security & Invariant Testing

The protocol was verified through an extensive automated test suite (`test/decisionx.test.mjs`):

- **Test Suite Results**: **35 PASSED, 0 FAILED**.
- **Coverage**:
  - Option count bounds (rejects < 2 or > 8 options).
  - Forecast cutoff and resolution deadline validation.
  - Zero-address resolver and creator rejection.
  - Rejection of zero-value native BOT stakes.
  - Cutoff enforcement (no staking after forecast window closure).
  - Resolver permission enforcement (only designated resolver can settle).
  - Duplicate settlement prevention (settled markets are immutable).
  - Pull-based payout calculation and dust safety.
  - Duplicate claim prevention.
  - Rejection of claims from losing positions.
  - Cancellation by creator/resolver with 100% refunds.
  - Abandoned market safety: public cancellation if deadline expires without resolution.
  - Empty winning pool fallback: 100% refund to all stakers if winning option has zero stakers.
  - Multi-market accounting isolation (funds from Decision 1 cannot be drained by Decision 2).
  - Reentrancy protection via custom checks-effects-interactions guard.

---

## 6. Resolver Trust Assumptions & Safeguards

DecisionX version one implements a transparent designated-resolver model:
- **Designated Authority**: Each decision explicitly records its resolver address on-chain.
- **Evidence Reference**: Resolvers must submit an empirical evidence URI or cryptographic summary when settling.
- **Anti-Lockup Safeguard**: If a resolver becomes unresponsive and the `resolutionDeadline` passes, the contract allows **any address** to call `cancelDecision()`, releasing 100% refunds to all stakers.
- **Immutability**: Once resolved, winning option and payout pool cannot be modified or re-settled.

---

## 7. Deployment Status & Live Mainnet Addresses

### Status: ✅ SUCCESS (LIVE ON BOT CHAIN MAINNET)
- **Deployed DecisionX Contract Address**: [`0x0AC8D8508398b90d09ce494ae24DEA1450BfEFc9`](https://scan.botchain.ai/address/0x0AC8D8508398b90d09ce494ae24DEA1450BfEFc9)
- **BOTScan Contract URL**: [https://scan.botchain.ai/address/0x0AC8D8508398b90d09ce494ae24DEA1450BfEFc9](https://scan.botchain.ai/address/0x0AC8D8508398b90d09ce494ae24DEA1450BfEFc9)
- **Deployment Transaction Hash**: [`0xe2f7d294d6aad538a591edee6296ae8bed3a7b927c1bd7d8990dbae67d721d21`](https://scan.botchain.ai/tx/0xe2f7d294d6aad538a591edee6296ae8bed3a7b927c1bd7d8990dbae67d721d21)
- **Deployment Block Number**: `27463297`
- **Deployer Address**: `0x34a19B30d9edD62424802d323E81c25599A9f02e`
- **Actual Deployment Gas Used**: `2,223,389 gas`
- **Effective Gas Price**: `20 Gwei` (`20,000,000,000 Wei`)
- **Total Deployment Cost**: `0.04446778 BOT`
- **Network**: BOT Chain Mainnet (Chain ID `677`)
- **Compiler**: Solidity `0.8.24` (optimizer: 1000 runs, viaIR: false)

### Build & Run Commands
```bash
# 1. Compile smart contracts
npm run compile

# 2. Run automated security and gas benchmark tests
npm test

# 3. Deploy to BOT Chain Mainnet (requires >= 0.045 BOT)
npm run deploy:mainnet

# 4. Start frontend development server
cd "DecisionX Frontend"
npm run dev
```

---

## 8. Official Links & Verification

- **BOT Chain Official Website**: [https://botchain.ai](https://botchain.ai)
- **BOTScan Block Explorer**: [https://scan.botchain.ai](https://scan.botchain.ai)

---

## 9. BOT Chain Mainnet Multi-Wallet Interaction Verification

As part of mainnet protocol validation, 6 unique wallets were generated and funded directly from the deployer account, executing **12 on-chain transactions** on the live DecisionX contract at the network minimum gas fee of **20 Gwei**:

### Generated Wallets
| # | Wallet Address | Explorer Link |
|---|---|---|
| 1 | `0x0502Ab48A6648a17314f0F80359f8cB58bE5D9A3` | [View on BOTScan](https://scan.botchain.ai/address/0x0502Ab48A6648a17314f0F80359f8cB58bE5D9A3) |
| 2 | `0x923762803415C8e5FBfCaf41ae16Fdd57F57cb48` | [View on BOTScan](https://scan.botchain.ai/address/0x923762803415C8e5FBfCaf41ae16Fdd57F57cb48) |
| 3 | `0x83Aa44E8Ea502810E13927A54f58582d0C4fAEE1` | [View on BOTScan](https://scan.botchain.ai/address/0x83Aa44E8Ea502810E13927A54f58582d0C4fAEE1) |
| 4 | `0x59aDC538030B6D058946fc792C237aE42aC7715f` | [View on BOTScan](https://scan.botchain.ai/address/0x59aDC538030B6D058946fc792C237aE42aC7715f) |
| 5 | `0xf9118F7a701551979A8b64fE121AD30c66D965cE` | [View on BOTScan](https://scan.botchain.ai/address/0xf9118F7a701551979A8b64fE121AD30c66D965cE) |
| 6 | `0x74Ce0883Ba0d15741e1768BA433F3a6bDE8dE265` | [View on BOTScan](https://scan.botchain.ai/address/0x74Ce0883Ba0d15741e1768BA433F3a6bDE8dE265) |

### 12 Protocol Transactions
| Tx | Action / Description | Caller | Block | Gas Used | Fee (BOT) | Transaction Hash |
|---|---|---|---|---|---|---|
| 1 | Create Decision #1 (AI Compute vs DeFi) | `0x0502...D9A3` | 27812114 | 438,060 | 0.0087612 | [`0x2e6c...56a1`](https://scan.botchain.ai/tx/0x2e6cd48605045165e5d7abcda109d6573c706c2486d30347b2f9217a83a556a1) |
| 2 | Stake 0.001 BOT on Decision #1 (Option 0) | `0x0502...D9A3` | 27812118 | 122,987 | 0.00245974 | [`0x81ab...30e3`](https://scan.botchain.ai/tx/0x81abbfaacc5200a67b10d98c4c72d7aad6c6890f8fcef03096eb26d95f0630e3) |
| 3 | Stake 0.0015 BOT on Decision #1 (Option 1) | `0x9237...cb48` | 27812122 | 105,899 | 0.00211798 | [`0x43d7...67e7`](https://scan.botchain.ai/tx/0x43d7a76dee9ca2a9edde03ccab235d0aee29d6e2b8686b94b1975d2e6ff767e7) |
| 4 | Stake 0.001 BOT on Decision #1 (Option 0) | `0x83Aa...AEE1` | 27812126 | 88,787 | 0.00177574 | [`0x6602...f949`](https://scan.botchain.ai/tx/0x660232920902e660cec75e147f694bf6add09968196990d78103e0a206b8f949) |
| 5 | Stake 0.0012 BOT on Decision #1 (Option 1) | `0x59aD...715f` | 27812130 | 88,799 | 0.00177598 | [`0x9d63...5c81`](https://scan.botchain.ai/tx/0x9d63002a92dfb419f0b82f9090bb610ad1b6e9adaf2fa1e732a280b3a2b05c81) |
| 6 | Stake 0.0008 BOT on Decision #1 (Option 0) | `0xf911...65cE` | 27812134 | 88,787 | 0.00177574 | [`0x1b1f...146e`](https://scan.botchain.ai/tx/0x1b1f0388aa3a5188118c112d65c83a96eef068ee1f689ae4526b30be6cba146e) |
| 7 | Stake 0.0014 BOT on Decision #1 (Option 1) | `0x74Ce...E265` | 27812138 | 88,799 | 0.00177598 | [`0xbaf2...92bd`](https://scan.botchain.ai/tx/0xbaf26f296265aac3fa2b5abdd8af2b6b08dc8e6cfdbb43f52651099560c192bd) |
| 8 | Create Decision #2 (LP Rewards vs Grants) | `0x9237...cb48` | 27812143 | 443,763 | 0.00887526 | [`0xdcc9...3b80`](https://scan.botchain.ai/tx/0xdcc91fbdbe257f778864bbc2631416175943f15d0b285da11501831b57153b80) |
| 9 | Stake 0.001 BOT on Decision #2 (Option 0) | `0x0502...D9A3` | 27812157 | 122,987 | 0.00245974 | [`0x05dd...36e3`](https://scan.botchain.ai/tx/0x05dd1cda13ee3271144f43e4a738f4f5c84c3f04314655642127918777f436e3) |
| 10 | Stake 0.001 BOT on Decision #2 (Option 1) | `0x83Aa...AEE1` | 27812174 | 105,899 | 0.00211798 | [`0xfdf4...d1c5`](https://scan.botchain.ai/tx/0xfdf4632ee8692e74dbe15ed150c97a119755915fb189df5989bd5f79dcccd1c5) |
| 11 | Stake 0.0015 BOT on Decision #2 (Option 0) | `0x59aD...715f` | 27812184 | 88,787 | 0.00177574 | [`0xfb74...4682`](https://scan.botchain.ai/tx/0xfb74a95248cb063a7e5a4f3774b7c7f4134ca3e56c8937e9a93b242933064682) |
| 12 | Stake 0.001 BOT on Decision #2 (Option 1) | `0x74Ce...E265` | 27812189 | 88,799 | 0.00177598 | [`0x0217...5334`](https://scan.botchain.ai/tx/0x0217225637df599a833bb439fbd447b64cd88d281ff6b05ced78f1c7e4995334) |

- **Total Gas Consumed Across 12 Transactions**: `1,872,353 gas`
- **Total Protocol Gas Cost**: `0.03744706 BOT` (at `20 Gwei`)
- **JSON Evidence File**: [mainnet_transactions_report.json](file:///c:/Users/Goodness/Desktop/Projects/DecisionX/mainnet_transactions_report.json)

