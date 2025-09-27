const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying ETH-wSUI Swap Contracts...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`📝 Deploying with account: ${deployer.address}`);
  console.log(`💰 Account balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);

  // Deploy WSUIToken first
  console.log("\n📦 Deploying WSUIToken...");
  const WSUIToken = await ethers.getContractFactory("WSUIToken");
  const wsuiToken = await WSUIToken.deploy();
  await wsuiToken.waitForDeployment();
  const wsuiTokenAddress = await wsuiToken.getAddress();
  console.log(`✅ WSUIToken deployed to: ${wsuiTokenAddress}`);

  // Deploy ETHWSUISwap
  console.log("\n📦 Deploying ETHWSUISwap...");
  const feeRecipient = deployer.address; // Use deployer as fee recipient for now
  const ETHWSUISwap = await ethers.getContractFactory("ETHWSUISwap");
  const ethWSUISwap = await ETHWSUISwap.deploy(wsuiTokenAddress, feeRecipient);
  await ethWSUISwap.waitForDeployment();
  const ethWSUISwapAddress = await ethWSUISwap.getAddress();
  console.log(`✅ ETHWSUISwap deployed to: ${ethWSUISwapAddress}`);

  // Add swap contract as minter and burner for wSUI token
  console.log("\n🔧 Setting up permissions...");
  await wsuiToken.addMinter(ethWSUISwapAddress);
  console.log(`✅ Added ETHWSUISwap as minter for wSUI`);
  
  await wsuiToken.addBurner(ethWSUISwapAddress);
  console.log(`✅ Added ETHWSUISwap as burner for wSUI`);

  // Verify contracts are deployed correctly
  console.log("\n🔍 Verifying deployment...");
  const wsuiSymbol = await wsuiToken.symbol();
  const wsuiDecimals = await wsuiToken.decimals();
  const swapFee = await ethWSUISwap.swapFee();
  
  console.log(`📊 wSUI Token Symbol: ${wsuSymbol}`);
  console.log(`📊 wSUI Token Decimals: ${wsuiDecimals}`);
  console.log(`📊 Swap Fee: ${swapFee} basis points (${swapFee/100}%)`);

  console.log("\n🎉 Deployment completed successfully!");
  console.log("\n📋 Contract Addresses:");
  console.log(`WSUIToken: ${wsuiTokenAddress}`);
  console.log(`ETHWSUISwap: ${ethWSUISwapAddress}`);
  console.log(`Fee Recipient: ${feeRecipient}`);

  // Save deployment info to file
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId,
    deployer: deployer.address,
    contracts: {
      WSUIToken: wsuiTokenAddress,
      ETHWSUISwap: ethWSUISwapAddress
    },
    config: {
      feeRecipient: feeRecipient,
      swapFee: swapFee.toString()
    },
    timestamp: new Date().toISOString()
  };

  const fs = require('fs');
  const path = require('path');
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  fs.writeFileSync(
    path.join(deploymentsDir, `${hre.network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log(`💾 Deployment info saved to deployments/${hre.network.name}.json`);

  // If on a testnet, verify contracts
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n⏳ Waiting before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    try {
      console.log("🔍 Verifying WSUIToken...");
      await hre.run("verify:verify", {
        address: wsuiTokenAddress,
        constructorArguments: []
      });
      console.log("✅ WSUIToken verified");

      console.log("🔍 Verifying ETHWSUISwap...");
      await hre.run("verify:verify", {
        address: ethWSUISwapAddress,
        constructorArguments: [wsuiTokenAddress, feeRecipient]
      });
      console.log("✅ ETHWSUISwap verified");
    } catch (error) {
      console.log("⚠️ Verification failed:", error.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });