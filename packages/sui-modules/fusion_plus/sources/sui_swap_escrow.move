/// Fusion+ Sui Swap Escrow Module - Individual Escrow per Swap
module fusion_plus::sui_swap_escrow {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::hash;
    use std::string::{Self, String};

    // Error codes
    const E_INVALID_SECRET_HASH: u64 = 2;
    const E_INVALID_TIMELOCK: u64 = 3;
    const E_UNAUTHORIZED: u64 = 4;
    const E_ALREADY_PROCESSED: u64 = 5;
    const E_EXPIRED: u64 = 6;
    const E_NOT_EXPIRED: u64 = 7;
    const E_INVALID_SECRET: u64 = 8;
    const E_NOT_LOCKED: u64 = 9;
    const E_ALREADY_LOCKED: u64 = 10;
    const E_ESCROW_DESTROYED: u64 = 11;
    const E_USER_MUST_LOCK_FIRST: u64 = 12;
    const E_INVALID_TIMELOCK_RELATIONSHIP: u64 = 13;

    // Constants
    const MIN_TIMELOCK_BUFFER: u64 = 1800000; // 30 minutes in milliseconds
    const MAX_SWAP_DURATION: u64 = 86400000; // 24 hours in milliseconds
    const CLEANUP_DELAY: u64 = 3600000; // 1 hour in milliseconds

    // Individual Swap Escrow struct
    public struct SwapEscrow has key {
        id: UID,
        swap_id: vector<u8>,
        factory_id: ID,
        
        // User side (locks first)
        user_address: address,
        user_beneficiary: address, // resolver address
        user_amount: u64,
        user_timelock: u64,
        user_locked: bool,
        user_claimed: bool,
        user_refunded: bool,
        user_balance: Balance<SUI>,
        
        // Resolver side (locks in response)
        resolver_address: address,
        resolver_beneficiary: address, // user address
        resolver_amount: u64,
        resolver_timelock: u64,
        resolver_locked: bool,
        resolver_claimed: bool,
        resolver_refunded: bool,
        resolver_balance: Balance<SUI>,
        
        // Shared
        secret_hash: vector<u8>,
        revealed_secret: String,
        is_destroyed: bool,
        created_at: u64,
    }

    // Factory for creating swap escrows
    public struct SwapEscrowFactory has key {
        id: UID,
        resolvers: vector<address>,
        resolver_stakes: vector<u64>,
        active_swaps: vector<vector<u8>>,
        swap_escrows: vector<ID>,
        min_resolver_stake: u64,
    }

    // Events
    public struct SwapEscrowCreated has copy, drop {
        swap_id: vector<u8>,
        escrow_id: ID,
        user_address: address,
        resolver_address: address,
        secret_hash: vector<u8>,
        user_timelock: u64,
        resolver_timelock: u64,
    }

    public struct EscrowLocked has copy, drop {
        swap_id: vector<u8>,
        side: u8, // 0 for user, 1 for resolver
        locker: address,
        beneficiary: address,
        amount: u64,
    }

    public struct EscrowClaimed has copy, drop {
        swap_id: vector<u8>,
        side: u8,
        claimer: address,
        secret: String,
        amount: u64,
    }

    public struct EscrowRefunded has copy, drop {
        swap_id: vector<u8>,
        side: u8,
        refundee: address,
        amount: u64,
    }

    public struct EscrowDestroyed has copy, drop {
        swap_id: vector<u8>,
        escrow_id: ID,
    }

    public struct ResolverRegistered has copy, drop {
        resolver: address,
        stake_amount: u64,
    }

    public struct SwapCompleted has copy, drop {
        swap_id: vector<u8>,
        secret: String,
    }

    // Initialize the factory
    fun init(ctx: &mut TxContext) {
        let factory = SwapEscrowFactory {
            id: object::new(ctx),
            resolvers: vector::empty(),
            resolver_stakes: vector::empty(),
            active_swaps: vector::empty(),
            swap_escrows: vector::empty(),
            min_resolver_stake: 1_000_000_000, // 1 SUI
        };
        
        transfer::share_object(factory);
    }

    // Register as a resolver with stake
    public fun register_resolver(
        factory: &mut SwapEscrowFactory,
        stake: Coin<SUI>,
        ctx: &mut TxContext
    ) {
        let stake_amount = coin::value(&stake);
        assert!(stake_amount >= factory.min_resolver_stake, 1);
        
        let resolver = tx_context::sender(ctx);
        
        // Check if already registered
        let len = vector::length(&factory.resolvers);
        let mut i = 0;
        let mut already_registered = false;
        while (i < len) {
            if (*vector::borrow(&factory.resolvers, i) == resolver) {
                already_registered = true;
                break
            };
            i = i + 1;
        };
        
        if (!already_registered) {
            vector::push_back(&mut factory.resolvers, resolver);
            vector::push_back(&mut factory.resolver_stakes, stake_amount);
        } else {
            // Update existing stake
            let stake_ref = vector::borrow_mut(&mut factory.resolver_stakes, i);
            *stake_ref = *stake_ref + stake_amount;
        };

        // Transfer stake to factory (simplified - in practice would lock it properly)
        transfer::public_transfer(stake, @fusion_plus);
        
        event::emit(ResolverRegistered {
            resolver: resolver,
            stake_amount: stake_amount,
        });
    }

    // Create a new swap escrow
    public fun create_swap_escrow(
        factory: &mut SwapEscrowFactory,
        swap_id: vector<u8>,
        resolver_address: address,
        secret_hash: vector<u8>,
        user_timelock: u64,
        resolver_timelock: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ): ID {
        let current_time = clock::timestamp_ms(clock);
        let user_address = tx_context::sender(ctx);
        
        // Validate inputs
        assert!(vector::length(&secret_hash) > 0, E_INVALID_SECRET_HASH);
        assert!(user_timelock > current_time, E_INVALID_TIMELOCK);
        assert!(resolver_timelock > current_time, E_INVALID_TIMELOCK);
        assert!(user_timelock <= current_time + MAX_SWAP_DURATION, E_INVALID_TIMELOCK);
        assert!(resolver_timelock + MIN_TIMELOCK_BUFFER <= user_timelock, E_INVALID_TIMELOCK_RELATIONSHIP);
        
        // Check if resolver is registered
        let is_authorized = is_resolver_registered(factory, resolver_address);
        assert!(is_authorized, E_UNAUTHORIZED);

        let escrow = SwapEscrow {
            id: object::new(ctx),
            swap_id: swap_id,
            factory_id: object::id(factory),
            
            // User side
            user_address: user_address,
            user_beneficiary: resolver_address,
            user_amount: 0,
            user_timelock: user_timelock,
            user_locked: false,
            user_claimed: false,
            user_refunded: false,
            user_balance: balance::zero<SUI>(),
            
            // Resolver side
            resolver_address: resolver_address,
            resolver_beneficiary: user_address,
            resolver_amount: 0,
            resolver_timelock: resolver_timelock,
            resolver_locked: false,
            resolver_claimed: false,
            resolver_refunded: false,
            resolver_balance: balance::zero<SUI>(),
            
            // Shared
            secret_hash: secret_hash,
            revealed_secret: string::utf8(b""),
            is_destroyed: false,
            created_at: current_time,
        };

        let escrow_id = object::id(&escrow);
        
        // Track in factory
        vector::push_back(&mut factory.active_swaps, swap_id);
        vector::push_back(&mut factory.swap_escrows, escrow_id);

        event::emit(SwapEscrowCreated {
            swap_id: swap_id,
            escrow_id: escrow_id,
            user_address: user_address,
            resolver_address: resolver_address,
            secret_hash: secret_hash,
            user_timelock: user_timelock,
            resolver_timelock: resolver_timelock,
        });

        transfer::share_object(escrow);
        escrow_id
    }

    // Lock funds on user side (called by user first)
    public fun lock_user_side(
        escrow: &mut SwapEscrow,
        amount: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!escrow.is_destroyed, E_ESCROW_DESTROYED);
        assert!(tx_context::sender(ctx) == escrow.user_address, E_UNAUTHORIZED);
        assert!(!escrow.user_locked, E_ALREADY_LOCKED);
        assert!(clock::timestamp_ms(clock) <= escrow.user_timelock, E_EXPIRED);

        let amount_value = coin::value(&amount);
        escrow.user_amount = amount_value;
        escrow.user_locked = true;
        balance::join(&mut escrow.user_balance, coin::into_balance(amount));

        event::emit(EscrowLocked {
            swap_id: escrow.swap_id,
            side: 0,
            locker: escrow.user_address,
            beneficiary: escrow.user_beneficiary,
            amount: amount_value,
        });
    }

    // Lock funds on resolver side (called by resolver after user locks)
    public fun lock_resolver_side(
        escrow: &mut SwapEscrow,
        amount: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!escrow.is_destroyed, E_ESCROW_DESTROYED);
        assert!(tx_context::sender(ctx) == escrow.resolver_address, E_UNAUTHORIZED);
        assert!(!escrow.resolver_locked, E_ALREADY_LOCKED);
        assert!(escrow.user_locked, E_USER_MUST_LOCK_FIRST);
        assert!(clock::timestamp_ms(clock) <= escrow.resolver_timelock, E_EXPIRED);

        let amount_value = coin::value(&amount);
        escrow.resolver_amount = amount_value;
        escrow.resolver_locked = true;
        balance::join(&mut escrow.resolver_balance, coin::into_balance(amount));

        event::emit(EscrowLocked {
            swap_id: escrow.swap_id,
            side: 1,
            locker: escrow.resolver_address,
            beneficiary: escrow.resolver_beneficiary,
            amount: amount_value,
        });
    }

    // Claim funds by revealing secret
    public fun claim_funds(
        escrow: &mut SwapEscrow,
        secret: String,
        side: u8, // 0 for user side, 1 for resolver side
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!escrow.is_destroyed, E_ESCROW_DESTROYED);
        
        // Verify secret
        let secret_bytes = string::as_bytes(&secret);
        let secret_hash = hash::keccak256(secret_bytes);
        assert!(secret_hash == escrow.secret_hash, E_INVALID_SECRET);

        let claimer = tx_context::sender(ctx);

        if (side == 0) {
            // Claiming user side (resolver claims user's funds)
            assert!(claimer == escrow.user_beneficiary, E_UNAUTHORIZED);
            assert!(escrow.user_locked, E_NOT_LOCKED);
            assert!(!escrow.user_claimed && !escrow.user_refunded, E_ALREADY_PROCESSED);
            assert!(clock::timestamp_ms(clock) <= escrow.user_timelock, E_EXPIRED);

            escrow.user_claimed = true;
            escrow.revealed_secret = secret;

            let coin_to_transfer = coin::from_balance(
                balance::withdraw_all(&mut escrow.user_balance),
                ctx
            );
            transfer::public_transfer(coin_to_transfer, escrow.user_beneficiary);

            event::emit(EscrowClaimed {
                swap_id: escrow.swap_id,
                side: 0,
                claimer: claimer,
                secret: secret,
                amount: escrow.user_amount,
            });

        } else {
            // Claiming resolver side (user claims resolver's funds)
            assert!(claimer == escrow.resolver_beneficiary, E_UNAUTHORIZED);
            assert!(escrow.resolver_locked, E_NOT_LOCKED);
            assert!(!escrow.resolver_claimed && !escrow.resolver_refunded, E_ALREADY_PROCESSED);
            assert!(clock::timestamp_ms(clock) <= escrow.resolver_timelock, E_EXPIRED);

            escrow.resolver_claimed = true;
            escrow.revealed_secret = secret;

            let coin_to_transfer = coin::from_balance(
                balance::withdraw_all(&mut escrow.resolver_balance),
                ctx
            );
            transfer::public_transfer(coin_to_transfer, escrow.resolver_beneficiary);

            event::emit(EscrowClaimed {
                swap_id: escrow.swap_id,
                side: 1,
                claimer: claimer,
                secret: secret,
                amount: escrow.resolver_amount,
            });
        };

        // Auto-claim other side if possible
        auto_claim_other_side(escrow, secret, side, clock, ctx);
        
        // Check if swap is complete
        check_and_destroy(escrow);
    }

    // Refund funds after timelock expiry
    public fun refund_funds(
        escrow: &mut SwapEscrow,
        side: u8, // 0 for user side, 1 for resolver side
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!escrow.is_destroyed, E_ESCROW_DESTROYED);
        let refunder = tx_context::sender(ctx);

        if (side == 0) {
            // Refunding user side
            assert!(refunder == escrow.user_address, E_UNAUTHORIZED);
            assert!(escrow.user_locked, E_NOT_LOCKED);
            assert!(!escrow.user_claimed && !escrow.user_refunded, E_ALREADY_PROCESSED);
            assert!(clock::timestamp_ms(clock) > escrow.user_timelock, E_NOT_EXPIRED);

            escrow.user_refunded = true;

            let coin_to_refund = coin::from_balance(
                balance::withdraw_all(&mut escrow.user_balance),
                ctx
            );
            transfer::public_transfer(coin_to_refund, escrow.user_address);

            event::emit(EscrowRefunded {
                swap_id: escrow.swap_id,
                side: 0,
                refundee: escrow.user_address,
                amount: escrow.user_amount,
            });

        } else {
            // Refunding resolver side
            assert!(refunder == escrow.resolver_address, E_UNAUTHORIZED);
            assert!(escrow.resolver_locked, E_NOT_LOCKED);
            assert!(!escrow.resolver_claimed && !escrow.resolver_refunded, E_ALREADY_PROCESSED);
            assert!(clock::timestamp_ms(clock) > escrow.resolver_timelock, E_NOT_EXPIRED);

            escrow.resolver_refunded = true;

            let coin_to_refund = coin::from_balance(
                balance::withdraw_all(&mut escrow.resolver_balance),
                ctx
            );
            transfer::public_transfer(coin_to_refund, escrow.resolver_address);

            event::emit(EscrowRefunded {
                swap_id: escrow.swap_id,
                side: 1,
                refundee: escrow.resolver_address,
                amount: escrow.resolver_amount,
            });
        };
        
        // Check if swap is complete
        check_and_destroy(escrow);
    }

    // Auto-claim other side when secret is revealed
    fun auto_claim_other_side(
        escrow: &mut SwapEscrow,
        secret: String,
        claimed_side: u8,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let current_time = clock::timestamp_ms(clock);
        
        if (claimed_side == 0) {
            // User side was claimed, try to auto-claim resolver side
            if (escrow.resolver_locked && 
                !escrow.resolver_claimed && 
                !escrow.resolver_refunded && 
                current_time <= escrow.resolver_timelock) {
                
                escrow.resolver_claimed = true;
                
                let coin_to_transfer = coin::from_balance(
                    balance::withdraw_all(&mut escrow.resolver_balance),
                    ctx
                );
                transfer::public_transfer(coin_to_transfer, escrow.resolver_beneficiary);
                
                event::emit(EscrowClaimed {
                    swap_id: escrow.swap_id,
                    side: 1,
                    claimer: escrow.resolver_beneficiary,
                    secret: secret,
                    amount: escrow.resolver_amount,
                });
            };
        } else {
            // Resolver side was claimed, try to auto-claim user side
            if (escrow.user_locked && 
                !escrow.user_claimed && 
                !escrow.user_refunded && 
                current_time <= escrow.user_timelock) {
                
                escrow.user_claimed = true;
                
                let coin_to_transfer = coin::from_balance(
                    balance::withdraw_all(&mut escrow.user_balance),
                    ctx
                );
                transfer::public_transfer(coin_to_transfer, escrow.user_beneficiary);
                
                event::emit(EscrowClaimed {
                    swap_id: escrow.swap_id,
                    side: 0,
                    claimer: escrow.user_beneficiary,
                    secret: secret,
                    amount: escrow.user_amount,
                });
            };
        };
    }

    // Check if both sides are processed and destroy if so
    fun check_and_destroy(escrow: &mut SwapEscrow) {
        let user_processed = escrow.user_claimed || escrow.user_refunded;
        let resolver_processed = escrow.resolver_claimed || escrow.resolver_refunded;
        
        if (user_processed && resolver_processed) {
            destroy_escrow(escrow);
        };
    }

    // Destroy the escrow contract
    fun destroy_escrow(escrow: &mut SwapEscrow) {
        escrow.is_destroyed = true;
        
        event::emit(EscrowDestroyed {
            swap_id: escrow.swap_id,
            escrow_id: object::id(escrow),
        });

        if (string::length(&escrow.revealed_secret) > 0) {
            event::emit(SwapCompleted {
                swap_id: escrow.swap_id,
                secret: escrow.revealed_secret,
            });
        };
    }

    // Force destroy escrow (emergency or cleanup)
    public fun force_destroy(
        escrow: &mut SwapEscrow,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(!escrow.is_destroyed, E_ESCROW_DESTROYED);
        
        let current_time = clock::timestamp_ms(clock);
        let _sender = tx_context::sender(ctx);
        
        // Allow force destroy if:
        // 1. Both timelocks have expired + cleanup delay
        // 2. Factory owner (would need to pass factory reference)
        let can_force_destroy = (
            current_time > escrow.user_timelock + CLEANUP_DELAY &&
            current_time > escrow.resolver_timelock + CLEANUP_DELAY
        );
        
        assert!(can_force_destroy, E_NOT_EXPIRED);
        
        destroy_escrow(escrow);
    }

    // Helper function to check if resolver is registered
    public fun is_resolver_registered(factory: &SwapEscrowFactory, resolver: address): bool {
        let len = vector::length(&factory.resolvers);
        let mut i = 0;
        while (i < len) {
            if (*vector::borrow(&factory.resolvers, i) == resolver) {
                let stake = *vector::borrow(&factory.resolver_stakes, i);
                return stake >= factory.min_resolver_stake
            };
            i = i + 1;
        };
        false
    }

    // Get escrow status
    public fun get_escrow_status(escrow: &SwapEscrow): (
        bool, bool, bool, bool, bool, bool, bool, bool
    ) {
        (
            escrow.user_locked,
            escrow.user_claimed,
            escrow.user_refunded,
            escrow.resolver_locked,
            escrow.resolver_claimed,
            escrow.resolver_refunded,
            string::length(&escrow.revealed_secret) > 0,
            escrow.is_destroyed
        )
    }

    // Check if side can be claimed
    public fun can_claim(escrow: &SwapEscrow, side: u8, clock: &Clock): bool {
        let current_time = clock::timestamp_ms(clock);
        
        if (side == 0) {
            escrow.user_locked && 
            !escrow.user_claimed && 
            !escrow.user_refunded && 
            current_time <= escrow.user_timelock
        } else {
            escrow.resolver_locked && 
            !escrow.resolver_claimed && 
            !escrow.resolver_refunded && 
            current_time <= escrow.resolver_timelock
        }
    }

    // Check if side can be refunded
    public fun can_refund(escrow: &SwapEscrow, side: u8, clock: &Clock): bool {
        let current_time = clock::timestamp_ms(clock);
        
        if (side == 0) {
            escrow.user_locked && 
            !escrow.user_claimed && 
            !escrow.user_refunded && 
            current_time > escrow.user_timelock
        } else {
            escrow.resolver_locked && 
            !escrow.resolver_claimed && 
            !escrow.resolver_refunded && 
            current_time > escrow.resolver_timelock
        }
    }

    // Test-only functions
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}