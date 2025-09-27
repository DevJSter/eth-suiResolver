module sui_resolver::safe_escrow {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use std::string::String;
    use sui::event;
    use sui_resolver::hash_utility;

    // Error codes
    const EInvalidSecret: u64 = 1;
    const ETooEarly: u64 = 2;
    const ENotOwner: u64 = 3;
    const EAlreadyWithdrawn: u64 = 4;
    const EAlreadyRefunded: u64 = 5;
    const EInvalidAmount: u64 = 6;

    // Safe escrow object that holds the locked SUI with hash-based unlock
    public struct SafeEscrow has key, store {
        id: UID,
        owner: address,
        beneficiary: address,  // Who can withdraw with secret
        locked_coin: Coin<SUI>,
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
    public fun create_safe(
        coin: Coin<SUI>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        create_safe_internal(coin, beneficiary, secret_hash, lock_duration, false, clock, ctx)
    }

    /// Create a new hash-locked safe with sha256 (cross-chain compatibility)
    public fun create_safe_sha256(
        coin: Coin<SUI>,
        beneficiary: address,
        secret_hash: vector<u8>,
        lock_duration: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): SafeOwnerCap {
        create_safe_internal(coin, beneficiary, secret_hash, lock_duration, true, clock, ctx)
    }

    /// Internal function to create safe
    fun create_safe_internal(
        coin: Coin<SUI>,
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

        let safe = SafeEscrow {
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
    public fun withdraw(
        safe: &mut SafeEscrow,
        secret: String,
        ctx: &mut TxContext
    ): Coin<SUI> {
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
    public fun refund(
        safe: &mut SafeEscrow,
        owner_cap: &SafeOwnerCap,
        clock: &Clock,
        ctx: &mut TxContext
    ): Coin<SUI> {
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
    public fun get_safe_info(safe: &SafeEscrow): (address, address, u64, vector<u8>, u64, u64, bool, bool, bool) {
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

    public fun is_lock_expired(safe: &SafeEscrow, clock: &Clock): bool {
        let current_time = clock::timestamp_ms(clock);
        current_time >= safe.start_time + safe.lock_duration
    }

    public fun get_owner_cap_safe_id(cap: &SafeOwnerCap): ID {
        cap.safe_id
    }

    public fun get_safe_hash(safe: &SafeEscrow): vector<u8> {
        safe.secret_hash
    }

    public fun is_safe_available(safe: &SafeEscrow): bool {
        !safe.is_withdrawn && !safe.is_refunded
    }

    /// Clean up empty safe after withdrawal/refund
    public fun destroy_empty_safe(safe: SafeEscrow) {
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