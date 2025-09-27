module sui_resolver::safe_record {
    use sui::object::{UID, ID};
    use sui::tx_context::TxContext;
    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::table::{Self, Table};
    use sui::event;
    use std::string::String;
    use sui_resolver::hash_utility;
    use sui_resolver::safe_escrow::{Self, SafeOwnerCap};

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
        
        let amount = coin::value(&coin);
        
        // Create the safe
        let owner_cap = if (use_sha256) {
            safe_escrow::create_safe_sha256<T>(coin, beneficiary, secret_hash, lock_duration, clock, ctx)
        } else {
            safe_escrow::create_safe<T>(coin, beneficiary, secret_hash, lock_duration, clock, ctx)
        };
        
        let safe_id = safe_escrow::get_owner_cap_safe_id(&owner_cap);
        let owner = tx_context::sender(ctx);
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
        _ctx: &mut TxContext
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
        let mut active_safes = vector::empty<ID>();
        let mut i = 0;
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