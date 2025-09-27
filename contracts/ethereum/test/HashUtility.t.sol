// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console2} from "forge-std/Test.sol";
import {HashUtility} from "../src/HashUtility.sol";

contract HashUtilityTest is Test {
    HashUtility public hashUtility;

    function setUp() public {
        hashUtility = new HashUtility();
    }

    function testCalculateHash() public {
        string memory secret = "test-secret";
        bytes32 expected = keccak256(abi.encodePacked(secret));
        bytes32 result = hashUtility.calculateHash(secret);
        assertEq(result, expected);
    }

    function testCalculateSha256Hash() public {
        string memory secret = "test-secret";
        bytes32 expected = sha256(abi.encodePacked(secret));
        bytes32 result = hashUtility.calculateSha256Hash(secret);
        assertEq(result, expected);
    }

    function testVerifySecret() public {
        string memory secret = "test-secret";
        bytes32 hash = hashUtility.calculateHash(secret);
        assertTrue(hashUtility.verifySecret(secret, hash));
        assertFalse(hashUtility.verifySecret("wrong-secret", hash));
    }

    function testVerifySecretSha256() public {
        string memory secret = "test-secret";
        bytes32 hash = hashUtility.calculateSha256Hash(secret);
        assertTrue(hashUtility.verifySecretSha256(secret, hash));
        assertFalse(hashUtility.verifySecretSha256("wrong-secret", hash));
    }

    function testBatchCalculateHash() public {
        string[] memory secrets = new string[](3);
        secrets[0] = "secret1";
        secrets[1] = "secret2";
        secrets[2] = "secret3";

        bytes32[] memory hashes = hashUtility.batchCalculateHash(secrets);
        
        assertEq(hashes.length, 3);
        assertEq(hashes[0], keccak256(abi.encodePacked("secret1")));
        assertEq(hashes[1], keccak256(abi.encodePacked("secret2")));
        assertEq(hashes[2], keccak256(abi.encodePacked("secret3")));
    }

    function testBatchCalculateSha256Hash() public {
        string[] memory secrets = new string[](2);
        secrets[0] = "secret1";
        secrets[1] = "secret2";

        bytes32[] memory hashes = hashUtility.batchCalculateSha256Hash(secrets);
        
        assertEq(hashes.length, 2);
        assertEq(hashes[0], sha256(abi.encodePacked("secret1")));
        assertEq(hashes[1], sha256(abi.encodePacked("secret2")));
    }
}