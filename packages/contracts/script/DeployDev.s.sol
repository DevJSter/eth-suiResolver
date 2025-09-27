// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Script.sol";
import "../src/EthereumFusionEscrow.sol";
import "../src/EthereumResolverStaking.sol";

/**
 * @title DeployDev
 * @notice Deployment script for development environment
 */
contract DeployDev is Script {
    function run() external {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying with account:", deployer);
        console.log("Account balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Resolver Staking contract first
        EthereumResolverStaking stakingContract = new EthereumResolverStaking();
        console.log("EthereumResolverStaking deployed to:", address(stakingContract));

        // Deploy Fusion Escrow contract
        EthereumFusionEscrow escrowContract = new EthereumFusionEscrow();
        console.log("EthereumFusionEscrow deployed to:", address(escrowContract));

        // Authorize escrow contract to update resolver stats
        stakingContract.authorizeSlasher(address(escrowContract));
        console.log("Authorized escrow contract as slasher");

        vm.stopBroadcast();

        // Write deployment addresses to file
        string memory deploymentInfo = string(abi.encodePacked(
            "ETH_ESCROW_ADDRESS=", vm.toString(address(escrowContract)), "\n",
            "ETH_STAKING_ADDRESS=", vm.toString(address(stakingContract)), "\n"
        ));
        
        vm.writeFile("deployment-addresses.txt", deploymentInfo);
        console.log("Deployment addresses written to deployment-addresses.txt");
    }
}