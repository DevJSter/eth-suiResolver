// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {SafeEscrow} from "./SafeEscrow.sol";
import {HashUtility} from "./HashUtility.sol";

contract SafeRecord {
    HashUtility private hashUtility;
    
    // Arrays to store all safe addresses for enumeration
    address[] public safeAddresses;
    
    // Mappings for quick lookups
    mapping(address => bytes32) public addressToHash;
    mapping(bytes32 => address[]) public hashToAddresses; // Multiple safes can have same hash
    mapping(address => SafeMetadata) public safeMetadata;
    mapping(bytes32 => uint256) public hashToSafeCount;
    
    // Registry owner
    address public owner;
    
    struct SafeMetadata {
        address safeAddress;
        address owner;
        address beneficiary;
        uint256 amount;
        bytes32 secretHash;
        uint256 startTime;
        uint256 lockDuration;
        bool useSha256;
        bool isActive;
    }

    // Events for cross-chain monitoring
    event SafeRegistered(
        address indexed safeAddress,
        address indexed owner,
        address indexed beneficiary,
        uint256 amount,
        bytes32 secretHash,
        address registryAddress
    );

    event SafeDeactivated(
        address indexed safeAddress,
        address registryAddress
    );

    constructor() {
        hashUtility = new HashUtility();
        owner = msg.sender;
    }

    /// Create a safe with keccak256 hash and register it
    function createSafe(
        address _token,
        uint256 _amount,
        string memory _secret,
        address _beneficiary,
        uint256 _lockDuration
    ) public returns (address) {
        bytes32 hash = hashUtility.calculateHash(_secret);
        return _createSafeWithHash(_token, _amount, hash, _beneficiary, _lockDuration, false);
    }

    /// Create a safe with sha256 hash (cross-chain compatible) and register it
    function createSafeSha256(
        address _token,
        uint256 _amount,
        string memory _secret,
        address _beneficiary,
        uint256 _lockDuration
    ) public returns (address) {
        bytes32 hash = hashUtility.calculateSha256Hash(_secret);
        return _createSafeWithHash(_token, _amount, hash, _beneficiary, _lockDuration, true);
    }

    /// Create a safe with pre-computed hash
    function createSafeWithHash(
        address _token,
        uint256 _amount,
        bytes32 _hash,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) public returns (address) {
        return _createSafeWithHash(_token, _amount, _hash, _beneficiary, _lockDuration, _useSha256);
    }

    /// Internal function to create and register safe
    function _createSafeWithHash(
        address _token,
        uint256 _amount,
        bytes32 _hash,
        address _beneficiary,
        uint256 _lockDuration,
        bool _useSha256
    ) internal returns (address) {
        // Create new SafeEscrow contract
        SafeEscrow safe = new SafeEscrow(
            _token,
            _amount,
            _hash,
            msg.sender,
            _beneficiary,
            _lockDuration,
            _useSha256
        );

        address safeAddress = address(safe);

        // Register in mappings
        safeAddresses.push(safeAddress);
        addressToHash[safeAddress] = _hash;
        hashToAddresses[_hash].push(safeAddress);
        hashToSafeCount[_hash]++;

        // Store metadata
        safeMetadata[safeAddress] = SafeMetadata({
            safeAddress: safeAddress,
            owner: msg.sender,
            beneficiary: _beneficiary,
            amount: _amount,
            secretHash: _hash,
            startTime: block.timestamp,
            lockDuration: _lockDuration,
            useSha256: _useSha256,
            isActive: true
        });

        emit SafeRegistered(
            safeAddress,
            msg.sender,
            _beneficiary,
            _amount,
            _hash,
            address(this)
        );

        return safeAddress;
    }

    /// Deactivate a safe (called after withdrawal/refund)
    function deactivateSafe(address _safeAddress) external {
        require(safeMetadata[_safeAddress].owner == msg.sender || msg.sender == owner, "Unauthorized");
        require(safeMetadata[_safeAddress].isActive, "Safe already inactive");
        
        safeMetadata[_safeAddress].isActive = false;
        
        emit SafeDeactivated(_safeAddress, address(this));
    }

    // View functions for cross-chain queries
    function getSafesByHash(bytes32 _hash) external view returns (address[] memory) {
        return hashToAddresses[_hash];
    }

    function getSafeMetadata(address _safeAddress) external view returns (SafeMetadata memory) {
        return safeMetadata[_safeAddress];
    }

    function getAllSafes() external view returns (address[] memory) {
        return safeAddresses;
    }

    function getActiveSafes() external view returns (address[] memory) {
        uint256 activeCount = 0;
        
        // Count active safes
        for (uint256 i = 0; i < safeAddresses.length; i++) {
            if (safeMetadata[safeAddresses[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array of active safes
        address[] memory activeSafes = new address[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < safeAddresses.length; i++) {
            if (safeMetadata[safeAddresses[i]].isActive) {
                activeSafes[index] = safeAddresses[i];
                index++;
            }
        }
        
        return activeSafes;
    }

    function isSafeRegistered(bytes32 _hash) external view returns (bool) {
        return hashToSafeCount[_hash] > 0;
    }

    function getSafeCount() external view returns (uint256) {
        return safeAddresses.length;
    }

    function getSafeCountByHash(bytes32 _hash) external view returns (uint256) {
        return hashToSafeCount[_hash];
    }

    // Utility functions
    function getHashUtilityAddress() external view returns (address) {
        return address(hashUtility);
    }

    // Emergency functions (only owner)
    function updateOwner(address _newOwner) external {
        require(msg.sender == owner, "Only owner");
        owner = _newOwner;
    }
}