# Sui Move Project

## Prerequisites

Install Sui CLI:

```bash
cargo install --locked --git https://github.com/MystenLabs/sui.git --branch devnet sui
```

## Setup

```bash
cd contracts/sui
sui client switch --env devnet  # or testnet/mainnet
```

## Compilation

```bash
sui move build
```

## Testing

```bash
sui move test
```

## Deployment

### DevNet

```bash
sui client publish --gas-budget 100000000
```

### TestNet

```bash
sui client switch --env testnet
sui client publish --gas-budget 100000000
```

### MainNet

```bash
sui client switch --env mainnet
sui client publish --gas-budget 200000000
```

## After Deployment

1. Note the Package ID from the deployment output
2. Find the SafeRegistry object ID in the created objects
3. Update your `.env` file with these addresses

## Interacting with Contracts

### Create a Safe

```bash
# Example: Create a safe with SHA256 hash
sui client call \
  --package PACKAGE_ID \
  --module safe_record \
  --function create_and_register_safe_sha256 \
  --type-args 0x2::sui::SUI \
  --args REGISTRY_ID COIN_ID BENEFICIARY_ADDRESS "secret" 300000 \
  --gas-budget 10000000
```

### Withdraw from Safe

```bash
sui client call \
  --package PACKAGE_ID \
  --module safe_escrow \
  --function withdraw \
  --type-args 0x2::sui::SUI \
  --args SAFE_ID "secret" \
  --gas-budget 10000000
```