/// Fusion+ Sui Escrow Module - HTLC Implementation
module fusion_plus::sui_escrow {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::hash;
    use std::string::{Self, String};

    // Error codes
    const E_INVALID_BENEFICIARY: u64 = 2;
    const E_INVALID_HASH_LOCK: u64 = 3;
    const E_INVALID_TIMELOCK: u64 = 4;
    const E_UNAUTHORIZED: u64 = 6;
    const E_ALREADY_PROCESSED: u64 = 7;
    const E_EXPIRED: u64 = 8;
    const E_NOT_EXPIRED: u64 = 9;
    const E_INVALID_SECRET: u64 = 10;

    // Constants
    const MIN_RESOLVER_STAKE: u64 = 1_000_000_000; // 1 SUI

    const MAX_LOCK_DURATION: u64 = 86400000; // 24 hours in milliseconds
    const MIN_RESOLVER_TIMELOCK_OFFSET: u64 = 1800000; // 30 minutes in milliseconds

    // HTLC Structs
    public struct HTLC has key, store {
        id: UID,
        htlc_id: vector<u8>,
        sender: address,
        beneficiary: address,
        amount: u64,
        hash_lock: vector<u8>,
        timelock: u64,
        claimed: bool,
        refunded: bool,
        sui_balance: Balance<SUI>,
    }

    // Legacy Order struct for backward compatibility
    #[allow(unused_field)]
    public struct Order has key, store {
        id: UID,
        order_id: vector<u8>,
        requester: address,
        resolver: address,
        amount_in: u64,
        secret_hash: vector<u8>,
        expiry: u64,
        executed: bool,
        refunded: bool,
        sui_balance: Balance<SUI>,
    }

    public struct ResolverRegistry has key {
        id: UID,
        resolvers: vector<address>,
        stakes: vector<u64>,
    }

    public struct SecretRegistry has key {
        id: UID,
        revealed_secrets: vector<vector<u8>>, // hash_lock -> secret_hash
        secret_hashes: vector<vector<u8>>,
    }

    // HTLC Events
    public struct HTLCLocked has copy, drop {
        htlc_id: vector<u8>,
        sender: address,
        beneficiary: address,
        amount: u64,
        hash_lock: vector<u8>,
        timelock: u64,
    }

    public struct HTLCClaimed has copy, drop {
        htlc_id: vector<u8>,
        claimer: address,
        secret: vector<u8>,
    }

    public struct HTLCRefunded has copy, drop {
        htlc_id: vector<u8>,
        sender: address,
    }

    // Legacy Events
    #[allow(unused_field)]
    public struct OrderCreated has copy, drop {
        order_id: vector<u8>,
        requester: address,
        resolver: address,
        amount_in: u64,
        secret_hash: vector<u8>,
        expiry: u64,
    }

    #[allow(unused_field)]
    public struct OrderExecuted has copy, drop {
        order_id: vector<u8>,
        resolver: address,
        secret: vector<u8>,
    }

    public struct SecretRevealed has copy, drop {
        htlc_id: vector<u8>,
        secret: String,
    }

    // Initialize the module
    fun init(ctx: &mut TxContext) {
        let registry = ResolverRegistry {
            id: object::new(ctx),
            resolvers: vector::empty(),
            stakes: vector::empty(),
        };
        
        let secret_registry = SecretRegistry {
            id: object::new(ctx),
            revealed_secrets: vector::empty(),
            secret_hashes: vector::empty(),
        };
        
        transfer::share_object(registry);
        transfer::share_object(secret_registry);
    }

    // Register as a resolver by staking SUI
    public fun register_resolver(
        registry: &mut ResolverRegistry,
        stake: Coin<SUI>,
        ctx: &mut TxContext
    ) {
        let stake_amount = coin::value(&stake);
        assert!(stake_amount >= MIN_RESOLVER_STAKE, 1);
        
        let resolver = tx_context::sender(ctx);
        
        vector::push_back(&mut registry.resolvers, resolver);
        vector::push_back(&mut registry.stakes, stake_amount);

        // Transfer stake to registry (simplified)
        transfer::public_transfer(stake, @fusion_plus);
    }

    // Check if resolver is registered
    public fun is_resolver_registered(registry: &ResolverRegistry, resolver: address): bool {
        let len = vector::length(&registry.resolvers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(&registry.resolvers, i) == resolver) {
                let stake = *vector::borrow(&registry.stakes, i);
                return stake >= MIN_RESOLVER_STAKE
            };
            i = i + 1;
        };
        false
    }

    // Lock funds in HTLC (dual-side flow)
    public fun lock_funds(
        htlc_id: vector<u8>,
        beneficiary: address,
        amount: Coin<SUI>,
        hash_lock: vector<u8>,
        timelock: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        // Validate inputs
        assert!(beneficiary != @0x0, E_INVALID_BENEFICIARY);
        assert!(vector::length(&hash_lock) > 0, E_INVALID_HASH_LOCK);
        
        let current_time = clock::timestamp_ms(clock);
        assert!(timelock > current_time, E_INVALID_TIMELOCK);
        assert!(timelock <= current_time + MAX_LOCK_DURATION, E_INVALID_TIMELOCK);

        let amount_value = coin::value(&amount);
        let sender = tx_context::sender(ctx);

        let htlc = HTLC {
            id: object::new(ctx),
            htlc_id,
            sender,
            beneficiary,
            amount: amount_value,
            hash_lock,
            timelock,
            claimed: false,
            refunded: false,
            sui_balance: coin::into_balance(amount),
        };

        event::emit(HTLCLocked {
            htlc_id,
            sender,
            beneficiary,
            amount: amount_value,
            hash_lock,
            timelock,
        });

        transfer::share_object(htlc);
    }

    // Claim funds from HTLC by revealing the secret
    public fun claim_funds(
        htlc: &mut HTLC,
        secret: String,
        secret_registry: &mut SecretRegistry,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let claimer = tx_context::sender(ctx);
        
        // Validate conditions
        assert!(claimer == htlc.beneficiary, E_UNAUTHORIZED);
        assert!(!htlc.claimed && !htlc.refunded, E_ALREADY_PROCESSED);
        assert!(clock::timestamp_ms(clock) <= htlc.timelock, E_EXPIRED);

        // Verify secret
        let secret_bytes = string::as_bytes(&secret);
        let secret_hash = hash::keccak256(secret_bytes);
        assert!(secret_hash == htlc.hash_lock, E_INVALID_SECRET);

        // Mark as claimed
        htlc.claimed = true;

        // Store secret for cross-chain monitoring
        vector::push_back(&mut secret_registry.revealed_secrets, htlc.hash_lock);
        vector::push_back(&mut secret_registry.secret_hashes, secret_hash);

        // Transfer funds to beneficiary
        let coin_to_transfer = coin::from_balance(
            balance::withdraw_all(&mut htlc.sui_balance),
            ctx
        );
        transfer::public_transfer(coin_to_transfer, htlc.beneficiary);

        event::emit(HTLCClaimed {
            htlc_id: htlc.htlc_id,
            claimer,
            secret: *secret_bytes,
        });

        event::emit(SecretRevealed {
            htlc_id: htlc.htlc_id,
            secret,
        });
    }

    // Refund HTLC after timelock expiry
    public fun refund_htlc(
        htlc: &mut HTLC,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        
        // Validate conditions
        assert!(sender == htlc.sender, E_UNAUTHORIZED);
        assert!(!htlc.claimed && !htlc.refunded, E_ALREADY_PROCESSED);
        assert!(clock::timestamp_ms(clock) > htlc.timelock, E_NOT_EXPIRED);

        // Mark as refunded
        htlc.refunded = true;

        // Refund to sender
        let coin_to_refund = coin::from_balance(
            balance::withdraw_all(&mut htlc.sui_balance),
            ctx
        );
        transfer::public_transfer(coin_to_refund, htlc.sender);

        event::emit(HTLCRefunded {
            htlc_id: htlc.htlc_id,
            sender,
        });
    }

    // Helper functions
    public fun get_htlc_details(htlc: &HTLC): (address, address, u64, vector<u8>, u64, bool, bool) {
        (htlc.sender, htlc.beneficiary, htlc.amount, htlc.hash_lock, htlc.timelock, htlc.claimed, htlc.refunded)
    }

    public fun is_htlc_active(htlc: &HTLC, clock: &Clock): bool {
        !htlc.claimed && !htlc.refunded && clock::timestamp_ms(clock) <= htlc.timelock
    }

    public fun can_refund_htlc(htlc: &HTLC, clock: &Clock): bool {
        !htlc.claimed && !htlc.refunded && clock::timestamp_ms(clock) > htlc.timelock
    }

    public fun is_secret_revealed(secret_registry: &SecretRegistry, hash_lock: vector<u8>): bool {
        let len = vector::length(&secret_registry.revealed_secrets);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(&secret_registry.revealed_secrets, i) == hash_lock) {
                return true
            };
            i = i + 1;
        };
        false
    }

    public fun validate_timelocks(requester_timelock: u64, resolver_timelock: u64): bool {
        resolver_timelock + MIN_RESOLVER_TIMELOCK_OFFSET <= requester_timelock
    }

    // Test-only functions
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}