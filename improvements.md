okay  first of all there will be a nextjs frontend black and white theme clean plain theme : 

 1inch Wallet ( viem / wagmi ) & fusion sdk for ETH --> Sol ( exchanges )


 -- Changes in the relayer : 
     Each Swaps would have SwapID which would be deployed SafeAddress : and also contracts would have events if any new Swaps would be there in which they would emit indexed user , amountIn ( how much ETH for sepolia lets say, indexed lockDuration  ), 

     if user want to swap lets say from ETH / SUI  to SUI /ETH they would connect their respective wallets .

      requestor --> fundslocks, safe deployed ( from the frontend ) as soon as any safe on respective chain  gets deployed the safeAddress (on respective chains)  --> safeaddress is being indexed in the relayer by indexing SafeRecord for both chains sepolia eth / sui testnet and also the lockTime also( which is configurable )  --> so the frontend would show that available listed swaps on our protocol using SafeRecord contracr  which would keep track of every swaps initiated using a simple cards , and it would be available for every user who visits our platform in whuich the indexer would make it dynamic, and lets say some resolver  wants to do the swaps they will go to that particular swap , they will freeze their respective tokens like lets say for eth they will spend sui and lock sui on the sui safeAddress after signing and then --> relayer would know that some resolver just deployed safe on sui for some eth SafeAddress lets say for the safe at sepolia eth from the sui SafeAddr on SafeRecord , and that swap will be only visible to the respective requestor and resolvers only , now the original requestor can withdraw sui after giving out secret their which will unlock the sui for the requestor and then after withdrawing the resolver can basically see the secret because we will be polling the contracts on both chains to see the secret and would let the resolver know that using this you can unlock your eth on your msg.sender or directly applying your walletaddress at withdraw money this will automate all of the minting crosschain     


     All the swaps available on our CEX , 

     


