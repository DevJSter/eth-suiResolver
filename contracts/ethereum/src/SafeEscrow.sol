// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SafeEscrow {
    uint256 public startTime;
    uint256 public lockDuration;
    bytes32 public secretHash;
    address public owner;
    address public beneficiary;
    uint256 public amount;
    string public revealedSecret;
    bool public isWithdrawn;
    bool public isRefunded;
    bool public useSha256; // true for cross-chain compatibility, false for keccak256

    // Events for cross-chain monitoring
    event SafeCreated(
        address indexed safeAddress,
        address indexed owner,
        address indexed beneficiary,
        uint256 amount,
        bytes32 secretHash,
        uint256 startTime,
        uint256 lockDuration,
        bool useSha256
    );

    event SafeWithdrawn(
        address indexed safeAddress,
        address indexed withdrawer,
        address indexed beneficiary,
        uint256 amount,
        string secret
    );

    event SafeRefunded(
        address indexed safeAddress,
        address indexed owner,
        uint256 amount
    );

    constructor(
        bytes32 _secretHash,
        address _owner,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) payable {
        require(msg.value > 0, "Amount must be greater than 0");
        require(_beneficiary != address(0), "Invalid beneficiary address");
        require(_owner != address(0), "Invalid owner address");

        secretHash = _secretHash;
        owner = _owner;
        beneficiary = _beneficiary;
        amount = msg.value;
        startTime = block.timestamp;
        lockDuration = _lockDuration;
        useSha256 = _useSha256;
        isWithdrawn = false;
        isRefunded = false;

        emit SafeCreated(
            address(this),
            owner,
            beneficiary,
            amount,
            secretHash,
            startTime,
            lockDuration,
            useSha256
        );
    }

    function withdraw(string memory _secret) external {
        require(!isWithdrawn, "Already withdrawn");
        require(!isRefunded, "Already refunded");
        require(block.timestamp <= startTime + lockDuration, "Lock period expired");

        // Verify secret hash based on the chosen hashing method
        bytes32 computedHash;
        if (useSha256) {
            computedHash = sha256(abi.encodePacked(_secret));
        } else {
            computedHash = keccak256(abi.encodePacked(_secret));
        }
        require(computedHash == secretHash, "Invalid secret");

        isWithdrawn = true;
        revealedSecret = _secret;

        // Transfer ETH to the caller (anyone with the correct secret)
        payable(msg.sender).transfer(amount);

        emit SafeWithdrawn(address(this), msg.sender, beneficiary, amount, _secret);
    }

    function refund() external {
        require(msg.sender == owner, "Only owner can refund");
        require(!isWithdrawn, "Already withdrawn");
        require(!isRefunded, "Already refunded");
        require(block.timestamp > startTime + lockDuration, "Lock period not expired yet");

        isRefunded = true;
        payable(owner).transfer(amount);

        emit SafeRefunded(address(this), owner, amount);
    }

    // View functions
    function getSafeInfo() external view returns (
        address _owner,
        address _beneficiary,
        uint256 _amount,
        bytes32 _secretHash,
        uint256 _startTime,
        uint256 _lockDuration,
        bool _isWithdrawn,
        bool _isRefunded,
        bool _useSha256,
        string memory _revealedSecret
    ) {
        return (
            owner,
            beneficiary,
            amount,
            secretHash,
            startTime,
            lockDuration,
            isWithdrawn,
            isRefunded,
            useSha256,
            revealedSecret
        );
    }

    function isLockExpired() external view returns (bool) {
        return block.timestamp > startTime + lockDuration;
    }

    function isSafeAvailable() external view returns (bool) {
        return !isWithdrawn && !isRefunded;
    }

    function getTimeLeft() external view returns (uint256) {
        if (block.timestamp >= startTime + lockDuration) {
            return 0;
        }
        return (startTime + lockDuration) - block.timestamp;
    }
}