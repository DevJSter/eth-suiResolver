// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EthereumFusionEscrow
 * @notice Core escrow contract for Fusion+ cross-chain swaps on Ethereum
 * @dev Handles intent-based order creation and execution with hash time locks
 */
contract EthereumFusionEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // HTLC Events
    event HTLCLocked(
        bytes32 indexed htlcId,
        address indexed sender,
        address indexed beneficiary,
        address token,
        uint256 amount,
        bytes32 hashLock,
        uint256 timelock
    );

    event HTLCClaimed(
        bytes32 indexed htlcId,
        address indexed claimer,
        bytes32 secret
    );

    event HTLCRefunded(
        bytes32 indexed htlcId,
        address indexed sender
    );

    // Legacy Events (for backward compatibility)
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed requester,
        address indexed resolver,
        address tokenIn,
        uint256 amountIn,
        bytes32 secretHash,
        uint256 expiry
    );

    event OrderExecuted(
        bytes32 indexed orderId,
        address indexed resolver,
        bytes32 secret
    );

    event OrderRefunded(
        bytes32 indexed orderId,
        address indexed requester
    );

    event ResolverRegistered(
        address indexed resolver,
        uint256 stakeAmount
    );

    // Cross-chain secret monitoring
    event SecretRevealed(bytes32 indexed orderId, string secret);

    // HTLC Structs
    struct HTLC {
        address sender;
        address beneficiary;
        address token;
        uint256 amount;
        bytes32 hashLock;
        uint256 timelock;
        bool claimed;
        bool refunded;
    }

    // Legacy Order struct for backward compatibility
    struct Order {
        address requester;
        address resolver;
        address tokenIn;
        uint256 amountIn;
        bytes32 secretHash;
        uint256 expiry;
        bool executed;
        bool refunded;
    }

    // State variables
    mapping(bytes32 => HTLC) public htlcs;
    mapping(bytes32 => Order) public orders; // Legacy mapping for backward compatibility
    mapping(address => uint256) public resolverStakes;
    mapping(bytes32 => bytes32) public secretPreimages; // Store revealed secrets
    
    uint256 public constant MIN_RESOLVER_STAKE = 1 ether;
    uint256 public constant MIN_LOCK_DURATION = 1 hours;
    uint256 public constant MAX_LOCK_DURATION = 24 hours;
    uint256 public constant MIN_RESOLVER_TIMELOCK_OFFSET = 30 minutes; // T_resolver must be at least 30 min less than T_requester

    address public constant ETH_ADDRESS = address(0);

    // Nonce for preventing replay attacks
    mapping(address => uint256) public nonces;

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register as a resolver by staking ETH
     */
    function registerResolver() external payable {
        require(msg.value >= MIN_RESOLVER_STAKE, "Insufficient stake");
        resolverStakes[msg.sender] += msg.value;
        emit ResolverRegistered(msg.sender, msg.value);
    }

    /**
     * @notice Lock funds in HTLC (dual-side flow)
     * @param htlcId Unique identifier for the HTLC
     * @param beneficiary Address that can claim the funds
     * @param token Token to lock (address(0) for ETH)
     * @param amount Amount to lock
     * @param hashLock Hash of the secret (H = hash(secret))
     * @param timelock Timestamp when funds can be refunded
     */
    function lockFunds(
        bytes32 htlcId,
        address beneficiary,
        address token,
        uint256 amount,
        bytes32 hashLock,
        uint256 timelock
    ) external payable nonReentrant {
        require(htlcs[htlcId].sender == address(0), "HTLC already exists");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(hashLock != bytes32(0), "Invalid hash lock");
        require(timelock > block.timestamp, "Invalid timelock");
        require(timelock <= block.timestamp + MAX_LOCK_DURATION, "Timelock too long");

        if (token == ETH_ADDRESS) {
            require(msg.value == amount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        htlcs[htlcId] = HTLC({
            sender: msg.sender,
            beneficiary: beneficiary,
            token: token,
            amount: amount,
            hashLock: hashLock,
            timelock: timelock,
            claimed: false,
            refunded: false
        });

        emit HTLCLocked(htlcId, msg.sender, beneficiary, token, amount, hashLock, timelock);
    }

    /**
     * @notice Claim funds from HTLC by revealing the secret
     * @param htlcId HTLC identifier
     * @param secret The secret that hashes to hashLock
     */
    function claimFunds(bytes32 htlcId, string calldata secret) external nonReentrant {
        HTLC storage htlc = htlcs[htlcId];
        
        require(htlc.sender != address(0), "HTLC does not exist");
        require(msg.sender == htlc.beneficiary, "Only beneficiary can claim");
        require(!htlc.claimed && !htlc.refunded, "HTLC already processed");
        require(block.timestamp <= htlc.timelock, "HTLC expired");
        require(keccak256(abi.encodePacked(secret)) == htlc.hashLock, "Invalid secret");

        htlc.claimed = true;
        
        // Store the secret for cross-chain monitoring
        secretPreimages[htlc.hashLock] = keccak256(abi.encodePacked(secret));

        // Transfer funds to beneficiary
        if (htlc.token == ETH_ADDRESS) {
            payable(htlc.beneficiary).transfer(htlc.amount);
        } else {
            IERC20(htlc.token).safeTransfer(htlc.beneficiary, htlc.amount);
        }

        emit HTLCClaimed(htlcId, htlc.beneficiary, keccak256(abi.encodePacked(secret)));
        emit SecretRevealed(htlcId, secret);
    }

    /**
     * @notice Refund HTLC after timelock expiry
     * @param htlcId HTLC identifier
     */
    function refundHTLC(bytes32 htlcId) external nonReentrant {
        HTLC storage htlc = htlcs[htlcId];
        
        require(htlc.sender != address(0), "HTLC does not exist");
        require(msg.sender == htlc.sender, "Only sender can refund");
        require(!htlc.claimed && !htlc.refunded, "HTLC already processed");
        require(block.timestamp > htlc.timelock, "HTLC not expired");

        htlc.refunded = true;

        // Refund to sender
        if (htlc.token == ETH_ADDRESS) {
            payable(htlc.sender).transfer(htlc.amount);
        } else {
            IERC20(htlc.token).safeTransfer(htlc.sender, htlc.amount);
        }

        emit HTLCRefunded(htlcId, htlc.sender);
    }

    /**
     * @notice Create a cross-chain swap order
     * @param orderId Unique identifier for the order
     * @param resolver Address of the resolver to fulfill the order
     * @param tokenIn Token to swap (address(0) for ETH)
     * @param amountIn Amount to swap
     * @param secretHash Hash of the secret for atomic swap
     * @param lockDuration Duration to lock funds
     */
    function createOrder(
        bytes32 orderId,
        address resolver,
        address tokenIn,
        uint256 amountIn,
        bytes32 secretHash,
        uint256 lockDuration
    ) external payable nonReentrant {
        require(orders[orderId].requester == address(0), "Order already exists");
        require(resolver != address(0), "Invalid resolver");
        require(resolverStakes[resolver] >= MIN_RESOLVER_STAKE, "Resolver not registered");
        require(lockDuration >= MIN_LOCK_DURATION && lockDuration <= MAX_LOCK_DURATION, "Invalid lock duration");
        require(secretHash != bytes32(0), "Invalid secret hash");

        uint256 expiry = block.timestamp + lockDuration;

        if (tokenIn == ETH_ADDRESS) {
            require(msg.value == amountIn, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected");
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        orders[orderId] = Order({
            requester: msg.sender,
            resolver: resolver,
            tokenIn: tokenIn,
            amountIn: amountIn,
            secretHash: secretHash,
            expiry: expiry,
            executed: false,
            refunded: false
        });

        emit OrderCreated(orderId, msg.sender, resolver, tokenIn, amountIn, secretHash, expiry);
    }

    /**
     * @notice Execute order by revealing the secret (resolver only) - LEGACY
     * @param orderId Order to execute
     * @param secret The secret that hashes to secretHash
     */
    function executeOrder(bytes32 orderId, string calldata secret) external nonReentrant {
        Order storage order = orders[orderId];
        
        require(order.requester != address(0), "Order does not exist");
        require(msg.sender == order.resolver, "Only designated resolver");
        require(!order.executed && !order.refunded, "Order already processed");
        require(block.timestamp <= order.expiry, "Order expired");
        require(keccak256(abi.encodePacked(secret)) == order.secretHash, "Invalid secret");

        order.executed = true;

        // Transfer tokens to resolver
        if (order.tokenIn == ETH_ADDRESS) {
            payable(order.resolver).transfer(order.amountIn);
        } else {
            IERC20(order.tokenIn).safeTransfer(order.resolver, order.amountIn);
        }

        // Emit secret for cross-chain monitoring
        emit OrderExecuted(orderId, order.resolver, keccak256(abi.encodePacked(secret)));
        emit SecretRevealed(orderId, secret);
    }

    /**
     * @notice Refund order after expiry (requester only)
     * @param orderId Order to refund
     */
    function refundOrder(bytes32 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        
        require(order.requester != address(0), "Order does not exist");
        require(msg.sender == order.requester, "Only requester");
        require(!order.executed && !order.refunded, "Order already processed");
        require(block.timestamp > order.expiry, "Order not expired");

        order.refunded = true;

        // Refund tokens to requester
        if (order.tokenIn == ETH_ADDRESS) {
            payable(order.requester).transfer(order.amountIn);
        } else {
            IERC20(order.tokenIn).safeTransfer(order.requester, order.amountIn);
        }

        emit OrderRefunded(orderId, order.requester);
    }

    /**
     * @notice Withdraw resolver stake (resolver only)
     * @param amount Amount to withdraw
     */
    function withdrawStake(uint256 amount) external nonReentrant {
        require(resolverStakes[msg.sender] >= amount, "Insufficient stake");
        require(resolverStakes[msg.sender] - amount >= MIN_RESOLVER_STAKE, "Must maintain minimum stake");
        
        resolverStakes[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    /**
     * @notice Get order details
     * @param orderId Order ID to query
     */
    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Check if order is active (not executed, refunded, or expired) - LEGACY
     * @param orderId Order ID to check
     */
    function isOrderActive(bytes32 orderId) external view returns (bool) {
        Order memory order = orders[orderId];
        return order.requester != address(0) && 
               !order.executed && 
               !order.refunded && 
               block.timestamp <= order.expiry;
    }

    /**
     * @notice Get HTLC details
     * @param htlcId HTLC ID to query
     */
    function getHTLC(bytes32 htlcId) external view returns (HTLC memory) {
        return htlcs[htlcId];
    }

    /**
     * @notice Check if HTLC is active (exists, not claimed/refunded, not expired)
     * @param htlcId HTLC ID to check
     */
    function isHTLCActive(bytes32 htlcId) external view returns (bool) {
        HTLC memory htlc = htlcs[htlcId];
        return htlc.sender != address(0) && 
               !htlc.claimed && 
               !htlc.refunded && 
               block.timestamp <= htlc.timelock;
    }

    /**
     * @notice Check if HTLC can be refunded
     * @param htlcId HTLC ID to check
     */
    function canRefundHTLC(bytes32 htlcId) external view returns (bool) {
        HTLC memory htlc = htlcs[htlcId];
        return htlc.sender != address(0) && 
               !htlc.claimed && 
               !htlc.refunded && 
               block.timestamp > htlc.timelock;
    }

    /**
     * @notice Check if secret has been revealed for a hashLock
     * @param hashLock The hash lock to check
     */
    function isSecretRevealed(bytes32 hashLock) external view returns (bool) {
        return secretPreimages[hashLock] != bytes32(0);
    }

    /**
     * @notice Get revealed secret hash for a hashLock
     * @param hashLock The hash lock to query
     */
    function getRevealedSecret(bytes32 hashLock) external view returns (bytes32) {
        return secretPreimages[hashLock];
    }

    /**
     * @notice Validate timelock relationship for dual-side HTLC
     * @param requesterTimelock Timelock for requester's HTLC
     * @param resolverTimelock Timelock for resolver's HTLC
     */
    function validateTimelocks(uint256 requesterTimelock, uint256 resolverTimelock) external pure returns (bool) {
        // Resolver timelock must be shorter to prevent abuse
        return resolverTimelock + MIN_RESOLVER_TIMELOCK_OFFSET <= requesterTimelock;
    }

    /**
     * @notice Generate HTLC ID from order parameters
     * @param orderId Base order identifier
     * @param sender Address of the sender
     * @param nonce Nonce for uniqueness
     */
    function generateHTLCId(bytes32 orderId, address sender, uint256 nonce) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(orderId, sender, nonce));
    }

    /**
     * @notice Get and increment nonce for an address
     * @param account Address to get nonce for
     */
    function getNonceAndIncrement(address account) external returns (uint256) {
        uint256 currentNonce = nonces[account];
        nonces[account]++;
        return currentNonce;
    }

    /**
     * @notice Get current nonce for an address
     * @param account Address to get nonce for
     */
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }
}