// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/SimpleSwapEscrowFactory.sol";

contract DeploySimpleFactory is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy the SimpleSwapEscrowFactory
        SimpleSwapEscrowFactory factory = new SimpleSwapEscrowFactory();
        
        console.log("SimpleSwapEscrowFactory deployed at:", address(factory));
        
        // Log initial configuration
        console.log("Minimum resolver stake:", factory.MIN_RESOLVER_STAKE());
        console.log("Minimum timelock buffer:", factory.MIN_TIMELOCK_BUFFER());
        console.log("Maximum swap duration:", factory.MAX_SWAP_DURATION());

        vm.stopBroadcast();

        // Save deployment address
        string memory contractAddresses = string(
            abi.encodePacked(
                "SIMPLE_SWAP_ESCROW_FACTORY=", vm.toString(address(factory)), "\n"
            )
        );
        
        vm.writeFile("deployment-addresses.txt", contractAddresses);
        console.log("Deployment addresses saved to deployment-addresses.txt");
    }
}