const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ETH-wSUI Swap System", function () {
  let wsuiToken;
  let ethWSUISwap;
  let owner;
  let alice;
  let bob;
  let feeRecipient;

  const SWAP_FEE = 30; // 0.3%
  const ETH_AMOUNT = ethers.parseEther("1");
  const WSUI_AMOUNT = ethers.parseUnits("1000", 9); // 1000 wSUI (9 decimals)

  beforeEach(async function () {
    [owner, alice, bob, feeRecipient] = await ethers.getSigners();

    // Deploy WSUIToken
    const WSUIToken = await ethers.getContractFactory("WSUIToken");
    wsuiToken = await WSUIToken.deploy();
    await wsuiToken.waitForDeployment();

    // Deploy ETHWSUISwap
    const ETHWSUISwap = await ethers.getContractFactory("ETHWSUISwap");
    ethWSUISwap = await ETHWSUISwap.deploy(
      await wsuiToken.getAddress(),
      feeRecipient.address
    );
    await ethWSUISwap.waitForDeployment();

    // Setup permissions
    await wsuiToken.addMinter(await ethWSUISwap.getAddress());
    await wsuiToken.addBurner(await ethWSUISwap.getAddress());

    // Mint some wSUI tokens to Alice for testing
    await wsuiToken.mint(alice.address, WSUI_AMOUNT * 10n, ethers.keccak256(ethers.toUtf8Bytes("test")));
  });

  describe("WSUIToken", function () {
    it("Should have correct initial properties", async function () {
      expect(await wsuiToken.name()).to.equal("Wrapped SUI");
      expect(await wsuiToken.symbol()).to.equal("wSUI");
      expect(await wsuiToken.decimals()).to.equal(9);
      expect(await wsuiToken.totalSupply()).to.equal(WSUI_AMOUNT * 10n);
    });

    it("Should allow minting by authorized minters", async function () {
      const mintAmount = ethers.parseUnits("100", 9);
      const suiTxHash = ethers.keccak256(ethers.toUtf8Bytes("sui-tx-hash"));

      await expect(wsuiToken.mint(bob.address, mintAmount, suiTxHash))
        .to.emit(wsuiToken, "Mint")
        .withArgs(bob.address, mintAmount, suiTxHash);

      expect(await wsuiToken.balanceOf(bob.address)).to.equal(mintAmount);
    });

    it("Should allow burning by authorized burners", async function () {
      const burnAmount = ethers.parseUnits("50", 9);
      const suiAddress = "0x123...";

      // First approve the burning
      await wsuiToken.connect(alice).approve(owner.address, burnAmount);

      await expect(wsuiToken.burn(alice.address, burnAmount, suiAddress))
        .to.emit(wsuiToken, "Burn")
        .withArgs(alice.address, burnAmount, suiAddress);

      expect(await wsuiToken.balanceOf(alice.address)).to.equal(WSUI_AMOUNT * 10n - burnAmount);
    });
  });

  describe("ETH to wSUI Swap", function () {
    let secretHash;
    let secret;
    let timelock;

    beforeEach(function () {
      secret = ethers.keccak256(ethers.toUtf8Bytes("mysecret123"));
      secretHash = ethers.sha256(secret);
      timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    });

    it("Should initiate ETH to wSUI swap", async function () {
      const tx = await ethWSUISwap.connect(alice).initiateETHToWSUI(
        secretHash,
        bob.address,
        WSUI_AMOUNT,
        timelock,
        { value: ETH_AMOUNT }
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => {
        try {
          return ethWSUISwap.interface.parseLog(log).name === "SwapInitiated";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
    });

    it("Should allow withdrawal with correct secret", async function () {
      // Initiate swap
      await ethWSUISwap.connect(alice).initiateETHToWSUI(
        secretHash,
        bob.address,
        WSUI_AMOUNT,
        timelock,
        { value: ETH_AMOUNT }
      );

      // Calculate swap ID (simplified)
      const swapId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "bytes32", "uint256", "uint256", "uint256"],
          [alice.address, bob.address, secretHash, (await ethers.provider.getBlock("latest")).timestamp, ETH_AMOUNT, WSUI_AMOUNT]
        )
      );

      const bobBalanceBefore = await ethers.provider.getBalance(bob.address);

      // Withdraw
      await expect(ethWSUISwap.connect(bob).withdraw(swapId, secret))
        .to.emit(ethWSUISwap, "SwapWithdrawn")
        .withArgs(swapId, bob.address, secret);

      const bobBalanceAfter = await ethers.provider.getBalance(bob.address);
      expect(bobBalanceAfter).to.be.gt(bobBalanceBefore);
    });

    it("Should reject withdrawal with incorrect secret", async function () {
      // Initiate swap
      await ethWSUISwap.connect(alice).initiateETHToWSUI(
        secretHash,
        bob.address,
        WSUI_AMOUNT,
        timelock,
        { value: ETH_AMOUNT }
      );

      const wrongSecret = ethers.keccak256(ethers.toUtf8Bytes("wrongsecret"));
      const swapId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "bytes32", "uint256", "uint256", "uint256"],
          [alice.address, bob.address, secretHash, (await ethers.provider.getBlock("latest")).timestamp, ETH_AMOUNT, WSUI_AMOUNT]
        )
      );

      await expect(ethWSUISwap.connect(bob).withdraw(swapId, wrongSecret))
        .to.be.revertedWith("ETHWSUISwap: invalid secret");
    });
  });

  describe("wSUI to ETH Swap", function () {
    let secretHash;
    let secret;
    let timelock;

    beforeEach(async function () {
      secret = ethers.keccak256(ethers.toUtf8Bytes("mysecret456"));
      secretHash = ethers.sha256(secret);
      timelock = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // Approve wSUI spending
      await wsuiToken.connect(alice).approve(await ethWSUISwap.getAddress(), WSUI_AMOUNT);
    });

    it("Should initiate wSUI to ETH swap", async function () {
      await expect(ethWSUISwap.connect(alice).initiateWSUIToETH(
        secretHash,
        bob.address,
        WSUI_AMOUNT,
        ETH_AMOUNT,
        timelock
      )).to.emit(ethWSUISwap, "SwapInitiated");

      expect(await wsuiToken.balanceOf(await ethWSUISwap.getAddress())).to.equal(WSUI_AMOUNT);
    });
  });

  describe("Refund Mechanism", function () {
    let secretHash;
    let secret;
    let expiredTimelock;

    beforeEach(function () {
      secret = ethers.keccak256(ethers.toUtf8Bytes("refundsecret"));
      secretHash = ethers.sha256(secret);
      expiredTimelock = Math.floor(Date.now() / 1000) + 1; // 1 second from now
    });

    it("Should allow refund after timelock expiration", async function () {
      // Initiate swap with short timelock
      await ethWSUISwap.connect(alice).initiateETHToWSUI(
        secretHash,
        bob.address,
        WSUI_AMOUNT,
        expiredTimelock,
        { value: ETH_AMOUNT }
      );

      // Wait for timelock to expire
      await new Promise(resolve => setTimeout(resolve, 2000));

      const swapId = ethers.keccak256(
        ethers.solidityPacked(
          ["address", "address", "bytes32", "uint256", "uint256", "uint256"],
          [alice.address, bob.address, secretHash, (await ethers.provider.getBlock("latest")).timestamp, ETH_AMOUNT, WSUI_AMOUNT]
        )
      );

      const aliceBalanceBefore = await ethers.provider.getBalance(alice.address);

      await expect(ethWSUISwap.connect(alice).refund(swapId))
        .to.emit(ethWSUISwap, "SwapRefunded")
        .withArgs(swapId, alice.address);

      const aliceBalanceAfter = await ethers.provider.getBalance(alice.address);
      expect(aliceBalanceAfter).to.be.gt(aliceBalanceBefore);
    });
  });

  describe("Admin Functions", function () {
    it("Should allow owner to set swap fee", async function () {
      const newFee = 50; // 0.5%
      await ethWSUISwap.setSwapFee(newFee);
      expect(await ethWSUISwap.swapFee()).to.equal(newFee);
    });

    it("Should allow owner to pause/unpause", async function () {
      await ethWSUISwap.pause();
      expect(await ethWSUISwap.paused()).to.be.true;

      await ethWSUISwap.unpause();
      expect(await ethWSUISwap.paused()).to.be.false;
    });

    it("Should reject fee higher than maximum", async function () {
      const tooHighFee = 1001; // 10.01%
      await expect(ethWSUISwap.setSwapFee(tooHighFee))
        .to.be.revertedWith("ETHWSUISwap: fee too high");
    });
  });
});