/// Fusion+ Sui Resolver Staking Module
/// Manages resolver economic incentives and reputation on Sui

module fusion_plus::sui_resolver_staking {

    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::table::{Self, Table};
    use sui::event;

    use sui::balance::{Self, Balance};

    // Error codes
    const EResolverNotFound: u64 = 1;
    const EInsufficientStake: u64 = 2;



    // Constants
    const MIN_STAKE_AMOUNT: u64 = 1_000_000_000; // 1 SUI


    public struct ResolverInfo has store {
        staked_amount: u64,
        reputation: u64,
        total_swaps: u64,
        successful_swaps: u64,
        is_active: bool,
    }

    public struct StakingPool has key {
        id: UID,
        total_staked: Balance<SUI>,
        resolvers: Table<address, ResolverInfo>,
        slashing_agents: Table<address, bool>,
        admin: address,
    }

    // Events
    public struct ResolverRegistered has copy, drop {
        resolver: address,
        stake_amount: u64,
    }

    #[allow(unused_field)]
    public struct ResolverSlashed has copy, drop {
        resolver: address,
        slashed_amount: u64,
        reason: vector<u8>,
    }

    // Initialize staking pool
    fun init(ctx: &mut TxContext) {
        let pool = StakingPool {
            id: object::new(ctx),
            total_staked: balance::zero<SUI>(),
            resolvers: table::new<address, ResolverInfo>(ctx),
            slashing_agents: table::new<address, bool>(ctx),
            admin: tx_context::sender(ctx),
        };
        transfer::share_object(pool);
    }

    /// Register as resolver by staking SUI
    public fun register_resolver(
        pool: &mut StakingPool,
        stake_coin: Coin<SUI>,
        ctx: &mut TxContext
    ) {
        let stake_amount = coin::value(&stake_coin);
        let resolver_addr = tx_context::sender(ctx);
        
        assert!(stake_amount >= MIN_STAKE_AMOUNT, EInsufficientStake);
        assert!(!table::contains(&pool.resolvers, resolver_addr), EResolverNotFound);

        // Add stake to pool
        coin::put(&mut pool.total_staked, stake_coin);

        // Register resolver
        let resolver_info = ResolverInfo {
            staked_amount: stake_amount,
            reputation: 100,
            total_swaps: 0,
            successful_swaps: 0,
            is_active: true,
        };

        table::add(&mut pool.resolvers, resolver_addr, resolver_info);

        event::emit(ResolverRegistered {
            resolver: resolver_addr,
            stake_amount,
        });
    }

    /// View functions
    public fun get_resolver_stake(pool: &StakingPool, resolver: address): u64 {
        if (table::contains(&pool.resolvers, resolver)) {
            table::borrow(&pool.resolvers, resolver).staked_amount
        } else {
            0
        }
    }

    public fun is_resolver_active(pool: &StakingPool, resolver: address): bool {
        if (table::contains(&pool.resolvers, resolver)) {
            table::borrow(&pool.resolvers, resolver).is_active
        } else {
            false
        }
    }
}
