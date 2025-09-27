// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EthereumResolverStaking
 * @notice Staking and slashing contract for Fusion+ resolvers
 * @dev Manages resolver economic incentives and reputation
 */
contract EthereumResolverStaking is ReentrancyGuard, Ownable {
    
    // Events
    event ResolverStaked(address indexed resolver, uint256 amount, uint256 totalStake);
    event ResolverUnstaked(address indexed resolver, uint256 amount, uint256 remainingStake);
    event ResolverSlashed(address indexed resolver, uint256 amount, bytes32 reason);
    event ResolverReputationUpdated(address indexed resolver, uint256 newReputation);

    // Structs
    struct ResolverInfo {
        uint256 stakedAmount;
        uint256 reputation; // Score out of 1000 (100.0%)
        uint256 totalSwaps;
        uint256 successfulSwaps;
        uint256 lastSlashTime;
        bool isActive;
    }

    // State variables
    mapping(address => ResolverInfo) public resolvers;
    mapping(address => bool) public authorizedSlashers; // Authorized contracts that can slash
    
    uint256 public constant MIN_STAKE = 1 ether;
    uint256 public constant MAX_REPUTATION = 1000;
    uint256 public constant INITIAL_REPUTATION = 500;
    uint256 public constant SLASH_COOLDOWN = 1 days;
    
    uint256 public totalStaked;

    constructor() Ownable(msg.sender) {
        // Owner is initially authorized to slash
        authorizedSlashers[msg.sender] = true;
    }

    modifier onlyAuthorizedSlasher() {
        require(authorizedSlashers[msg.sender], "Not authorized to slash");
        _;
    }

    /**
     * @notice Stake ETH to become a resolver
     */
    function stake() external payable nonReentrant {
        require(msg.value > 0, "Must stake some ETH");
        
        ResolverInfo storage resolver = resolvers[msg.sender];
        resolver.stakedAmount += msg.value;
        totalStaked += msg.value;

        // Initialize reputation for new resolvers
        if (!resolver.isActive) {
            resolver.reputation = INITIAL_REPUTATION;
            resolver.isActive = true;
        }

        emit ResolverStaked(msg.sender, msg.value, resolver.stakedAmount);
    }

    /**
     * @notice Unstake ETH (must maintain minimum stake)
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant {
        ResolverInfo storage resolver = resolvers[msg.sender];
        require(resolver.stakedAmount >= amount, "Insufficient staked amount");
        require(resolver.stakedAmount - amount >= MIN_STAKE, "Must maintain minimum stake");

        resolver.stakedAmount -= amount;
        totalStaked -= amount;

        payable(msg.sender).transfer(amount);

        emit ResolverUnstaked(msg.sender, amount, resolver.stakedAmount);
    }

    /**
     * @notice Completely withdraw from being a resolver
     */
    function withdrawAll() external nonReentrant {
        ResolverInfo storage resolver = resolvers[msg.sender];
        require(resolver.stakedAmount > 0, "No stake to withdraw");
        require(block.timestamp > resolver.lastSlashTime + SLASH_COOLDOWN, "Slash cooldown active");

        uint256 amount = resolver.stakedAmount;
        resolver.stakedAmount = 0;
        resolver.isActive = false;
        totalStaked -= amount;

        payable(msg.sender).transfer(amount);

        emit ResolverUnstaked(msg.sender, amount, 0);
    }

    /**
     * @notice Slash a resolver for misbehavior
     * @param resolver Address of resolver to slash
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slash(address resolver, uint256 amount, bytes32 reason) external onlyAuthorizedSlasher nonReentrant {
        ResolverInfo storage resolverInfo = resolvers[resolver];
        require(resolverInfo.isActive, "Resolver not active");
        require(resolverInfo.stakedAmount >= amount, "Insufficient stake to slash");

        resolverInfo.stakedAmount -= amount;
        resolverInfo.lastSlashTime = block.timestamp;
        totalStaked -= amount;

        // Reduce reputation based on slash severity
        uint256 reputationPenalty = (amount * 100) / resolverInfo.stakedAmount; // Percentage of stake slashed
        if (resolverInfo.reputation > reputationPenalty) {
            resolverInfo.reputation -= reputationPenalty;
        } else {
            resolverInfo.reputation = 0;
        }

        // Send slashed amount to owner (could be treasury)
        payable(owner()).transfer(amount);

        emit ResolverSlashed(resolver, amount, reason);
        emit ResolverReputationUpdated(resolver, resolverInfo.reputation);
    }

    /**
     * @notice Update resolver reputation after successful swap
     * @param resolver Address of resolver
     * @param successful Whether the swap was successful
     */
    function updateResolverStats(address resolver, bool successful) external onlyAuthorizedSlasher {
        ResolverInfo storage resolverInfo = resolvers[resolver];
        require(resolverInfo.isActive, "Resolver not active");

        resolverInfo.totalSwaps++;
        if (successful) {
            resolverInfo.successfulSwaps++;
            
            // Increase reputation for successful swaps (capped at MAX_REPUTATION)
            if (resolverInfo.reputation < MAX_REPUTATION) {
                resolverInfo.reputation = resolverInfo.reputation + 1 > MAX_REPUTATION 
                    ? MAX_REPUTATION 
                    : resolverInfo.reputation + 1;
            }
        } else {
            // Decrease reputation for failed swaps
            resolverInfo.reputation = resolverInfo.reputation > 5 
                ? resolverInfo.reputation - 5 
                : 0;
        }

        emit ResolverReputationUpdated(resolver, resolverInfo.reputation);
    }

    /**
     * @notice Authorize a contract to slash resolvers
     * @param slasher Address to authorize
     */
    function authorizeSlasher(address slasher) external onlyOwner {
        authorizedSlashers[slasher] = true;
    }

    /**
     * @notice Remove slashing authorization from a contract
     * @param slasher Address to deauthorize
     */
    function deauthorizeSlasher(address slasher) external onlyOwner {
        authorizedSlashers[slasher] = false;
    }

    /**
     * @notice Get resolver information
     * @param resolver Address of resolver
     */
    function getResolverInfo(address resolver) external view returns (ResolverInfo memory) {
        return resolvers[resolver];
    }

    /**
     * @notice Check if resolver meets minimum requirements
     * @param resolver Address of resolver
     */
    function isResolverEligible(address resolver) external view returns (bool) {
        ResolverInfo memory resolverInfo = resolvers[resolver];
        return resolverInfo.isActive && 
               resolverInfo.stakedAmount >= MIN_STAKE &&
               resolverInfo.reputation >= 100; // Minimum 10% reputation
    }

    /**
     * @notice Get resolver success rate
     * @param resolver Address of resolver
     */
    function getResolverSuccessRate(address resolver) external view returns (uint256) {
        ResolverInfo memory resolverInfo = resolvers[resolver];
        if (resolverInfo.totalSwaps == 0) return 0;
        return (resolverInfo.successfulSwaps * 1000) / resolverInfo.totalSwaps; // Returns rate out of 1000
    }

    /**
     * @notice Emergency withdrawal by owner (for contract upgrades)
     */
    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}