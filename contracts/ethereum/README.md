# Foundry Ethereum Project

## Installation

First, install Foundry:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Setup

```bash
cd contracts/ethereum
forge install
```

## Compilation

```bash
forge build
```

## Testing

```bash
forge test
forge test -vvv  # verbose output
```

## Deployment

### Local deployment (Anvil)

```bash
# Start local node
anvil

# Deploy contracts
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```

### Testnet deployment (Sepolia)

```bash
# Set environment variables
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_PROJECT_ID"
export PRIVATE_KEY="your_private_key"

# Deploy
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

## Contract Addresses

After deployment, the addresses will be saved to `deployment.env`

## Verification

```bash
forge verify-contract --chain sepolia --compiler-version v0.8.19 CONTRACT_ADDRESS src/SafeRecord.sol:SafeRecord --etherscan-api-key YOUR_ETHERSCAN_API_KEY
```