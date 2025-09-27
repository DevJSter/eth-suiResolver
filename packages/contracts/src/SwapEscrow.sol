// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SwapEscrow
 * @notice Individual escrow contract for a single bidirectional swap
 * @dev This contract is deployed per swap and destroyed after completion/timeout
 */
contract SwapEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Events
    event EscrowLocked(
        address indexed locker,
        address indexed beneficiary,
        address token,
        uint256 amount,
        bytes32 secretHash,
        uint256 timelock
    );

    event EscrowClaimed(
        address indexed claimer,
        string secret,
        uint256 amount
    );

    event EscrowRefunded(
        address indexed refundee,
        uint256 amount
    );

    event EscrowDestroyed();

    // Struct for escrow side
    struct EscrowSide {
        address locker;
        address beneficiary;
        address token;
        uint256 amount;
        bytes32 secretHash;
        uint256 timelock;
        bool locked;
        bool claimed;
        bool refunded;
    }

    // State variables
    bytes32 public immutable swapId;
    address public immutable factory;
    EscrowSide public userSide;    // User's lock (ETH -> SUI direction)
    EscrowSide public resolverSide; // Resolver's lock (SUI -> ETH direction)
    string public revealedSecret;
    bool public isDestroyed;
    
    // Constants
    address public constant ETH_ADDRESS = address(0);
    uint256 public constant MIN_TIMELOCK_BUFFER = 30 minutes;

    modifier onlyActive() {
        require(!isDestroyed, "Escrow destroyed");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    constructor(
        bytes32 _swapId,
        address _userAddress,
        address _resolverAddress,
        bytes32 _secretHash,
        uint256 _userTimelock,
        uint256 _resolverTimelock
    ) {
        require(_userTimelock > block.timestamp, "Invalid user timelock");
        require(_resolverTimelock > block.timestamp, "Invalid resolver timelock");
        require(_resolverTimelock + MIN_TIMELOCK_BUFFER <= _userTimelock, "Invalid timelock relationship");
        
        swapId = _swapId;
        factory = msg.sender;
        
        // Initialize user side (user locks first)
        userSide = EscrowSide({
            locker: _userAddress,
            beneficiary: _resolverAddress,
            token: ETH_ADDRESS,
            amount: 0,
            secretHash: _secretHash,
            timelock: _userTimelock,
            locked: false,
            claimed: false,
            refunded: false
        });
        
        // Initialize resolver side (resolver locks in response)
        resolverSide = EscrowSide({
            locker: _resolverAddress,
            beneficiary: _userAddress,
            token: ETH_ADDRESS,
            amount: 0,
            secretHash: _secretHash,
            timelock: _resolverTimelock,
            locked: false,
            claimed: false,
            refunded: false
        });
    }

    /**
     * @notice Lock funds on user side (user calls this first)
     */
    function lockUserSide(
        address token,
        uint256 amount
    ) external payable nonReentrant onlyActive {
        require(msg.sender == userSide.locker, "Only user can lock user side");
        require(!userSide.locked, "User side already locked");
        require(block.timestamp <= userSide.timelock, "User timelock expired");

        if (token == ETH_ADDRESS) {
            require(msg.value == amount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        userSide.token = token;
        userSide.amount = amount;
        userSide.locked = true;

        emit EscrowLocked(
            userSide.locker,
            userSide.beneficiary,
            token,
            amount,
            userSide.secretHash,
            userSide.timelock
        );
    }

    /**
     * @notice Lock funds on resolver side (resolver calls this after seeing user lock)
     */
    function lockResolverSide(
        address token,
        uint256 amount
    ) external payable nonReentrant onlyActive {
        require(msg.sender == resolverSide.locker, "Only resolver can lock resolver side");
        require(!resolverSide.locked, "Resolver side already locked");
        require(userSide.locked, "User side must be locked first");
        require(block.timestamp <= resolverSide.timelock, "Resolver timelock expired");

        if (token == ETH_ADDRESS) {
            require(msg.value == amount, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        resolverSide.token = token;
        resolverSide.amount = amount;
        resolverSide.locked = true;

        emit EscrowLocked(
            resolverSide.locker,
            resolverSide.beneficiary,
            token,
            amount,
            resolverSide.secretHash,
            resolverSide.timelock
        );
    }

    /**
     * @notice Claim funds by revealing secret (can be called on either side)
     * @param secret The secret that hashes to secretHash
     * @param side 0 for user side, 1 for resolver side
     */
    function claimFunds(string calldata secret, uint8 side) external nonReentrant onlyActive {
        require(keccak256(abi.encodePacked(secret)) == userSide.secretHash, "Invalid secret");
        
        EscrowSide storage targetSide;
        if (side == 0) {
            targetSide = userSide;
            require(msg.sender == userSide.beneficiary, "Only user side beneficiary");
        } else {
            targetSide = resolverSide;
            require(msg.sender == resolverSide.beneficiary, "Only resolver side beneficiary");
        }

        require(targetSide.locked, "Side not locked");
        require(!targetSide.claimed && !targetSide.refunded, "Already processed");
        require(block.timestamp <= targetSide.timelock, "Timelock expired");

        targetSide.claimed = true;
        revealedSecret = secret;

        // Transfer funds
        if (targetSide.token == ETH_ADDRESS) {
            payable(targetSide.beneficiary).transfer(targetSide.amount);
        } else {
            IERC20(targetSide.token).safeTransfer(targetSide.beneficiary, targetSide.amount);
        }

        emit EscrowClaimed(targetSide.beneficiary, secret, targetSide.amount);

        // Auto-claim other side if secret is revealed and other side is locked
        _autoClaimOtherSide(side, secret);
        
        // Check if swap is complete and destroy if both sides processed
        _checkAndDestroy();
    }

    /**
     * @notice Refund funds after timelock expiry
     * @param side 0 for user side, 1 for resolver side
     */
    function refundFunds(uint8 side) external nonReentrant onlyActive {
        EscrowSide storage targetSide = (side == 0) ? userSide : resolverSide;
        
        require(msg.sender == targetSide.locker, "Only locker can refund");
        require(targetSide.locked, "Side not locked");
        require(!targetSide.claimed && !targetSide.refunded, "Already processed");
        require(block.timestamp > targetSide.timelock, "Timelock not expired");

        targetSide.refunded = true;

        // Refund funds
        if (targetSide.token == ETH_ADDRESS) {
            payable(targetSide.locker).transfer(targetSide.amount);
        } else {
            IERC20(targetSide.token).safeTransfer(targetSide.locker, targetSide.amount);
        }

        emit EscrowRefunded(targetSide.locker, targetSide.amount);
        
        // Check if swap is complete and destroy
        _checkAndDestroy();
    }

    /**
     * @notice Auto-claim other side if secret is revealed
     */
    function _autoClaimOtherSide(uint8 claimedSide, string calldata secret) internal {
        EscrowSide storage otherSide = (claimedSide == 0) ? resolverSide : userSide;
        
        if (otherSide.locked && !otherSide.claimed && !otherSide.refunded && block.timestamp <= otherSide.timelock) {
            otherSide.claimed = true;
            
            // Transfer funds
            if (otherSide.token == ETH_ADDRESS) {
                payable(otherSide.beneficiary).transfer(otherSide.amount);
            } else {
                IERC20(otherSide.token).safeTransfer(otherSide.beneficiary, otherSide.amount);
            }
            
            emit EscrowClaimed(otherSide.beneficiary, secret, otherSide.amount);
        }
    }

    /**
     * @notice Check if both sides are processed and destroy contract
     */
    function _checkAndDestroy() internal {
        bool userProcessed = userSide.claimed || userSide.refunded || (!userSide.locked && block.timestamp > userSide.timelock);
        bool resolverProcessed = resolverSide.claimed || resolverSide.refunded || (!resolverSide.locked && block.timestamp > resolverSide.timelock);
        
        if (userProcessed && resolverProcessed) {
            _destroyEscrow();
        }
    }

    /**
     * @notice Force destroy escrow (emergency or timeout)
     */
    function forceDestroy() external onlyActive {
        require(
            msg.sender == factory || 
            (block.timestamp > userSide.timelock + 1 hours && block.timestamp > resolverSide.timelock + 1 hours),
            "Cannot force destroy yet"
        );
        _destroyEscrow();
    }

    /**
     * @notice Internal destroy function
     */
    function _destroyEscrow() internal {
        isDestroyed = true;
        emit EscrowDestroyed();
        
        // Self-destruct and send any remaining balance to factory
        selfdestruct(payable(factory));
    }

    /**
     * @notice Get escrow status
     */
    function getStatus() external view returns (
        bool userLocked,
        bool userClaimed,
        bool userRefunded,
        bool resolverLocked,
        bool resolverClaimed,
        bool resolverRefunded,
        bool secretRevealed,
        bool destroyed
    ) {
        return (
            userSide.locked,
            userSide.claimed,
            userSide.refunded,
            resolverSide.locked,
            resolverSide.claimed,
            resolverSide.refunded,
            bytes(revealedSecret).length > 0,
            isDestroyed
        );
    }

    /**
     * @notice Check if escrow can be claimed
     */
    function canClaim(uint8 side) external view returns (bool) {
        EscrowSide storage targetSide = (side == 0) ? userSide : resolverSide;
        return targetSide.locked && 
               !targetSide.claimed && 
               !targetSide.refunded && 
               block.timestamp <= targetSide.timelock;
    }

    /**
     * @notice Check if escrow can be refunded
     */
    function canRefund(uint8 side) external view returns (bool) {
        EscrowSide storage targetSide = (side == 0) ? userSide : resolverSide;
        return targetSide.locked && 
               !targetSide.claimed && 
               !targetSide.refunded && 
               block.timestamp > targetSide.timelock;
    }
}