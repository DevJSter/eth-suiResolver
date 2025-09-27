// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {HashUtility} from "../src/HashUtility.sol";
import {SafeRecord} from "../src/SafeRecord.sol";

contract Deploy is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // Deploy HashUtility first
        HashUtility hashUtility = new HashUtility();
        console2.log("HashUtility deployed at:", address(hashUtility));

        // Deploy SafeRecord (which will deploy its own HashUtility)
        SafeRecord safeRecord = new SafeRecord();
        console2.log("SafeRecord deployed at:", address(safeRecord));
        console2.log("SafeRecord HashUtility at:", safeRecord.getHashUtilityAddress());

        vm.stopBroadcast();

        // Write deployment addresses to file
        string memory deploymentInfo = string(
            abi.encodePacked(
                "HASH_UTILITY_ADDRESS=",
                vm.toString(address(hashUtility)),
                "\n",
                "SAFE_RECORD_ADDRESS=",
                vm.toString(address(safeRecord)),
                "\n",
                "SAFE_RECORD_HASH_UTILITY_ADDRESS=",
                vm.toString(safeRecord.getHashUtilityAddress())
            )
        );
        
        vm.writeFile("deployment.env", deploymentInfo);
        console2.log("Deployment addresses written to deployment.env");
    }
}