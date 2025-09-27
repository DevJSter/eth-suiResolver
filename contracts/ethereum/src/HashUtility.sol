// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract HashUtility {
    /// Calculate keccak256 hash from a string key (Ethereum native)
    function calculateHash(string memory _key) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(_key));
    }

    /// Calculate sha256 hash from a string key (cross-chain compatibility)
    function calculateSha256Hash(string memory _key) external pure returns (bytes32) {
        return sha256(abi.encodePacked(_key));
    }

    /// Calculate keccak256 hash from bytes
    function calculateHashFromBytes(bytes memory _data) external pure returns (bytes32) {
        return keccak256(_data);
    }

    /// Calculate sha256 hash from bytes (cross-chain compatibility)
    function calculateSha256FromBytes(bytes memory _data) external pure returns (bytes32) {
        return sha256(_data);
    }

    /// Verify if a secret matches the given hash (keccak256)
    function verifySecret(string memory _secret, bytes32 _expectedHash) external pure returns (bool) {
        return keccak256(abi.encodePacked(_secret)) == _expectedHash;
    }

    /// Verify if a secret matches the given hash (sha256 for cross-chain)
    function verifySecretSha256(string memory _secret, bytes32 _expectedHash) external pure returns (bool) {
        return sha256(abi.encodePacked(_secret)) == _expectedHash;
    }

    /// Batch hash calculation for multiple secrets (keccak256)
    function batchCalculateHash(string[] memory _keys) external pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_keys.length);
        for (uint256 i = 0; i < _keys.length; i++) {
            hashes[i] = keccak256(abi.encodePacked(_keys[i]));
        }
        return hashes;
    }

    /// Batch hash calculation for multiple secrets (sha256)
    function batchCalculateSha256Hash(string[] memory _keys) external pure returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](_keys.length);
        for (uint256 i = 0; i < _keys.length; i++) {
            hashes[i] = sha256(abi.encodePacked(_keys[i]));
        }
        return hashes;
    }
}