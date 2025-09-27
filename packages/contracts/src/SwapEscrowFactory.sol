// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./SwapEscrow.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SwapEscrowFactory
 * @notice Factory contract for creating and managing individual swap escrows
 * @dev Each swap gets its own dedicated escrow contract
 */
contract SwapEscrowFactory is Ownable, ReentrancyGuard {
    
    // Events
    event SwapEscrowCreated(
        bytes32 indexed swapId,
        address indexed escrowAddress,
        address indexed userAddress,
        address resolverAddress,
        bytes32 secretHash,
        uint256 userTimelock,
        uint256 resolverTimelock
    );

    event ResolverRegistered(
        address indexed resolver,
        uint256 stakeAmount
    );

    event ResolverUnregistered(
        address indexed resolver,
        uint256 refundAmount
    );

    event SwapCompleted(
        bytes32 indexed swapId,
        address indexed escrowAddress,
        string secret
    );

    event SwapRefunded(
        bytes32 indexed swapId,
        address indexed escrowAddress
    );

    // State variables
    mapping(bytes32 => address) public swapEscrows;
    mapping(address => SwapEscrow) public escrowContracts;
    mapping(address => uint256) public resolverStakes;
    mapping(address => bool) public authorizedResolvers;
    
    // Resolver tracking
    address[] public resolverList;
    mapping(address => uint256) public resolverIndex;
    
    // Swap tracking
    bytes32[] public activeSwaps;
    mapping(bytes32 => uint256) public swapIndex;
    mapping(bytes32 => SwapInfo) public swapInfo;
    
    struct SwapInfo {
        address user;
        address resolver;
        address escrowAddress;
        bytes32 secretHash;
        uint256 userTimelock;
        uint256 resolverTimelock;
        uint256 createdAt;
        SwapStatus status;
    }
    
    enum SwapStatus {
        CREATED,
        USER_LOCKED,
        RESOLVER_LOCKED,
        BOTH_LOCKED,
        COMPLETED,
        REFUNDED,
        EXPIRED
    }
    
    // Constants
    uint256 public constant MIN_RESOLVER_STAKE = 1 ether;
    uint256 public constant MIN_TIMELOCK_BUFFER = 30 minutes;
    uint256 public constant MAX_SWAP_DURATION = 24 hours;
    uint256 public constant CLEANUP_DELAY = 1 hours;

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register as a resolver with stake
     */
    function registerResolver() external payable {
        require(msg.value >= MIN_RESOLVER_STAKE, "Insufficient stake");
        require(!authorizedResolvers[msg.sender], "Already registered");
        
        resolverStakes[msg.sender] = msg.value;
        authorizedResolvers[msg.sender] = true;
        
        // Add to resolver list
        resolverIndex[msg.sender] = resolverList.length;
        resolverList.push(msg.sender);
        
        emit ResolverRegistered(msg.sender, msg.value);
    }

    /**
     * @notice Unregister resolver and refund stake
     */
    function unregisterResolver() external nonReentrant {
        require(authorizedResolvers[msg.sender], "Not registered");
        require(resolverStakes[msg.sender] > 0, "No stake to refund");
        
        uint256 stakeAmount = resolverStakes[msg.sender];
        resolverStakes[msg.sender] = 0;
        authorizedResolvers[msg.sender] = false;
        
        // Remove from resolver list
        uint256 index = resolverIndex[msg.sender];
        uint256 lastIndex = resolverList.length - 1;
        
        if (index != lastIndex) {
            address lastResolver = resolverList[lastIndex];
            resolverList[index] = lastResolver;
            resolverIndex[lastResolver] = index;
        }
        
        resolverList.pop();
        delete resolverIndex[msg.sender];
        
        // Refund stake
        payable(msg.sender).transfer(stakeAmount);
        
        emit ResolverUnregistered(msg.sender, stakeAmount);
    }

    /**
     * @notice Create a new swap escrow
     * @param swapId Unique identifier for the swap
     * @param resolver Address of the chosen resolver
     * @param secretHash Hash of the secret for atomic swap
     * @param userTimelock Timelock for user's funds
     * @param resolverTimelock Timelock for resolver's funds
     */
    function createSwapEscrow(
        bytes32 swapId,
        address resolver,
        bytes32 secretHash,
        uint256 userTimelock,
        uint256 resolverTimelock
    ) external returns (address escrowAddress) {
        require(swapEscrows[swapId] == address(0), "Swap already exists");
        require(authorizedResolvers[resolver], "Resolver not authorized");
        require(secretHash != bytes32(0), "Invalid secret hash");
        require(userTimelock > block.timestamp, "Invalid user timelock");
        require(resolverTimelock > block.timestamp, "Invalid resolver timelock");
        require(userTimelock <= block.timestamp + MAX_SWAP_DURATION, "User timelock too long");
        require(resolverTimelock + MIN_TIMELOCK_BUFFER <= userTimelock, "Invalid timelock relationship");

        // Deploy new escrow contract
        SwapEscrow escrow = new SwapEscrow(
            swapId,
            msg.sender,
            resolver,
            secretHash,
            userTimelock,
            resolverTimelock
        );
        
        escrowAddress = address(escrow);
        swapEscrows[swapId] = escrowAddress;
        escrowContracts[escrowAddress] = escrow;
        
        // Track swap info
        swapInfo[swapId] = SwapInfo({
            user: msg.sender,
            resolver: resolver,
            escrowAddress: escrowAddress,
            secretHash: secretHash,
            userTimelock: userTimelock,
            resolverTimelock: resolverTimelock,
            createdAt: block.timestamp,
            status: SwapStatus.CREATED
        });
        
        // Add to active swaps
        swapIndex[swapId] = activeSwaps.length;
        activeSwaps.push(swapId);
        
        emit SwapEscrowCreated(
            swapId,
            escrowAddress,
            msg.sender,
            resolver,
            secretHash,
            userTimelock,
            resolverTimelock
        );
        
        return escrowAddress;
    }

    /**
     * @notice Update swap status (called by monitoring service)
     */
    function updateSwapStatus(bytes32 swapId, SwapStatus newStatus) external onlyOwner {
        require(swapEscrows[swapId] != address(0), "Swap does not exist");
        swapInfo[swapId].status = newStatus;
        
        if (newStatus == SwapStatus.COMPLETED || newStatus == SwapStatus.REFUNDED || newStatus == SwapStatus.EXPIRED) {
            _removeFromActiveSwaps(swapId);
        }
    }

    /**
     * @notice Clean up completed/expired escrows
     * @param swapIds Array of swap IDs to clean up
     */
    function cleanupEscrows(bytes32[] calldata swapIds) external {
        for (uint256 i = 0; i < swapIds.length; i++) {
            bytes32 swapId = swapIds[i];
            SwapInfo memory info = swapInfo[swapId];
            
            if (info.escrowAddress != address(0)) {
                // Check if escrow can be destroyed
                bool canDestroy = (
                    info.status == SwapStatus.COMPLETED ||
                    info.status == SwapStatus.REFUNDED ||
                    info.status == SwapStatus.EXPIRED ||
                    block.timestamp > info.userTimelock + CLEANUP_DELAY
                );
                
                if (canDestroy) {
                    SwapEscrow escrow = SwapEscrow(info.escrowAddress);
                    try escrow.forceDestroy() {
                        delete swapEscrows[swapId];
                        delete escrowContracts[info.escrowAddress];
                        delete swapInfo[swapId];
                        
                        // Remove from active swaps if still there
                        if (info.status != SwapStatus.COMPLETED && 
                            info.status != SwapStatus.REFUNDED && 
                            info.status != SwapStatus.EXPIRED) {
                            _removeFromActiveSwaps(swapId);
                        }
                    } catch {
                        // Escrow might already be destroyed, continue
                    }
                }
            }
        }
    }

    /**
     * @notice Emergency cleanup of stuck escrow
     */
    function emergencyCleanup(bytes32 swapId) external onlyOwner {
        require(swapEscrows[swapId] != address(0), "Swap does not exist");
        
        SwapInfo memory info = swapInfo[swapId];
        SwapEscrow escrow = SwapEscrow(info.escrowAddress);
        
        try escrow.forceDestroy() {
            delete swapEscrows[swapId];
            delete escrowContracts[info.escrowAddress];
            delete swapInfo[swapId];
            _removeFromActiveSwaps(swapId);
        } catch {
            // If force destroy fails, just remove from tracking
            delete swapEscrows[swapId];
            delete escrowContracts[info.escrowAddress];
            delete swapInfo[swapId];
            _removeFromActiveSwaps(swapId);
        }
    }

    /**
     * @notice Remove swap from active list
     */
    function _removeFromActiveSwaps(bytes32 swapId) internal {
        uint256 index = swapIndex[swapId];
        uint256 lastIndex = activeSwaps.length - 1;
        
        if (index != lastIndex) {
            bytes32 lastSwapId = activeSwaps[lastIndex];
            activeSwaps[index] = lastSwapId;
            swapIndex[lastSwapId] = index;
        }
        
        activeSwaps.pop();
        delete swapIndex[swapId];
    }

    /**
     * @notice Get all active resolvers
     */
    function getActiveResolvers() external view returns (address[] memory) {
        return resolverList;
    }

    /**
     * @notice Get all active swaps
     */
    function getActiveSwaps() external view returns (bytes32[] memory) {
        return activeSwaps;
    }

    /**
     * @notice Get swap details
     */
    function getSwapInfo(bytes32 swapId) external view returns (SwapInfo memory) {
        return swapInfo[swapId];
    }

    /**
     * @notice Check if resolver is authorized
     */
    function isAuthorizedResolver(address resolver) external view returns (bool) {
        return authorizedResolvers[resolver];
    }

    /**
     * @notice Get resolver stake amount
     */
    function getResolverStake(address resolver) external view returns (uint256) {
        return resolverStakes[resolver];
    }

    /**
     * @notice Get factory statistics
     */
    function getFactoryStats() external view returns (
        uint256 totalResolvers,
        uint256 activeSwapsCount,
        uint256 totalStaked
    ) {
        totalResolvers = resolverList.length;
        activeSwapsCount = activeSwaps.length;
        
        for (uint256 i = 0; i < resolverList.length; i++) {
            totalStaked += resolverStakes[resolverList[i]];
        }
    }

    /**
     * @notice Receive function to accept ETH for stakes
     */
    receive() external payable {
        // Accept ETH for resolver stakes and escrow operations
    }
}