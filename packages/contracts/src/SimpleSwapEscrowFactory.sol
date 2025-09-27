// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./SwapEscrow.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleSwapEscrowFactory
 * @notice Simplified factory for creating swap escrows (reduced size for deployment)
 */
contract SimpleSwapEscrowFactory is Ownable {
    
    // Events
    event SwapEscrowCreated(
        bytes32 indexed swapId,
        address indexed escrowAddress,
        address indexed userAddress,
        address resolverAddress
    );

    event ResolverRegistered(address indexed resolver, uint256 stakeAmount);

    // State variables
    mapping(bytes32 => address) public swapEscrows;
    mapping(address => uint256) public resolverStakes;
    mapping(address => bool) public authorizedResolvers;
    
    // Constants
    uint256 public constant MIN_RESOLVER_STAKE = 1 ether;
    uint256 public constant MIN_TIMELOCK_BUFFER = 30 minutes;
    uint256 public constant MAX_SWAP_DURATION = 24 hours;

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register as a resolver with stake
     */
    function registerResolver() external payable {
        require(msg.value >= MIN_RESOLVER_STAKE, "Insufficient stake");
        require(!authorizedResolvers[msg.sender], "Already registered");
        
        resolverStakes[msg.sender] = msg.value;
        authorizedResolvers[msg.sender] = true;
        
        emit ResolverRegistered(msg.sender, msg.value);
    }

    /**
     * @notice Create a new swap escrow
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
        require(userTimelock <= block.timestamp + MAX_SWAP_DURATION, "Timelock too long");
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
        
        emit SwapEscrowCreated(swapId, escrowAddress, msg.sender, resolver);
        
        return escrowAddress;
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
     * @notice Emergency cleanup function
     */
    function emergencyCleanup(bytes32 swapId) external onlyOwner {
        require(swapEscrows[swapId] != address(0), "Swap does not exist");
        
        SwapEscrow escrow = SwapEscrow(swapEscrows[swapId]);
        escrow.forceDestroy();
        delete swapEscrows[swapId];
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {}
}