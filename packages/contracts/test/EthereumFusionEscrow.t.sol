// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/EthereumFusionEscrow.sol";
import "../src/EthereumResolverStaking.sol";

contract EthereumFusionEscrowTest is Test {
    EthereumFusionEscrow public escrow;
    EthereumResolverStaking public staking;
    
    address public requester = address(0x1111);
    address public resolver = address(0x2222);
    address public otherUser = address(0x3333);
    
    bytes32 public constant ORDER_ID = keccak256("test_order_1");
    bytes32 public constant HTLC_ID = keccak256("test_htlc_1");
    bytes32 public constant SECRET_HASH = keccak256("secret123");
    string public constant SECRET = "secret123";
    
    uint256 public requesterTimelock;
    uint256 public resolverTimelock;
    
    function setUp() public {
        staking = new EthereumResolverStaking();
        escrow = new EthereumFusionEscrow();
        
        // Authorize escrow to update resolver stats
        staking.authorizeSlasher(address(escrow));
        
        // Fund test accounts
        vm.deal(requester, 10 ether);
        vm.deal(resolver, 10 ether);
        vm.deal(otherUser, 10 ether);
        
        // Register resolver
        vm.prank(resolver);
        escrow.registerResolver{value: 2 ether}();
        
        // Setup timelocks
        requesterTimelock = block.timestamp + 2 hours;
        resolverTimelock = block.timestamp + 90 minutes;
    }
    
    function testRegisterResolver() public {
        vm.prank(otherUser);
        escrow.registerResolver{value: 1 ether}();
        
        assertEq(escrow.resolverStakes(otherUser), 1 ether);
    }
    
    function testRegisterResolverInsufficientStake() public {
        vm.prank(otherUser);
        vm.expectRevert("Insufficient stake");
        escrow.registerResolver{value: 0.5 ether}();
    }
    
    function testCreateOrderETH() public {
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0), // ETH
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        EthereumFusionEscrow.Order memory order = escrow.getOrder(ORDER_ID);
        assertEq(order.requester, requester);
        assertEq(order.resolver, resolver);
        assertEq(order.tokenIn, address(0));
        assertEq(order.amountIn, 1 ether);
        assertEq(order.secretHash, SECRET_HASH);
        assertFalse(order.executed);
        assertFalse(order.refunded);
    }
    
    function testCreateOrderInvalidResolver() public {
        vm.prank(requester);
        vm.expectRevert("Resolver not registered");
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            otherUser, // Not registered
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
    }
    
    function testCreateOrderDuplicateId() public {
        // Create first order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Try to create duplicate
        vm.prank(requester);
        vm.expectRevert("Order already exists");
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
    }
    
    function testExecuteOrder() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        uint256 resolverBalanceBefore = resolver.balance;
        
        // Execute order
        vm.prank(resolver);
        escrow.executeOrder(ORDER_ID, SECRET);
        
        // Check order is executed
        EthereumFusionEscrow.Order memory order = escrow.getOrder(ORDER_ID);
        assertTrue(order.executed);
        assertFalse(order.refunded);
        
        // Check resolver received ETH
        assertEq(resolver.balance, resolverBalanceBefore + 1 ether);
    }
    
    function testExecuteOrderWrongSecret() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Try to execute with wrong secret
        vm.prank(resolver);
        vm.expectRevert("Invalid secret");
        escrow.executeOrder(ORDER_ID, "wrong_secret");
    }
    
    function testExecuteOrderUnauthorized() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Try to execute as different user
        vm.prank(otherUser);
        vm.expectRevert("Only designated resolver");
        escrow.executeOrder(ORDER_ID, SECRET);
    }
    
    function testRefundOrderAfterExpiry() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Fast forward past expiry
        vm.warp(block.timestamp + 3 hours);
        
        uint256 requesterBalanceBefore = requester.balance;
        
        // Refund order
        vm.prank(requester);
        escrow.refundOrder(ORDER_ID);
        
        // Check order is refunded
        EthereumFusionEscrow.Order memory order = escrow.getOrder(ORDER_ID);
        assertFalse(order.executed);
        assertTrue(order.refunded);
        
        // Check requester received refund
        assertEq(requester.balance, requesterBalanceBefore + 1 ether);
    }
    
    function testRefundOrderBeforeExpiry() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Try to refund before expiry
        vm.prank(requester);
        vm.expectRevert("Order not expired");
        escrow.refundOrder(ORDER_ID);
    }
    
    function testRefundOrderUnauthorized() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Fast forward past expiry
        vm.warp(block.timestamp + 3 hours);
        
        // Try to refund as different user
        vm.prank(otherUser);
        vm.expectRevert("Only requester");
        escrow.refundOrder(ORDER_ID);
    }
    
    function testIsOrderActive() public {
        // Create order
        vm.prank(requester);
        escrow.createOrder{value: 1 ether}(
            ORDER_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            2 hours
        );
        
        // Should be active initially
        assertTrue(escrow.isOrderActive(ORDER_ID));
        
        // Execute order
        vm.prank(resolver);
        escrow.executeOrder(ORDER_ID, SECRET);
        
        // Should not be active after execution
        assertFalse(escrow.isOrderActive(ORDER_ID));
    }
    
    function testWithdrawStake() public {
        uint256 resolverBalanceBefore = resolver.balance;
        
        // Withdraw partial stake
        vm.prank(resolver);
        escrow.withdrawStake(0.5 ether);
        
        assertEq(escrow.resolverStakes(resolver), 1.5 ether);
        assertEq(resolver.balance, resolverBalanceBefore + 0.5 ether);
    }

    // ==== DUAL-SIDE HTLC TESTS ====

    function testLockFundsHTLC() public {
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        EthereumFusionEscrow.HTLC memory htlc = escrow.getHTLC(HTLC_ID);
        assertEq(htlc.sender, requester);
        assertEq(htlc.beneficiary, resolver);
        assertEq(htlc.amount, 1 ether);
        assertEq(htlc.hashLock, SECRET_HASH);
        assertEq(htlc.timelock, requesterTimelock);
        assertFalse(htlc.claimed);
        assertFalse(htlc.refunded);
    }

    function testClaimFundsHTLC() public {
        // Lock funds first
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        uint256 resolverBalanceBefore = resolver.balance;
        
        // Claim funds with correct secret
        vm.prank(resolver);
        escrow.claimFunds(HTLC_ID, SECRET);
        
        EthereumFusionEscrow.HTLC memory htlc = escrow.getHTLC(HTLC_ID);
        assertTrue(htlc.claimed);
        assertFalse(htlc.refunded);
        assertEq(resolver.balance, resolverBalanceBefore + 1 ether);
        assertTrue(escrow.isSecretRevealed(SECRET_HASH));
    }

    function testClaimFundsHTLCInvalidSecret() public {
        // Lock funds first
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Try to claim with wrong secret
        vm.prank(resolver);
        vm.expectRevert("Invalid secret");
        escrow.claimFunds(HTLC_ID, "wrong_secret");
    }

    function testClaimFundsHTLCUnauthorized() public {
        // Lock funds first
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Try to claim as different user
        vm.prank(otherUser);
        vm.expectRevert("Only beneficiary can claim");
        escrow.claimFunds(HTLC_ID, SECRET);
    }

    function testRefundHTLC() public {
        // Lock funds first
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Fast forward past timelock
        vm.warp(requesterTimelock + 1);
        
        uint256 requesterBalanceBefore = requester.balance;
        
        // Refund HTLC
        vm.prank(requester);
        escrow.refundHTLC(HTLC_ID);
        
        EthereumFusionEscrow.HTLC memory htlc = escrow.getHTLC(HTLC_ID);
        assertFalse(htlc.claimed);
        assertTrue(htlc.refunded);
        assertEq(requester.balance, requesterBalanceBefore + 1 ether);
    }

    function testRefundHTLCNotExpired() public {
        // Lock funds first
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Try to refund before expiry
        vm.prank(requester);
        vm.expectRevert("HTLC not expired");
        escrow.refundHTLC(HTLC_ID);
    }

    function testDualSideHTLCFlow() public {
        bytes32 requesterHTLCId = keccak256("requester_htlc");
        bytes32 resolverHTLCId = keccak256("resolver_htlc");
        
        // Step 1: Requester locks funds (longer timelock)
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            requesterHTLCId,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Step 2: Resolver locks funds (shorter timelock)
        vm.prank(resolver);
        escrow.lockFunds{value: 0.5 ether}(
            resolverHTLCId,
            requester,
            address(0),
            0.5 ether,
            SECRET_HASH, // Same hash lock!
            resolverTimelock
        );
        
        assertTrue(escrow.validateTimelocks(requesterTimelock, resolverTimelock));
        assertTrue(escrow.isHTLCActive(requesterHTLCId));
        assertTrue(escrow.isHTLCActive(resolverHTLCId));
        
        // Step 3: Resolver claims both HTLCs using the secret
        uint256 resolverBalanceBefore = resolver.balance;
        uint256 requesterBalanceBefore = requester.balance;
        

        
        // First claim resolver's HTLC (sends funds to requester)
        vm.prank(requester); 
        escrow.claimFunds(resolverHTLCId, SECRET);
        
        // Then claim requester's HTLC (sends funds to resolver)
        vm.prank(resolver);
        escrow.claimFunds(requesterHTLCId, SECRET);
        
        // Verify atomic swap completed
        assertEq(requester.balance, requesterBalanceBefore + 0.5 ether);
        assertEq(resolver.balance, resolverBalanceBefore + 1 ether); // resolver gets 1 ETH (their locked 0.5 ETH is already deducted from resolverBalanceBefore)
        assertTrue(escrow.isSecretRevealed(SECRET_HASH));
    }

    function testValidateTimelocks() public {
        assertTrue(escrow.validateTimelocks(requesterTimelock, resolverTimelock));
        assertFalse(escrow.validateTimelocks(resolverTimelock, requesterTimelock));
    }

    function testGenerateHTLCId() public {
        bytes32 htlcId = escrow.generateHTLCId(ORDER_ID, requester, 0);
        assertNotEq(htlcId, bytes32(0));
        
        bytes32 htlcId2 = escrow.generateHTLCId(ORDER_ID, requester, 1);
        assertNotEq(htlcId, htlcId2);
    }

    function testNonceManagement() public {
        assertEq(escrow.getNonce(requester), 0);
        
        vm.prank(requester);
        uint256 nonce = escrow.getNonceAndIncrement(requester);
        assertEq(nonce, 0);
        assertEq(escrow.getNonce(requester), 1);
    }

    function testIsHTLCActive() public {
        // Initially not active (doesn't exist)
        assertFalse(escrow.isHTLCActive(HTLC_ID));
        
        // Lock funds
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Now active
        assertTrue(escrow.isHTLCActive(HTLC_ID));
        
        // After claiming, not active
        vm.prank(resolver);
        escrow.claimFunds(HTLC_ID, SECRET);
        assertFalse(escrow.isHTLCActive(HTLC_ID));
    }

    function testCanRefundHTLC() public {
        // Lock funds
        vm.prank(requester);
        escrow.lockFunds{value: 1 ether}(
            HTLC_ID,
            resolver,
            address(0),
            1 ether,
            SECRET_HASH,
            requesterTimelock
        );
        
        // Cannot refund before expiry
        assertFalse(escrow.canRefundHTLC(HTLC_ID));
        
        // Can refund after expiry
        vm.warp(requesterTimelock + 1);
        assertTrue(escrow.canRefundHTLC(HTLC_ID));
    }
    function testWithdrawStakeInsufficientMinimum() public {
        // Try to withdraw too much (leaving less than minimum)
        vm.prank(resolver);
        vm.expectRevert("Must maintain minimum stake");
        escrow.withdrawStake(1.5 ether);
    }
}