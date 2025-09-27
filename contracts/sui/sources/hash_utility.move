module sui_resolver::hash_utility {
    use std::string::{Self, String};
    use sui::hash;

    /// Calculate keccak256 hash from a string key
    public fun calculate_hash(key: String): vector<u8> {
        let key_bytes = string::as_bytes(&key);
        hash::keccak256(key_bytes)
    }

    /// Calculate sha256 hash from a string key (for cross-chain compatibility)
    /// Note: Sui doesn't have native sha256, so we use keccak256 for now
    public fun calculate_sha256_hash(key: String): vector<u8> {
        let key_bytes = string::as_bytes(&key);
        hash::keccak256(key_bytes)
    }

    /// Calculate keccak256 hash from bytes
    public fun calculate_hash_from_bytes(data: vector<u8>): vector<u8> {
        hash::keccak256(&data)
    }

    /// Calculate sha256 hash from bytes (for cross-chain compatibility)
    /// Note: Sui doesn't have native sha256, so we use keccak256 for now
    public fun calculate_sha256_from_bytes(data: vector<u8>): vector<u8> {
        hash::keccak256(&data)
    }

    /// Verify if a secret matches the given hash (keccak256)
    public fun verify_secret(secret: String, expected_hash: vector<u8>): bool {
        let secret_hash = calculate_hash(secret);
        secret_hash == expected_hash
    }

    /// Verify if a secret matches the given hash (sha256 for cross-chain)
    public fun verify_secret_sha256(secret: String, expected_hash: vector<u8>): bool {
        let secret_hash = calculate_sha256_hash(secret);
        secret_hash == expected_hash
    }
}