// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "./WSUIToken.sol";

/**
 * @title ETHWSUISwap
 * @dev Atomic swap contract for ETH <-> wSUI exchanges using HTLC
 */
contract ETHWSUISwap is ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    WSUIToken public immutable wsuiToken;
    
    // Swap structure
    struct Swap {
        bytes32 secretHash;
        uint256 ethAmount;
        uint256 wsuiAmount;
        address initiator;
        address participant;
        uint256 timelock;
        bool withdrawn;
        bool refunded;
        SwapType swapType;
    }

    enum SwapType {
        ETH_TO_WSUI,  // ETH -> wSUI
        WSUI_TO_ETH   // wSUI -> ETH
    }

    mapping(bytes32 => Swap) public swaps;
    
    // Events
    event SwapInitiated(
        bytes32 indexed swapId,
        bytes32 indexed secretHash,
        address indexed initiator,
        address participant,
        uint256 ethAmount,
        uint256 wsuiAmount,
        uint256 timelock,
        SwapType swapType
    );
    
    event SwapWithdrawn(
        bytes32 indexed swapId,
        address indexed withdrawer,
        bytes32 secret
    );
    
    event SwapRefunded(
        bytes32 indexed swapId,
        address indexed refunder
    );

    // Configuration
    uint256 public constant MIN_TIMELOCK = 1 hours;
    uint256 public constant MAX_TIMELOCK = 48 hours;
    uint256 public swapFee = 30; // 0.3% (30 basis points)
    uint256 public constant MAX_FEE = 1000; // 10% max fee
    
    address public feeRecipient;

    modifier validSwap(bytes32 swapId) {
        require(swaps[swapId].timelock > 0, "ETHWSUISwap: swap does not exist");
        _;
    }

    modifier withdrawable(bytes32 swapId, bytes32 secret) {
        require(!swaps[swapId].withdrawn, "ETHWSUISwap: already withdrawn");
        require(!swaps[swapId].refunded, "ETHWSUISwap: already refunded");
        require(block.timestamp <= swaps[swapId].timelock, "ETHWSUISwap: timelock expired");
        require(sha256(abi.encodePacked(secret)) == swaps[swapId].secretHash, "ETHWSUISwap: invalid secret");
        _;
    }

    modifier refundable(bytes32 swapId) {
        require(!swaps[swapId].withdrawn, "ETHWSUISwap: already withdrawn");
        require(!swaps[swapId].refunded, "ETHWSUISwap: already refunded");
        require(block.timestamp > swaps[swapId].timelock, "ETHWSUISwap: timelock not expired");
        require(msg.sender == swaps[swapId].initiator, "ETHWSUISwap: only initiator can refund");
        _;
    }

    constructor(address _wsuiToken, address _feeRecipient) {
        require(_wsuiToken != address(0), "ETHWSUISwap: invalid wSUI token address");
        require(_feeRecipient != address(0), "ETHWSUISwap: invalid fee recipient");
        
        wsuiToken = WSUIToken(_wsuiToken);
        feeRecipient = _feeRecipient;
        _transferOwnership(msg.sender);
    }

    /**
     * @dev Initiate ETH to wSUI swap
     * @param secretHash SHA256 hash of the secret
     * @param participant Address that can withdraw the wSUI
     * @param wsuiAmount Amount of wSUI to receive
     * @param timelock Expiration time for the swap
     */
    function initiateETHToWSUI(
        bytes32 secretHash,
        address participant,
        uint256 wsuiAmount,
        uint256 timelock
    ) external payable nonReentrant whenNotPaused {
        require(msg.value > 0, "ETHWSUISwap: ETH amount must be greater than 0");
        require(participant != address(0), "ETHWSUISwap: invalid participant address");
        require(participant != msg.sender, "ETHWSUISwap: participant cannot be initiator");
        require(wsuiAmount > 0, "ETHWSUISwap: wSUI amount must be greater than 0");
        require(timelock >= block.timestamp + MIN_TIMELOCK, "ETHWSUISwap: timelock too short");
        require(timelock <= block.timestamp + MAX_TIMELOCK, "ETHWSUISwap: timelock too long");
        require(secretHash != bytes32(0), "ETHWSUISwap: invalid secret hash");

        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender,
            participant,
            secretHash,
            block.timestamp,
            msg.value,
            wsuiAmount
        ));

        require(swaps[swapId].timelock == 0, "ETHWSUISwap: swap already exists");

        swaps[swapId] = Swap({
            secretHash: secretHash,
            ethAmount: msg.value,
            wsuiAmount: wsuiAmount,
            initiator: msg.sender,
            participant: participant,
            timelock: timelock,
            withdrawn: false,
            refunded: false,
            swapType: SwapType.ETH_TO_WSUI
        });

        emit SwapInitiated(
            swapId,
            secretHash,
            msg.sender,
            participant,
            msg.value,
            wsuiAmount,
            timelock,
            SwapType.ETH_TO_WSUI
        );
    }

    /**
     * @dev Initiate wSUI to ETH swap
     * @param secretHash SHA256 hash of the secret
     * @param participant Address that can withdraw the ETH
     * @param wsuiAmount Amount of wSUI to send
     * @param ethAmount Amount of ETH to receive
     * @param timelock Expiration time for the swap
     */
    function initiateWSUIToETH(
        bytes32 secretHash,
        address participant,
        uint256 wsuiAmount,
        uint256 ethAmount,
        uint256 timelock
    ) external nonReentrant whenNotPaused {
        require(wsuiAmount > 0, "ETHWSUISwap: wSUI amount must be greater than 0");
        require(ethAmount > 0, "ETHWSUISwap: ETH amount must be greater than 0");
        require(participant != address(0), "ETHWSUISwap: invalid participant address");
        require(participant != msg.sender, "ETHWSUISwap: participant cannot be initiator");
        require(timelock >= block.timestamp + MIN_TIMELOCK, "ETHWSUISwap: timelock too short");
        require(timelock <= block.timestamp + MAX_TIMELOCK, "ETHWSUISwap: timelock too long");
        require(secretHash != bytes32(0), "ETHWSUISwap: invalid secret hash");

        bytes32 swapId = keccak256(abi.encodePacked(
            msg.sender,
            participant,
            secretHash,
            block.timestamp,
            wsuiAmount,
            ethAmount
        ));

        require(swaps[swapId].timelock == 0, "ETHWSUISwap: swap already exists");

        // Transfer wSUI tokens to this contract
        wsuiToken.safeTransferFrom(msg.sender, address(this), wsuiAmount);

        swaps[swapId] = Swap({
            secretHash: secretHash,
            ethAmount: ethAmount,
            wsuiAmount: wsuiAmount,
            initiator: msg.sender,
            participant: participant,
            timelock: timelock,
            withdrawn: false,
            refunded: false,
            swapType: SwapType.WSUI_TO_ETH
        });

        emit SwapInitiated(
            swapId,
            secretHash,
            msg.sender,
            participant,
            ethAmount,
            wsuiAmount,
            timelock,
            SwapType.WSUI_TO_ETH
        );
    }

    /**
     * @dev Withdraw from a swap by revealing the secret
     * @param swapId The swap identifier
     * @param secret The secret that hashes to secretHash
     */
    function withdraw(bytes32 swapId, bytes32 secret) 
        external 
        nonReentrant 
        validSwap(swapId) 
        withdrawable(swapId, secret) 
    {
        require(msg.sender == swaps[swapId].participant, "ETHWSUISwap: only participant can withdraw");

        Swap storage swap = swaps[swapId];
        swap.withdrawn = true;

        if (swap.swapType == SwapType.ETH_TO_WSUI) {
            // Calculate fee
            uint256 fee = (swap.ethAmount * swapFee) / 10000;
            uint256 netAmount = swap.ethAmount - fee;

            // Transfer ETH to participant
            (bool success, ) = payable(swap.participant).call{value: netAmount}("");
            require(success, "ETHWSUISwap: ETH transfer failed");

            // Transfer fee to fee recipient
            if (fee > 0) {
                (bool feeSuccess, ) = payable(feeRecipient).call{value: fee}("");
                require(feeSuccess, "ETHWSUISwap: fee transfer failed");
            }
        } else {
            // wSUI to ETH swap - transfer wSUI to participant
            uint256 fee = (swap.wsuiAmount * swapFee) / 10000;
            uint256 netAmount = swap.wsuiAmount - fee;

            wsuiToken.safeTransfer(swap.participant, netAmount);
            
            if (fee > 0) {
                wsuiToken.safeTransfer(feeRecipient, fee);
            }
        }

        emit SwapWithdrawn(swapId, msg.sender, secret);
    }

    /**
     * @dev Refund a swap after timelock expiration
     * @param swapId The swap identifier
     */
    function refund(bytes32 swapId) 
        external 
        nonReentrant 
        validSwap(swapId) 
        refundable(swapId) 
    {
        Swap storage swap = swaps[swapId];
        swap.refunded = true;

        if (swap.swapType == SwapType.ETH_TO_WSUI) {
            // Refund ETH to initiator
            (bool success, ) = payable(swap.initiator).call{value: swap.ethAmount}("");
            require(success, "ETHWSUISwap: ETH refund failed");
        } else {
            // Refund wSUI to initiator
            wsuiToken.safeTransfer(swap.initiator, swap.wsuiAmount);
        }

        emit SwapRefunded(swapId, msg.sender);
    }

    /**
     * @dev Get swap details
     * @param swapId The swap identifier
     */
    function getSwap(bytes32 swapId) external view returns (
        bytes32 secretHash,
        uint256 ethAmount,
        uint256 wsuiAmount,
        address initiator,
        address participant,
        uint256 timelock,
        bool withdrawn,
        bool refunded,
        SwapType swapType
    ) {
        Swap storage swap = swaps[swapId];
        return (
            swap.secretHash,
            swap.ethAmount,
            swap.wsuiAmount,
            swap.initiator,
            swap.participant,
            swap.timelock,
            swap.withdrawn,
            swap.refunded,
            swap.swapType
        );
    }

    /**
     * @dev Check if a swap is withdrawable
     * @param swapId The swap identifier
     * @param secret The secret to check
     */
    function isWithdrawable(bytes32 swapId, bytes32 secret) external view returns (bool) {
        Swap storage swap = swaps[swapId];
        return (
            swap.timelock > 0 &&
            !swap.withdrawn &&
            !swap.refunded &&
            block.timestamp <= swap.timelock &&
            sha256(abi.encodePacked(secret)) == swap.secretHash
        );
    }

    /**
     * @dev Check if a swap is refundable
     * @param swapId The swap identifier
     */
    function isRefundable(bytes32 swapId) external view returns (bool) {
        Swap storage swap = swaps[swapId];
        return (
            swap.timelock > 0 &&
            !swap.withdrawn &&
            !swap.refunded &&
            block.timestamp > swap.timelock
        );
    }

    // Admin functions
    function setSwapFee(uint256 _swapFee) external onlyOwner {
        require(_swapFee <= MAX_FEE, "ETHWSUISwap: fee too high");
        swapFee = _swapFee;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "ETHWSUISwap: invalid fee recipient");
        feeRecipient = _feeRecipient;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Emergency functions
    function emergencyWithdrawETH() external onlyOwner {
        require(paused(), "ETHWSUISwap: contract must be paused");
        (bool success, ) = payable(owner()).call{value: address(this).balance}("");
        require(success, "ETHWSUISwap: emergency withdrawal failed");
    }

    function emergencyWithdrawWSUI() external onlyOwner {
        require(paused(), "ETHWSUISwap: contract must be paused");
        uint256 balance = wsuiToken.balanceOf(address(this));
        wsuiToken.safeTransfer(owner(), balance);
    }

    receive() external payable {
        revert("ETHWSUISwap: direct ETH transfers not allowed");
    }
}