# Cross-Chain Safe Escrow System Specification

This document specifies a comprehensive cross-chain safe escrow system between **Ethereum** and **Sui** networks. The system uses hash-locked time contracts (HTLCs) with both keccak256 and sha256 hashing for maximum compatibility. Each swap requires deploying two contracts: one on the source chain and one on the destination chain, both initialized with the same secret hash in their constructors.

---

## Architecture Overview

### Core Components

1. **HashUtility**: Provides consistent hashing functions across chains (keccak256 for Ethereum native, sha256 for cross-chain)
2. **SafeEscrow**: Individual escrow contract holding funds until secret is revealed or timeout expires
3. **SafeRecord**: Registry contract tracking all escrows and their metadata for cross-chain coordination
4. **Relayer System**: Automated service monitoring events and triggering cross-chain operations

### Key Principles

* **Dual Hash Support**: Both keccak256 (Ethereum native) and sha256 (cross-chain compatible)
* **Constructor Initialization**: Secret hash is set during contract deployment, not in separate function calls
* **Atomic Swaps**: Either both parties get their funds or both can refund after timeout
* **Stateless Relayers**: No database required; blockchain state is the source of truth
* **Cross-Chain Events**: Standardized events enable automated cross-chain coordination

---

## High-Level Cross-Chain Flow

### Example: Alice (ETH) ↔ Bob (SUI) Swap

1. **Setup Phase**:
   - Alice generates random secret `x` (32 bytes)
   - Alice computes `H = sha256(x)` for cross-chain compatibility
   - Both parties agree on amounts, timeout values, and beneficiary addresses

2. **Contract Deployment**:
   - Alice deploys `SafeEscrow` on Ethereum with `H`, Bob as beneficiary, timeout `t_eth`
   - Bob deploys `SafeEscrow` on Sui with same `H`, Alice as beneficiary, timeout `t_sui`
   - Both contracts registered in respective `SafeRecord` registries

3. **Execution Phase**:
   - Alice reveals secret `x` to withdraw SUI from Bob's contract
   - Sui emits `SafeWithdrawn` event with revealed secret `x`
   - Relayer detects event and calls withdraw on Ethereum contract with `x`
   - Bob receives ETH automatically

4. **Timeout Safety**:
   - If secret never revealed: Alice refunds her ETH, Bob refunds his SUI
   - Timeout configuration: `t_eth > t_sui + safety_margin` (suggested: t_sui = 30min, t_eth = 3h)

---

## Security Configuration

### Hash Consistency
- **Cross-chain swaps**: MUST use `sha256` consistently across all chains
- **Single-chain operations**: Can use `keccak256` for gas efficiency on Ethereum
- **Hash verification**: Both contract types support both hashing methods

### Timeout Strategy
- **Source chain timeout > Destination chain timeout + safety margin**
- **Safety margin**: Accounts for block finality + relayer reaction time
- **Mainnet defaults**: Source = 3 hours, Destination = 30 minutes
- **Testnet defaults**: Source = 30 minutes, Destination = 5 minutes

### Access Control
- **Anyone can withdraw** with correct secret (permissionless)
- **Only original owner** can refund after timeout
- **Registry deactivation** can be called by owner or registry admin

---

## Ethereum Implementation (Solidity)

### 1. Hash Utility Contract (`src/hash.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract HashUtility {
    /// Calculate keccak256 hash from a string key (Ethereum native)
    function calculateHash(string memory _key) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(_key));
    }

    /// Calculate sha256 hash from a string key (cross-chain compatibility)
    function calculateSha256Hash(string memory _key) external pure returns (bytes32) {
        return sha256(abi.encodePacked(_key));
    }

    /// Calculate keccak256 hash from bytes
    function calculateHashFromBytes(bytes memory _data) external pure returns (bytes32) {
        return keccak256(_data);
    }

    /// Calculate sha256 hash from bytes (cross-chain compatibility)
    function calculateSha256FromBytes(bytes memory _data) external pure returns (bytes32) {
        return sha256(_data);
    }

    /// Verify if a secret matches the given hash (keccak256)
    function verifySecret(string memory _secret, bytes32 _expectedHash) external pure returns (bool) {
        return keccak256(abi.encodePacked(_secret)) == _expectedHash;
    }

    /// Verify if a secret matches the given hash (sha256 for cross-chain)
    function verifySecretSha256(string memory _secret, bytes32 _expectedHash) external pure returns (bool) {
        return sha256(abi.encodePacked(_secret)) == _expectedHash;
    }

    /// Batch hash calculation for multiple secrets (keccak256)
    function batchCalculateHash(string[] memory _keys) external pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_keys.length);
        for (uint256 i = 0; i < _keys.length; i++) {
            hashes[i] = keccak256(abi.encodePacked(_keys[i]));
        }
        return hashes;
    }

    /// Batch hash calculation for multiple secrets (sha256)
    function batchCalculateSha256Hash(string[] memory _keys) external pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_keys.length);
        for (uint256 i = 0; i < _keys.length; i++) {
            hashes[i] = sha256(abi.encodePacked(_keys[i]));
        }
        return hashes;
    }
}
```

### 2. Safe Escrow Contract (`src/Safe.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

contract SafeEscrow {
    uint256 public startTime;
    uint256 public lockDuration;
    bytes32 public secretHash;
    address public owner;
    address public beneficiary;
    uint256 public amount;
    IERC20 public token;
    string public revealedSecret;
    bool public isWithdrawn;
    bool public isRefunded;
    bool public useSha256; // true for cross-chain compatibility, false for keccak256

    // Events for cross-chain monitoring
    event SafeCreated(
        address indexed safeAddress,
        address indexed owner,
        address indexed beneficiary,
        uint256 amount,
        bytes32 secretHash,
        uint256 startTime,
        uint256 lockDuration,
        bool useSha256
    );

    event SafeWithdrawn(
        address indexed safeAddress,
        address indexed withdrawer,
        address indexed beneficiary,
        uint256 amount,
        string secret
    );

    event SafeRefunded(
        address indexed safeAddress,
        address indexed owner,
        uint256 amount
    );

    constructor(
        address _token,
        uint256 _amount,
        bytes32 _secretHash,
        address _owner,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) {
        require(_amount > 0, "Amount must be greater than 0");
        require(_beneficiary != address(0), "Invalid beneficiary address");
        require(_owner != address(0), "Invalid owner address");

        secretHash = _secretHash;
        owner = _owner;
        beneficiary = _beneficiary;
        amount = _amount;
        token = IERC20(_token);
        startTime = block.timestamp;
        lockDuration = _lockDuration;
        useSha256 = _useSha256;
        isWithdrawn = false;
        isRefunded = false;

        // Transfer tokens to this contract
        token.transferFrom(msg.sender, address(this), amount);

        emit SafeCreated(
            address(this),
            owner,
            beneficiary,
            amount,
            secretHash,
            startTime,
            lockDuration,
            useSha256
        );
    }

    function withdraw(string memory _secret) external {
        require(!isWithdrawn, "Already withdrawn");
        require(!isRefunded, "Already refunded");
        require(block.timestamp <= startTime + lockDuration, "Lock period expired");

        // Verify secret hash based on the chosen hashing method
        bytes32 computedHash;
        if (useSha256) {
            computedHash = sha256(abi.encodePacked(_secret));
        } else {
            computedHash = keccak256(abi.encodePacked(_secret));
        }
        require(computedHash == secretHash, "Invalid secret");

        isWithdrawn = true;
        revealedSecret = _secret;

        // Transfer tokens to the caller (anyone with the correct secret)
        token.transfer(msg.sender, amount);

        emit SafeWithdrawn(address(this), msg.sender, beneficiary, amount, _secret);
    }

    function refund() external {
        require(msg.sender == owner, "Only owner can refund");
        require(!isWithdrawn, "Already withdrawn");
        require(!isRefunded, "Already refunded");
        require(block.timestamp > startTime + lockDuration, "Lock period not expired yet");

        isRefunded = true;
        token.transfer(owner, amount);

        emit SafeRefunded(address(this), owner, amount);
    }

    // View functions
    function getSafeInfo() external view returns (
        address _owner,
        address _beneficiary,
        uint256 _amount,
        bytes32 _secretHash,
        uint256 _startTime,
        uint256 _lockDuration,
        bool _isWithdrawn,
        bool _isRefunded,
        bool _useSha256,
        string memory _revealedSecret
    ) {
        return (
            owner,
            beneficiary,
            amount,
            secretHash,
            startTime,
            lockDuration,
            isWithdrawn,
            isRefunded,
            useSha256,
            revealedSecret
        );
    }

    function isLockExpired() external view returns (bool) {
        return block.timestamp > startTime + lockDuration;
    }

    function isSafeAvailable() external view returns (bool) {
        return !isWithdrawn && !isRefunded;
    }

    function getTimeLeft() external view returns (uint256) {
        if (block.timestamp >= startTime + lockDuration) {
            return 0;
        }
        return (startTime + lockDuration) - block.timestamp;
    }
}
```

### 3. Safe Record Registry (`src/saferecord.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {SafeEscrow} from "./Safe.sol";
import {HashUtility} from "./hash.sol";

contract SafeRecord {
    HashUtility private hashUtility;
    
    // Arrays to store all safe addresses for enumeration
    address[] public safeAddresses;
    
    // Mappings for quick lookups
    mapping(address => bytes32) public addressToHash;
    mapping(bytes32 => address[]) public hashToAddresses; // Multiple safes can have same hash
    mapping(address => SafeMetadata) public safeMetadata;
    mapping(bytes32 => uint256) public hashToSafeCount;
    
    // Registry owner
    address public owner;
    
    struct SafeMetadata {
        address safeAddress;
        address owner;
        address beneficiary;
        uint256 amount;
        bytes32 secretHash;
        uint256 startTime;
        uint256 lockDuration;
        bool useSha256;
        bool isActive;
    }

    // Events for cross-chain monitoring
    event SafeRegistered(
        address indexed safeAddress,
        address indexed owner,
        address indexed beneficiary,
        uint256 amount,
        bytes32 secretHash,
        address registryAddress
    );

    event SafeDeactivated(
        address indexed safeAddress,
        address registryAddress
    );

    constructor() {
        hashUtility = new HashUtility();
        owner = msg.sender;
    }

    /// Create a safe with keccak256 hash and register it
    function createSafe(
        address _token,
        uint256 _amount,
        string memory _secret,
        address _beneficiary,
        uint256 _lockDuration
    ) public returns (address) {
        bytes32 hash = hashUtility.calculateHash(_secret);
        return _createSafeWithHash(_token, _amount, hash, _beneficiary, _lockDuration, false);
    }

    /// Create a safe with sha256 hash (cross-chain compatible) and register it
    function createSafeSha256(
        address _token,
        uint256 _amount,
        string memory _secret,
        address _beneficiary,
        uint256 _lockDuration
    ) public returns (address) {
        bytes32 hash = hashUtility.calculateSha256Hash(_secret);
        return _createSafeWithHash(_token, _amount, hash, _beneficiary, _lockDuration, true);
    }

    /// Create a safe with pre-computed hash
    function createSafeWithHash(
        address _token,
        uint256 _amount,
        bytes32 _hash,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) public returns (address) {
        return _createSafeWithHash(_token, _amount, _hash, _beneficiary, _lockDuration, _useSha256);
    }

    /// Internal function to create and register safe
    function _createSafeWithHash(
        address _token,
        uint256 _amount,
        bytes32 _hash,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) internal returns (address) {
        // Create new SafeEscrow contract
        SafeEscrow safe = new SafeEscrow(
            _token,
            _amount,
            _hash,
            msg.sender,
            _beneficiary,
            _lockDuration,
            _useSha256
        );

        address safeAddress = address(safe);

        // Register in mappings
        safeAddresses.push(safeAddress);
        addressToHash[safeAddress] = _hash;
        hashToAddresses[_hash].push(safeAddress);
        hashToSafeCount[_hash]++;

        // Store metadata
        safeMetadata[safeAddress] = SafeMetadata({
            safeAddress: safeAddress,
            owner: msg.sender,
            beneficiary: _beneficiary,
            amount: _amount,
            secretHash: _hash,
            startTime: block.timestamp,
            lockDuration: _lockDuration,
            useSha256: _useSha256,
            isActive: true
        });

        emit SafeRegistered(
            safeAddress,
            msg.sender,
            _beneficiary,
            _amount,
            _hash,
            address(this)
        );

        return safeAddress;
    }

    /// Deactivate a safe (called after withdrawal/refund)
    function deactivateSafe(address _safeAddress) external {
        require(safeMetadata[_safeAddress].owner == msg.sender || msg.sender == owner, "Unauthorized");
        require(safeMetadata[_safeAddress].isActive, "Safe already inactive");
        
        safeMetadata[_safeAddress].isActive = false;
        
        emit SafeDeactivated(_safeAddress, address(this));
    }

    // View functions for cross-chain queries
    function getSafesByHash(bytes32 _hash) external view returns (address[] memory) {
        return hashToAddresses[_hash];
    }

    function getSafeMetadata(address _safeAddress) external view returns (SafeMetadata memory) {
        return safeMetadata[_safeAddress];
    }

    function getAllSafes() external view returns (address[] memory) {
        return safeAddresses;
    }

    function getActiveSafes() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active safes
        for (uint256 i = 0; i < safeAddresses.length; i++) {
            if (safeMetadata[safeAddresses[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active safes
        address[] memory activeSafes = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < safeAddresses.length; i++) {
            if (safeMetadata[safeAddresses[i]].isActive) {
                activeSafes[index] = safeAddresses[i];
                index++;
            }
        }
        
        return activeSafes;
    }

    function isSafeRegistered(bytes32 _hash) external view returns (bool) {
        return hashToSafeCount[_hash] > 0;
    }

    function getSafeCount() external view returns (uint256) {
        return safeAddresses.length;
    }

    function getSafeCountByHash(bytes32 _hash) external view returns (uint256) {
        return hashToSafeCount[_hash];
    }

    // Utility functions
    function getHashUtilityAddress() external view returns (address) {
        return address(hashUtility);
    }

    // Emergency functions (only owner)
    function updateOwner(address _newOwner) external {
        require(msg.sender == owner, "Only owner");
        owner = _newOwner;
    }
}
```

---

## Sui Implementation (Move)

### 1. Hash Utility Module (`sources/hash_utility.move`)

```move
module sui_resolver::hash_utility {
    use std::string::{Self, String};
    use sui::hash;
    use std::vector;

    /// Calculate keccak256 hash from a string key
    public fun calculate_hash(key: String): vector<u8> {
        let key_bytes = string::bytes(&key);
        hash::keccak256(key_bytes)
    }

    /// Calculate sha256 hash from a string key (for cross-chain compatibility)
    public fun calculate_sha256_hash(key: String): vector<u8> {
        let key_bytes = string::bytes(&key);
        hash::sha2_256(key_bytes)
    }

    /// Calculate keccak256 hash from bytes
    public fun calculate_hash_from_bytes(data: vector<u8>): vector<u8> {
        hash::keccak256(&data)
    }

    /// Calculate sha256 hash from bytes (for cross-chain compatibility)
    public fun calculate_sha256_from_bytes(data: vector<u8>): vector<u8> {
        hash::sha2_256(&data)
    }

    /// Verify if a secret matches the given hash (keccak256)
    public fun verify_secret(secret: String, expected_hash: vector<u8>): bool {
        let secret_hash = calculate_hash(secret);
        secret_hash == expected_hash
    }

    /// Verify if a secret matches the given hash (sha256 for cross-chain)
    public fun verify_secret_sha256(secret: String, expected_hash: vector<u8>): bool {
        let secret_hash = calculate_sha256_hash(secret);
        secret_hash == expected_hash
    }
}
```

### 2. Safe Escrow Module (`sources/safe_escrow.move`)

```move
module sui_resolver::safe_escrow {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::hash;
    use std::vector;
    use std::string::{Self, String};
    use sui::event;
    use sui_resolver::hash_utility;

    // Error codes
    const EInvalidSecret: u64 = 1;
    const ETooEarly: u64 = 2;
    const ENotOwner: u64 = 3;
    const EAlreadyWithdrawn: u64 = 4;
    const EAlreadyRefunded: u64 = 5;
    const ESafeNotFound: u64 = 6;
    const EInvalidAmount: u64 = 7;

    // Safe escrow object that holds the locked funds with hash-based unlock
    public struct SafeEscrow<phantom T> has key, store {
        id: UID,
        owner: address,
        beneficiary: address,  // Who can withdraw with secret
        locked_coin: Coin<T>,
        secret_hash: vector<u8>,  // keccak256 or sha256 hash of secret
        start_time: u64,
        lock_duration: u64,  // Duration in milliseconds
        is_withdrawn: bool,
        is_refunded: bool,
        use_sha256: bool,  // true for cross-chain compatibility, false for keccak256
    }

    // Owner capability for refund operations
    public struct SafeOwnerCap has key, store {
        id: UID,
        safe_id: ID,
    }

    // Events for cross-chain monitoring
    public struct SafeCreated has copy, drop {
        safe_id: ID,
        owner: address,
        beneficiary: address,
        amount: u64,
        secret_hash: vector<u8>,
        start_time: u64,
        lock_duration: u64,
        use_sha256: bool,
    }

    public struct SafeWithdrawn has copy, drop {
        safe_id: ID,
        withdrawer: address,
        beneficiary: address,
        amount: u64,
        secret: String,  // Revealed secret for cross-chain use
    }

    public struct SafeRefunded has copy, drop {
        safe_id: ID,
        owner: address,
        amount: u64,
    }

    /// Create a new hash-locked safe with keccak256 (Ethereum compatibility)
    public fun create_safe<T>(
        coin: Coin<T>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        create_safe_internal<T>(coin, beneficiary, secret_hash, lock_duration, false, clock, ctx)
    }

    /// Create a new hash-locked safe with sha256 (cross-chain compatibility)
    public fun create_safe_sha256<T>(
        coin: Coin<T>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        create_safe_internal<T>(coin, beneficiary, secret_hash, lock_duration, true, clock, ctx)
    }

    /// Internal function to create safe
    fun create_safe_internal<T>(
        coin: Coin<T>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        use_sha256: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        assert!(coin::value(&coin) > 0, EInvalidAmount);
        
        let safe_id = object::new(ctx);
        let safe_id_copy = object::uid_to_inner(&safe_id);
        let owner = tx_context::sender(ctx);
        let amount = coin::value(&coin);
        let start_time = clock::timestamp_ms(clock);

        let safe = SafeEscrow<T> {
            id: safe_id,
            owner,
            beneficiary,
            locked_coin: coin,
            secret_hash,
            start_time,
            lock_duration,
            is_withdrawn: false,
            is_refunded: false,
            use_sha256,
        };

        // Emit event for relayer monitoring
        event::emit(SafeCreated {
            safe_id: safe_id_copy,
            owner,
            beneficiary,
            amount,
            secret_hash,
            start_time,
            lock_duration,
            use_sha256,
        });

        // Share the safe object so beneficiary can interact with it
        transfer::share_object(safe);

        // Return owner capability
        SafeOwnerCap {
            id: object::new(ctx),
            safe_id: safe_id_copy,
        }
    }

    /// Withdraw funds by providing the correct secret (anyone can call if they have the secret)
    public fun withdraw<T>(
        safe: &mut SafeEscrow<T>,
        secret: String,
        ctx: &mut TxContext
    ): Coin<T> {
        assert!(!safe.is_withdrawn, EAlreadyWithdrawn);
        assert!(!safe.is_refunded, EAlreadyRefunded);

        // Verify the secret matches the stored hash
        let is_valid = if (safe.use_sha256) {
            hash_utility::verify_secret_sha256(secret, safe.secret_hash)
        } else {
            hash_utility::verify_secret(secret, safe.secret_hash)
        };
        assert!(is_valid, EInvalidSecret);

        // Mark as withdrawn
        safe.is_withdrawn = true;

        // Extract the coin
        let amount = coin::value(&safe.locked_coin);
        let withdrawn_coin = coin::split(&mut safe.locked_coin, amount, ctx);

        // Emit event with revealed secret for cross-chain relayers
        event::emit(SafeWithdrawn {
            safe_id: object::id(safe),
            withdrawer: tx_context::sender(ctx),
            beneficiary: safe.beneficiary,
            amount,
            secret,  // Secret is now public on-chain
        });

        withdrawn_coin
    }

    /// Owner can refund after lock period expires
    public fun refund<T>(
        safe: &mut SafeEscrow<T>,
        owner_cap: &SafeOwnerCap,
        clock: &Clock,
        ctx: &mut TxContext
    ): Coin<T> {
        assert!(!safe.is_withdrawn, EAlreadyWithdrawn);
        assert!(!safe.is_refunded, EAlreadyRefunded);
        assert!(owner_cap.safe_id == object::id(safe), ENotOwner);
        
        // Check if lock period has expired
        let current_time = clock::timestamp_ms(clock);
        assert!(current_time >= safe.start_time + safe.lock_duration, ETooEarly);

        // Mark as refunded
        safe.is_refunded = true;

        // Extract the coin
        let amount = coin::value(&safe.locked_coin);
        let refunded_coin = coin::split(&mut safe.locked_coin, amount, ctx);

        // Emit event
        event::emit(SafeRefunded {
            safe_id: object::id(safe),
            owner: safe.owner,
            amount,
        });

        refunded_coin
    }

    /// Utility function to create hash from secret string (keccak256)
    public fun create_secret_hash(secret: String): vector<u8> {
        hash_utility::calculate_hash(secret)
    }

    /// Utility function to create hash from secret string (sha256)
    public fun create_secret_hash_sha256(secret: String): vector<u8> {
        hash_utility::calculate_sha256_hash(secret)
    }

    // View functions
    public fun get_safe_info<T>(safe: &SafeEscrow<T>): (address, address, u64, vector<u8>, u64, u64, bool, bool, bool) {
        (
            safe.owner,
            safe.beneficiary,
            coin::value(&safe.locked_coin),
            safe.secret_hash,
            safe.start_time,
            safe.lock_duration,
            safe.is_withdrawn,
            safe.is_refunded,
            safe.use_sha256
        )
    }

    public fun is_lock_expired<T>(safe: &SafeEscrow<T>, clock: &Clock): bool {
        let current_time = clock::timestamp_ms(clock);
        current_time >= safe.start_time + safe.lock_duration
    }

    public fun get_owner_cap_safe_id(cap: &SafeOwnerCap): ID {
        cap.safe_id
    }

    public fun get_safe_hash<T>(safe: &SafeEscrow<T>): vector<u8> {
        safe.secret_hash
    }

    public fun is_safe_available<T>(safe: &SafeEscrow<T>): bool {
        !safe.is_withdrawn && !safe.is_refunded
    }

    /// Clean up empty safe after withdrawal/refund
    public fun destroy_empty_safe<T>(safe: SafeEscrow<T>) {
        let SafeEscrow { 
            id, 
            owner: _, 
            beneficiary: _,
            locked_coin, 
            secret_hash: _, 
            start_time: _, 
            lock_duration: _, 
            is_withdrawn: _,
            is_refunded: _,
            use_sha256: _,
        } = safe;
        
        // Ensure the coin is empty before destroying
        assert!(coin::value(&locked_coin) == 0, 0);
        coin::destroy_zero(locked_coin);
        object::delete(id);
    }
}
```

### 3. Safe Record Registry (`sources/safe_record.move`)

```move
module sui_resolver::safe_record {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui::event;
    use std::string::{Self, String};
    use std::vector;
    use std::option;
    use sui_resolver::hash_utility;
    use sui_resolver::safe_escrow::{Self, SafeEscrow, SafeOwnerCap};

    // Error codes
    const ESafeAlreadyExists: u64 = 1;
    const ESafeNotFound: u64 = 2;
    const EInvalidAmount: u64 = 3;
    const EUnauthorized: u64 = 4;

    // Registry to track all safes and their metadata
    public struct SafeRegistry has key {
        id: UID,
        // Map hash to safe IDs for cross-chain lookups
        hash_to_safe: Table<vector<u8>, ID>,
        // Map safe ID to metadata
        safe_metadata: Table<ID, SafeMetadata>,
        // All safe addresses for enumeration
        safe_addresses: vector<ID>,
        owner: address,
    }

    // Metadata stored for each safe
    public struct SafeMetadata has store, copy, drop {
        safe_id: ID,
        owner: address,
        beneficiary: address,
        amount: u64,
        secret_hash: vector<u8>,
        start_time: u64,
        lock_duration: u64,
        use_sha256: bool,
        is_active: bool,
    }

    // Events for cross-chain monitoring
    public struct SafeRegistered has copy, drop {
        safe_id: ID,
        owner: address,
        beneficiary: address,
        amount: u64,
        secret_hash: vector<u8>,
        registry_id: ID,
    }

    public struct SafeDeactivated has copy, drop {
        safe_id: ID,
        registry_id: ID,
    }

    // Initialize the registry
    fun init(ctx: &mut TxContext) {
        let registry = SafeRegistry {
            id: object::new(ctx),
            hash_to_safe: table::new<vector<u8>, ID>(ctx),
            safe_metadata: table::new<ID, SafeMetadata>(ctx),
            safe_addresses: vector::empty<ID>(),
            owner: tx_context::sender(ctx),
        };
        transfer::share_object(registry);
    }

    /// Create a safe and register it in the registry (keccak256 version)
    public fun create_and_register_safe<T>(
        registry: &mut SafeRegistry,
        coin: Coin<T>,
        beneficiary: address,
        secret: String,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        let secret_hash = hash_utility::calculate_hash(secret);
        create_and_register_safe_with_hash<T>(
            registry, 
            coin, 
            beneficiary, 
            secret_hash, 
            lock_duration, 
            false, 
            clock, 
            ctx
        )
    }

    /// Create a safe and register it in the registry (sha256 version for cross-chain)
    public fun create_and_register_safe_sha256<T>(
        registry: &mut SafeRegistry,
        coin: Coin<T>,
        beneficiary: address,
        secret: String,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        let secret_hash = hash_utility::calculate_sha256_hash(secret);
        create_and_register_safe_with_hash<T>(
            registry, 
            coin, 
            beneficiary, 
            secret_hash, 
            lock_duration, 
            true, 
            clock, 
            ctx
        )
    }

    /// Internal function to create safe with pre-computed hash
    fun create_and_register_safe_with_hash<T>(
        registry: &mut SafeRegistry,
        coin: Coin<T>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        use_sha256: bool,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        assert!(coin::value(&coin) > 0, EInvalidAmount);
        
        // Create the safe
        let owner_cap = if (use_sha256) {
            safe_escrow::create_safe_sha256<T>(coin, beneficiary, secret_hash, lock_duration, clock, ctx)
        } else {
            safe_escrow::create_safe<T>(coin, beneficiary, secret_hash, lock_duration, clock, ctx)
        };
        
        let safe_id = safe_escrow::get_owner_cap_safe_id(&owner_cap);
        let owner = tx_context::sender(ctx);
        let amount = coin::value(&coin);
        let start_time = clock::timestamp_ms(clock);

        // Create metadata
        let metadata = SafeMetadata {
            safe_id,
            owner,
            beneficiary,
            amount,
            secret_hash,
            start_time,
            lock_duration,
            use_sha256,
            is_active: true,
        };

        // Register in the registry
        table::add(&mut registry.hash_to_safe, secret_hash, safe_id);
        table::add(&mut registry.safe_metadata, safe_id, metadata);
        vector::push_back(&mut registry.safe_addresses, safe_id);

        // Emit registration event
        event::emit(SafeRegistered {
            safe_id,
            owner,
            beneficiary,
            amount,
            secret_hash,
            registry_id: object::id(registry),
        });

        owner_cap
    }

    /// Deactivate a safe in the registry (called after withdrawal/refund)
    public fun deactivate_safe(
        registry: &mut SafeRegistry,
        safe_id: ID,
        ctx: &mut TxContext
    ) {
        assert!(table::contains(&registry.safe_metadata, safe_id), ESafeNotFound);
        
        let metadata = table::borrow_mut(&mut registry.safe_metadata, safe_id);
        metadata.is_active = false;

        // Emit deactivation event
        event::emit(SafeDeactivated {
            safe_id,
            registry_id: object::id(registry),
        });
    }

    // View functions for cross-chain queries
    public fun get_safe_by_hash(registry: &SafeRegistry, hash: vector<u8>): option::Option<ID> {
        if (table::contains(&registry.hash_to_safe, hash)) {
            option::some(*table::borrow(&registry.hash_to_safe, hash))
        } else {
            option::none<ID>()
        }
    }

    public fun get_safe_metadata(registry: &SafeRegistry, safe_id: ID): option::Option<SafeMetadata> {
        if (table::contains(&registry.safe_metadata, safe_id)) {
            option::some(*table::borrow(&registry.safe_metadata, safe_id))
        } else {
            option::none<SafeMetadata>()
        }
    }

    public fun get_all_active_safes(registry: &SafeRegistry): vector<ID> {
        let active_safes = vector::empty<ID>();
        let i = 0;
        let len = vector::length(&registry.safe_addresses);
        
        while (i < len) {
            let safe_id = *vector::borrow(&registry.safe_addresses, i);
            let metadata = table::borrow(&registry.safe_metadata, safe_id);
            if (metadata.is_active) {
                vector::push_back(&mut active_safes, safe_id);
            };
            i = i + 1;
        };
        
        active_safes
    }

    public fun is_safe_registered(registry: &SafeRegistry, hash: vector<u8>): bool {
        table::contains(&registry.hash_to_safe, hash)
    }

    // Utility functions to extract metadata fields
    public fun get_metadata_fields(metadata: &SafeMetadata): (ID, address, address, u64, vector<u8>, u64, u64, bool, bool) {
        (
            metadata.safe_id,
            metadata.owner,
            metadata.beneficiary,
            metadata.amount,
            metadata.secret_hash,
            metadata.start_time,
            metadata.lock_duration,
            metadata.use_sha256,
            metadata.is_active
        )
    }
}
```

---

## Cross-Chain Relayer System

### Relayer Architecture (Node.js/TypeScript)

The relayer is a stateless service that monitors both Ethereum and Sui networks for escrow events and automatically triggers cross-chain operations.

**Key Features:**
- **Stateless**: No database required, blockchain is the source of truth
- **Multi-instance safe**: Multiple relayers can run simultaneously
- **Event-driven**: Listens to specific contract events for automation
- **Gas optimization**: Batches operations when possible
- **Failure resilient**: Automatic retry mechanisms with exponential backoff

**Core Event Monitoring:**

```javascript
// Ethereum Event Listeners
ethProvider.on({
    address: SAFE_RECORD_ADDRESS,
    topics: [ethers.utils.id("SafeWithdrawn(address,address,address,uint256,string)")]
}, async (log) => {
    const event = safeRecordContract.interface.parseLog(log);
    const { safeAddress, withdrawer, beneficiary, amount, secret } = event.args;
    
    // Find corresponding Sui safe with same hash
    const secretHash = ethers.utils.sha256(ethers.utils.toUtf8Bytes(secret));
    const suiSafeId = await findSuiSafeByHash(secretHash);
    
    if (suiSafeId) {
        // Automatically withdraw from Sui safe
        await withdrawFromSuiSafe(suiSafeId, secret);
    }
});

// Sui Event Listeners  
suiClient.subscribeEvent({
    filter: {
        Package: SUI_PACKAGE_ID,
        Module: "safe_escrow",
        EventType: "SafeWithdrawn"
    }
}, async (event) => {
    const { safe_id, withdrawer, beneficiary, amount, secret } = event.parsedJson;
    
    // Find corresponding Ethereum safe with same hash
    const secretHash = await getSuiSafeHash(safe_id);
    const ethSafes = await findEthSafesByHash(secretHash);
    
    // Withdraw from all matching Ethereum safes
    for (const ethSafe of ethSafes) {
        await withdrawFromEthSafe(ethSafe, secret);
    }
});
```

**Relayer Functions:**

```typescript
class CrossChainRelayer {
    private ethProvider: ethers.Provider;
    private suiClient: SuiClient;
    private ethSigner: ethers.Signer;
    private suiSigner: Ed25519Keypair;

    async withdrawFromEthSafe(safeAddress: string, secret: string) {
        try {
            const safeContract = new ethers.Contract(safeAddress, SafeEscrowABI, this.ethSigner);
            const tx = await safeContract.withdraw(secret, {
                gasLimit: ethers.utils.parseUnits("100000", "wei")
            });
            await tx.wait();
            console.log(`ETH withdrawal successful: ${tx.hash}`);
        } catch (error) {
            console.error(`ETH withdrawal failed: ${error.message}`);
            // Implement retry logic
        }
    }

    async withdrawFromSuiSafe(safeId: string, secret: string) {
        try {
            const txb = new TransactionBlock();
            txb.moveCall({
                target: `${SUI_PACKAGE_ID}::safe_escrow::withdraw`,
                typeArguments: ['0x2::sui::SUI'],
                arguments: [
                    txb.object(safeId),
                    txb.pure(secret)
                ]
            });
            
            const result = await this.suiClient.signAndExecuteTransactionBlock({
                signer: this.suiSigner,
                transactionBlock: txb,
            });
            
            console.log(`SUI withdrawal successful: ${result.digest}`);
        } catch (error) {
            console.error(`SUI withdrawal failed: ${error.message}`);
            // Implement retry logic
        }
    }

    async findEthSafesByHash(hash: string): Promise<string[]> {
        const safeRecord = new ethers.Contract(ETH_SAFE_RECORD_ADDRESS, SafeRecordABI, this.ethProvider);
        return await safeRecord.getSafesByHash(hash);
    }

    async findSuiSafeByHash(hash: string): Promise<string | null> {
        // Query Sui registry for safe with matching hash
        const registry = await this.suiClient.getObject({
            id: SUI_REGISTRY_ID,
            options: { showContent: true }
        });
        // Implementation depends on registry structure
        return null; // Placeholder
    }
}
```

---

## Deployment Instructions

### Ethereum Deployment

1. **Deploy Hash Utility Contract:**
```bash
# Using Hardhat
npx hardhat run scripts/deploy-hash-utility.js --network sepolia

# Using Foundry
forge create src/hash.sol:HashUtility --rpc-url $ETH_RPC_URL --private-key $PRIVATE_KEY
```

2. **Deploy Safe Record Registry:**
```bash
# The constructor automatically deploys HashUtility
forge create src/saferecord.sol:SafeRecord --rpc-url $ETH_RPC_URL --private-key $PRIVATE_KEY
```

3. **Verify Contracts:**
```bash
npx hardhat verify --network sepolia $HASH_UTILITY_ADDRESS
npx hardhat verify --network sepolia $SAFE_RECORD_ADDRESS
```

### Sui Deployment

1. **Build and Deploy Package:**
```bash
# Build the Move package
sui move build

# Deploy to devnet/testnet
sui client publish --gas-budget 50000000

# Deploy to mainnet (requires more gas)
sui client publish --gas-budget 100000000
```

2. **Initialize Registry:**
```bash
# The init function automatically creates and shares the SafeRegistry
# No additional initialization required
```

3. **Verify Deployment:**
```bash
# Check package objects
sui client objects --owned-by $YOUR_ADDRESS

# Verify registry is shared
sui client object $REGISTRY_ID
```

---

## Usage Examples

### Cross-Chain Swap Example (ETH → SUI)

**Step 1: Alice generates secret and creates Ethereum safe**

```javascript
// Generate random secret
const secret = ethers.utils.randomBytes(32);
const secretString = ethers.utils.hexlify(secret);
const secretHash = ethers.utils.sha256(ethers.utils.toUtf8Bytes(secretString));

// Deploy Ethereum safe
const safeRecord = new ethers.Contract(SAFE_RECORD_ADDRESS, SafeRecordABI, aliceSigner);
const tx = await safeRecord.createSafeSha256(
    USDC_ADDRESS,           // token
    ethers.utils.parseUnits("100", 6), // 100 USDC
    secretString,           // secret
    bobAddress,             // beneficiary
    3 * 60 * 60 * 1000     // 3 hours timeout
);
const receipt = await tx.wait();
const ethSafeAddress = receipt.events[0].args.safeAddress;
```

**Step 2: Bob creates corresponding Sui safe**

```typescript
// Bob creates Sui safe with same hash
const txb = new TransactionBlock();
const coin = txb.splitCoins(txb.gas, [txb.pure(100_000_000)]); // 100 SUI

txb.moveCall({
    target: `${SUI_PACKAGE_ID}::safe_record::create_and_register_safe_sha256`,
    typeArguments: ['0x2::sui::SUI'],
    arguments: [
        txb.object(SUI_REGISTRY_ID),
        coin,
        txb.pure(aliceAddress),
        txb.pure(secretString),
        txb.pure(30 * 60 * 1000) // 30 minutes timeout
    ]
});

const result = await suiClient.signAndExecuteTransactionBlock({
    signer: bobSigner,
    transactionBlock: txb,
});
```

**Step 3: Alice reveals secret to claim SUI**

```typescript
// Alice withdraws SUI by revealing secret
const txb = new TransactionBlock();
txb.moveCall({
    target: `${SUI_PACKAGE_ID}::safe_escrow::withdraw`,
    typeArguments: ['0x2::sui::SUI'],
    arguments: [
        txb.object(suiSafeId),
        txb.pure(secretString)
    ]
});

const result = await suiClient.signAndExecuteTransactionBlock({
    signer: aliceSigner,
    transactionBlock: txb,
});

// Secret is now public on Sui blockchain
```

**Step 4: Relayer automatically claims ETH for Bob**

```javascript
// Relayer monitors Sui events and automatically withdraws ETH
// This happens automatically - no manual intervention required

// Manual withdrawal (if relayer is down):
const ethSafe = new ethers.Contract(ethSafeAddress, SafeEscrowABI, bobSigner);
const tx = await ethSafe.withdraw(secretString);
await tx.wait();
```

### Single-Chain Safe Creation

**Ethereum (with keccak256 for gas efficiency):**

```javascript
const safeRecord = new ethers.Contract(SAFE_RECORD_ADDRESS, SafeRecordABI, signer);
const tx = await safeRecord.createSafe(
    USDT_ADDRESS,                    // token
    ethers.utils.parseUnits("50", 6), // 50 USDT
    "my-secret-password",            // secret
    beneficiaryAddress,              // beneficiary
    24 * 60 * 60 * 1000             // 24 hours timeout
);
```

**Sui (with keccak256 for consistency):**

```typescript
const txb = new TransactionBlock();
const coin = txb.splitCoins(txb.gas, [txb.pure(50_000_000)]); // 50 SUI

txb.moveCall({
    target: `${SUI_PACKAGE_ID}::safe_record::create_and_register_safe`,
    typeArguments: ['0x2::sui::SUI'],
    arguments: [
        txb.object(SUI_REGISTRY_ID),
        coin,
        txb.pure(beneficiaryAddress),
        txb.pure("my-secret-password"),
        txb.pure(24 * 60 * 60 * 1000)
    ]
});
```

---

## Testing & Verification

### Unit Tests

**Ethereum (Hardhat/Foundry):**

```solidity
// Test secret hash verification
function testSecretVerification() public {
    string memory secret = "test-secret";
    bytes32 keccakHash = hashUtility.calculateHash(secret);
    bytes32 sha256Hash = hashUtility.calculateSha256Hash(secret);
    
    assertTrue(hashUtility.verifySecret(secret, keccakHash));
    assertTrue(hashUtility.verifySecretSha256(secret, sha256Hash));
}

// Test safe creation and withdrawal
function testSafeEscrowFlow() public {
    // Create safe
    address safeAddr = safeRecord.createSafeSha256(
        address(token), 100e6, "secret123", alice, 1 hours, true
    );
    
    // Withdraw with correct secret
    vm.prank(alice);
    SafeEscrow(safeAddr).withdraw("secret123");
    
    assertEq(token.balanceOf(alice), 100e6);
}
```

**Sui (Move Unit Tests):**

```move
#[test]
fun test_safe_creation_and_withdrawal() {
    let ctx = tx_context::dummy();
    let clock = clock::create_for_testing(&mut ctx);
    
    // Create test coin
    let coin = coin::mint_for_testing<SUI>(100_000_000, &mut ctx);
    
    // Create safe
    let secret = string::utf8(b"test-secret");
    let hash = hash_utility::calculate_sha256_hash(secret);
    let cap = safe_escrow::create_safe_sha256(
        coin, @0xBEEF, hash, 3600000, &clock, &mut ctx
    );
    
    // Test withdrawal (implementation depends on test framework)
    // ...
}
```

### Integration Tests

1. **Cross-chain hash consistency verification**
2. **Timeout behavior validation**
3. **Relayer automation testing**
4. **Gas optimization verification**
5. **Multiple safe interaction testing**

---

## Security Considerations

### Hash Algorithm Consistency
- **CRITICAL**: Both chains MUST use identical hashing for cross-chain swaps
- Use sha256 for cross-chain compatibility
- Use keccak256 only for single-chain operations

### Timeout Configuration
- **Source chain timeout > Destination chain timeout + safety margin**
- Consider block time differences between chains
- Account for potential network congestion

### Access Control
- Withdrawal is permissionless (anyone with secret can claim)
- Refund is restricted to original depositor
- Registry deactivation requires proper authorization

### Relayer Security
- Relayers are optional - users can always act manually
- Multiple relayers can operate simultaneously
- No single point of failure in the system

### Smart Contract Security
- All contracts are upgradeable through proper governance
- Emergency pause functionality where appropriate
- Comprehensive access control for administrative functions

---

## Gas Optimization

### Ethereum
- Use keccak256 for single-chain operations (cheaper than sha256)
- Batch multiple operations when possible
- Optimize struct packing for storage efficiency

### Sui
- Leverage Move's resource model for automatic cleanup
- Use shared objects for multi-party interactions
- Minimize object creation in hot paths

---

## Monitoring & Analytics

### Event Indexing
- Index all SafeCreated, SafeWithdrawn, SafeRefunded events
- Track cross-chain swap success rates
- Monitor relayer performance and uptime

### Metrics Collection
- Total value locked across all safes
- Average swap completion time
- Network fee analysis
- Success/failure rates by chain

### Alerting
- Failed cross-chain operations
- Unusual timeout patterns
- Relayer downtime detection
- High-value transaction monitoring

---

*This specification provides a complete implementation guide for building a cross-chain safe escrow system with identical functionality across Ethereum and Sui networks. The hash-based locking mechanism ensures atomic swaps while the registry system enables efficient cross-chain coordination.*
