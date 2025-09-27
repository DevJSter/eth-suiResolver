# ETH-wSUI Swap Protocol

An EVM-based atomic swap protocol for exchanging ETH and wrapped SUI (wSUI) tokens using Hash Time Locked Contracts (HTLC).

## 🎯 Overview

This project implements a trustless atomic swap system that allows users to exchange ETH for wSUI tokens and vice versa on Ethereum-compatible networks. The system uses cryptographic hash locks and time locks to ensure atomic transactions without requiring trusted third parties.

## 🏗️ Architecture

### Core Components

1. **WSUIToken.sol** - ERC20 token representing wrapped SUI on Ethereum
2. **ETHWSUISwap.sol** - Main swap contract implementing HTLC functionality
3. **Swap Service** - Node.js API service for managing swaps
4. **Frontend Interface** - Web interface for users (coming soon)

### Key Features

- ✅ **Atomic Swaps**: Either both parties get their tokens or both can refund
- ✅ **Hash-Locked Security**: SHA256 cryptographic security
- ✅ **Time-Locked Safety**: Automatic refunds after timeout
- ✅ **Fee System**: Configurable swap fees with recipient
- ✅ **Emergency Controls**: Pause/unpause functionality
- ✅ **Multi-Network**: Supports Ethereum, Polygon, BSC, etc.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Hardhat
- MetaMask or similar wallet

### Installation

```bash
# Navigate to the EVM swap project
cd evm-eth-wsui-swap

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### Local Development

```bash
# Start local Hardhat node
npm run node

# In another terminal, deploy contracts
npm run deploy:localhost

# Start the API service
npm start
```

### Testing

```bash
# Run contract tests
npm test

# Run with coverage
npm run coverage

# Check contract sizes
npm run size
```

## 📋 API Endpoints

### Core Endpoints

- `GET /health` - Service health check
- `POST /quote` - Get swap quote
- `POST /swap/initiate` - Initiate a new swap
- `GET /swap/:swapId` - Get swap status
- `POST /swap/:swapId/withdraw` - Withdraw from swap
- `GET /swaps` - List all active swaps

### Example Usage

#### Get Swap Quote
```bash
curl -X POST http://localhost:3000/quote \
  -H "Content-Type: application/json" \
  -d '{
    "fromToken": "ETH",
    "toToken": "wSUI",
    "amount": "1"
  }'
```

#### Create Demo Swap
```bash
curl -X POST http://localhost:3000/demo/create-swap
```

## 🔄 How Atomic Swaps Work

### ETH → wSUI Swap Flow

1. **Alice** wants to exchange 1 ETH for 1000 wSUI
2. **Bob** has 1000 wSUI and wants 1 ETH
3. **Setup Phase**:
   - Alice generates a secret and its SHA256 hash
   - Alice locks 1 ETH in the swap contract with Bob as beneficiary
   - Bob locks 1000 wSUI in the swap contract with Alice as beneficiary
4. **Execution Phase**:
   - Alice reveals the secret to claim Bob's 1000 wSUI
   - Bob uses the revealed secret to claim Alice's 1 ETH
5. **Safety Mechanisms**:
   - If timelock expires, both parties can refund their tokens
   - If secret is never revealed, no tokens are permanently lost

### Security Properties

- **Atomicity**: Either both swaps succeed or both can be refunded
- **Trustless**: No third party can steal or block funds
- **Hash-Locked**: Only correct secret can unlock funds
- **Time-Locked**: Automatic refund protection

## 📊 Contract Details

### WSUIToken (ERC20)

- **Name**: Wrapped SUI
- **Symbol**: wSUI
- **Decimals**: 9 (matches SUI)
- **Features**: Mint/burn functionality, pausable, access control

### ETHWSUISwap

- **Swap Types**: ETH→wSUI and wSUI→ETH
- **Fee**: 0.3% (30 basis points, configurable)
- **Timelock Range**: 1 hour to 48 hours
- **Hash Function**: SHA256 for cross-chain compatibility

## 🛠️ Development

### Contract Compilation

```bash
# Compile contracts
npm run compile

# Flatten for verification
npm run flatten
```

### Deployment

```bash
# Deploy to localhost
npm run deploy:localhost

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Deploy to mainnet (BE CAREFUL!)
npm run deploy:mainnet
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test test/ETHWSUISwap.test.js

# Run with gas reporting
REPORT_GAS=true npm test
```

## 🔐 Security Features

### Smart Contract Security

- **ReentrancyGuard**: Prevents reentrancy attacks
- **Pausable**: Emergency stop functionality
- **Access Control**: Owner-only admin functions
- **Input Validation**: Comprehensive parameter checking
- **Safe Math**: Using Solidity 0.8.19 built-in overflow protection

### Operational Security

- **Timelock Validation**: Enforced minimum/maximum timelock periods
- **Secret Verification**: SHA256 hash verification
- **Emergency Functions**: Owner can pause and withdraw in emergencies
- **Fee Limits**: Maximum fee cap prevents excessive fees

## 🌐 Network Support

### Currently Supported

- **Ethereum Mainnet**
- **Ethereum Sepolia** (testnet)
- **Polygon**
- **Binance Smart Chain**
- **Local Hardhat Network**

### Easy to Add

- Any EVM-compatible network
- Just update `hardhat.config.js`
- Add network-specific RPC and explorer APIs

## 📈 Future Enhancements

- [ ] Frontend web interface
- [ ] Mobile app integration
- [ ] Additional token pairs
- [ ] Cross-chain bridges integration
- [ ] Advanced fee structures
- [ ] Automated market making
- [ ] Liquidity provider rewards

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## ⚠️ Disclaimers

- This is experimental software
- Use at your own risk
- Always test on testnets first
- Smart contracts are immutable once deployed
- Keep your private keys secure

## 🆘 Support

- Open an issue on GitHub
- Join our Discord community
- Check the documentation wiki
- Review test files for usage examples

---

**Built with ❤️ by meowGloball**