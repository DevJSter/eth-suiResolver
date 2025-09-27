# Fusion+ Cross-Chain Resolver Service

A comprehensive resolver/relayer service for bidirectional cross-chain atomic swaps using HTLCs (Hash Time Locked Contracts). Each swap deploys dedicated escrow contracts on both chains that automatically handle locking, claiming, and cleanup.

## 🌟 Key Features

### Bidirectional Swap Architecture
- **Individual Escrows per Swap**: Each swap gets its own dedicated escrow contracts on both chains
- **Automatic Cleanup**: Escrows self-destruct after completion or timeout
- **Atomic Execution**: Either both sides complete successfully or both revert
- **Cross-Chain Secret Sharing**: Secrets revealed on one chain automatically enable claims on the other

### Resolver Capabilities
- **Automated Monitoring**: Continuously monitors both chains for swap events
- **Intelligent Response**: Automatically creates matching escrows when users initiate swaps
- **Risk Management**: Built-in safety checks and timelock validation
- **Recovery Mechanisms**: Emergency refund and cleanup procedures

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐
│   Ethereum      │    │      Sui       │
│   Network       │    │   Network      │
├─────────────────┤    ├─────────────────┤
│ SwapEscrowFactory│    │SwapEscrowFactory│
│ - Create Escrows │    │ - Create Escrows│
│ - Track Resolvers│    │ - Track Resolvers│
│                 │    │                 │
│   SwapEscrow    │    │   SwapEscrow    │
│ - User Side     │    │ - Resolver Side │
│ - Resolver Side │    │ - User Side     │
│ - Auto-cleanup  │    │ - Auto-cleanup  │
└─────────────────┘    └─────────────────┘
         │                       │
         └───────────────────────┘
                   │
         ┌─────────────────┐
         │ Resolver Service │
         │ - Event Monitor  │
         │ - Swap Processor │
         │ - Risk Manager  │
         │ - Auto Executor │
         └─────────────────┘
```

## 🔄 Swap Flow

### 1. User Initiates Swap
```typescript
// User calls SwapEscrowFactory on source chain (e.g., Ethereum)
createSwapEscrow(
  swapId,           // Unique identifier
  resolverAddress,  // Chosen resolver
  secretHash,       // H(secret)
  userTimelock,     // T_user (longer)
  resolverTimelock  // T_resolver (shorter)
)
```

### 2. Resolver Detects and Responds
- Resolver monitors for `SwapEscrowCreated` events
- Creates matching escrow on destination chain (e.g., Sui)
- Waits for user to lock funds first

### 3. User Locks Funds
```solidity
// User locks their ETH in the escrow
swapEscrow.lockUserSide(ETH_ADDRESS, amount);
```

### 4. Resolver Locks Matching Funds
```move
// Resolver locks SUI in destination escrow
sui_swap_escrow::lock_resolver_side(escrow, amount_coin, clock, ctx);
```

### 5. User Claims on Destination Chain
```move
// User reveals secret to claim SUI
sui_swap_escrow::claim_funds(escrow, secret, 1, clock, ctx);
```

### 6. Automatic Cross-Chain Completion
- Secret is revealed in Sui transaction
- Resolver monitors and extracts the secret
- Automatically claims original ETH using the same secret
- Both escrows self-destruct after completion

## 📂 Project Structure

```
packages/
├── contracts/                 # Ethereum contracts
│   ├── src/
│   │   ├── SwapEscrow.sol            # Individual swap escrow
│   │   ├── SwapEscrowFactory.sol     # Factory for creating escrows
│   │   └── EthereumFusionEscrow.sol  # Legacy HTLC contract
│   └── script/
│       └── DeployDev.s.sol
│
├── sui-modules/              # Sui Move modules
│   └── fusion_plus/
│       └── sources/
│           ├── sui_swap_escrow.move     # Individual swap escrow
│           └── sui_escrow.move          # Legacy HTLC module
│
└── resolver/                 # TypeScript resolver service
    ├── src/
    │   ├── blockchain/
    │   │   └── providers.ts           # Chain connection managers
    │   ├── services/
    │   │   └── ResolverService.ts     # Main resolver logic
    │   ├── database/
    │   │   └── index.ts               # SQLite database layer
    │   ├── api/                       # HTTP API endpoints
    │   ├── config/                    # Configuration management
    │   └── utils/                     # Logging and utilities
    └── package.json
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Foundry (for Ethereum contracts)
- Sui CLI (for Sui modules)
- SQLite3

### 1. Install Dependencies
```bash
cd packages/resolver
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Deploy Contracts
```bash
# Deploy Ethereum contracts
cd packages/contracts
forge script script/DeployDev.s.sol --rpc-url $ETH_RPC_URL --broadcast

# Deploy Sui modules
cd packages/sui-modules/fusion_plus
sui client publish --gas-budget 100000000
```

### 4. Start Resolver Service
```bash
cd packages/resolver
npm run build
npm start
```

## 🔧 Configuration

### Environment Variables
```bash
# Network Configuration
ETHEREUM_RPC_URL=http://localhost:8545
ETHEREUM_PRIVATE_KEY=0x...
ETHEREUM_ESCROW_ADDRESS=0x...

SUI_RPC_URL=https://fullnode.devnet.sui.io:443
SUI_PRIVATE_KEY=0x...
SUI_PACKAGE_ID=0x...

# Resolver Settings
RESOLVER_STAKE_AMOUNT=1000000000  # 1 SUI/ETH
MIN_PROFIT_MARGIN=0.1
MAX_CONCURRENT_SWAPS=10

# Safety Settings
MAX_SWAP_AMOUNT=100000000000000000000  # 100 ETH/SUI
MIN_TIMELOCK_BUFFER=1800000            # 30 minutes
```

## 🛡️ Security Features

### Timelock Safety
- **T_resolver < T_user**: Resolver timelock must be shorter than user timelock
- **Minimum Buffer**: 30-minute minimum difference prevents race conditions
- **Maximum Duration**: 24-hour maximum prevents indefinite locks

### Stake Requirements
- Resolvers must stake minimum amounts on both chains
- Stakes are slashed for malicious behavior
- Automatic stake verification before swap creation

### Emergency Mechanisms
- Force refund after extended timeouts
- Emergency cleanup for stuck contracts
- Circuit breakers for unusual activity

## 📊 API Endpoints

### Health Check
```bash
GET /api/health
```

### Active Swaps
```bash
GET /api/swaps
```

### Specific Swap
```bash
GET /api/swaps/:swapId
```

### Resolver Stats
```bash
GET /api/swaps/stats/overview
```

## 🧪 Testing

### Run Contract Tests
```bash
cd packages/contracts
forge test
```

### Run Sui Tests
```bash
cd packages/sui-modules/fusion_plus
sui move test
```

### Run Resolver Tests
```bash
cd packages/resolver
npm test
```

## 📈 Monitoring

The resolver service provides comprehensive monitoring:

- **Swap Lifecycle Tracking**: Monitor each swap from creation to completion
- **Cross-Chain Event Correlation**: Link events across both chains
- **Performance Metrics**: Track completion times and success rates
- **Error Handling**: Detailed logging for debugging
- **Health Checks**: Continuous monitoring of chain connections

## 🔄 Bidirectional Flow Example

```typescript
// Example: ETH -> SUI swap

// 1. User creates swap on Ethereum
const swapId = "0x123...";
await ethFactory.createSwapEscrow(
  swapId,
  resolverAddress,
  secretHash,
  Date.now() + 86400000,  // 24 hours
  Date.now() + 82800000   // 23 hours
);

// 2. User locks ETH
await ethEscrow.lockUserSide(ETH_ADDRESS, ethers.parseEther("1"));

// 3. Resolver automatically creates matching Sui escrow
// 4. Resolver locks equivalent SUI

// 5. User claims SUI by revealing secret
await suiEscrow.claim_funds(secret, 1, clock, ctx);

// 6. Resolver automatically claims ETH using revealed secret
await ethEscrow.claimFunds(secret, 0);

// 7. Both escrows self-destruct ✅
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

---

**Built with ❤️ for the cross-chain future**