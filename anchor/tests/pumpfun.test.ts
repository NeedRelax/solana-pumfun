import * as anchor from '@coral-xyz/anchor' // 导入Anchor框架，用于Solana程序开发和测试
import { Program } from '@coral-xyz/anchor' // 导入Program类型，用于交互Anchor程序
import { Pumpfun } from '../target/types/pumpfun' // 导入Pumpfun程序类型定义，从target/types生成
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js' // 导入Solana web3.js核心类型：密钥对、SOL单位、公钥、系统程序
import {
  // 导入SPL Token相关函数和常量
  ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序ID
  TOKEN_2022_PROGRAM_ID, // Token-2022程序ID
  getAssociatedTokenAddressSync, // 同步获取关联代币地址函数
  getMint, // 获取铸币信息函数
  getAccount, // 获取代币账户信息函数
} from '@solana/spl-token'
import { BN } from 'bn.js' // 导入BN，用于处理大整数

describe('pumpfun', () => {
  // Jest描述：pumpfun程序测试套件
  // --- Anchor 配置 ---  // 部分：Anchor配置
  const provider = anchor.AnchorProvider.env() // 获取环境提供者，用于连接Solana网络
  anchor.setProvider(provider) // 设置Anchor提供者
  const program = anchor.workspace.Pumpfun as Program<Pumpfun> // 获取Pumpfun程序实例
  const connection = provider.connection // 获取Solana连接

  // --- 常量 ---  // 部分：常量定义
  const MINT_DECIMALS = 6 // 铸币小数位数：6位

  // --- 账户和密钥对 ---  // 部分：账户和密钥对
  const governance = Keypair.generate() // 生成治理密钥对
  const treasury = Keypair.generate() // 生成国库密钥对
  const creator = Keypair.generate() // 生成创作者密钥对
  const buyer = Keypair.generate() // buyer 也是 seller  // 生成买家/卖家密钥对（buyer也是seller）

  // --- 动态生成的密钥和PDA ---  // 部分：动态PDA和密钥
  let protocolConfigPda: PublicKey // 协议配置PDA
  let tokenMint: Keypair // 代币铸币密钥对
  let bondingCurvePda: PublicKey // 绑定曲线PDA
  let tokenVaultAta: PublicKey // 代币金库ATA
  let buyerTokenAta: PublicKey // 买家代币ATA

  // --- 帮助函数 ---  // 部分：帮助函数
  const airdrop = async (to: PublicKey, lamports: number) => {
    // 函数：空投lamports到指定账户
    const signature = await connection.requestAirdrop(to, lamports) // 请求空投
    const latestBlockhash = await connection.getLatestBlockhash('confirmed') // 获取最新区块哈希
    await connection.confirmTransaction(
      // 确认交易
      {
        signature,
        ...latestBlockhash,
      },
      'confirmed',
    )
  }

  const getSolBalance = async (account: PublicKey) => {
    // 函数：获取账户SOL余额
    return connection.getBalance(account, 'confirmed') // 返回确认的余额
  }

  const getTokenBalance = async (ata: PublicKey) => {
    // 函数：获取代币余额
    try {
      const account = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID) // 获取代币账户
      return account.amount // 返回金额
    } catch (e) {
      if (e.name === 'TokenAccountNotFoundError') {
        // 如果账户不存在，返回0
        return BigInt(0)
      }
      throw e // 其他错误抛出
    }
  }

  // --- 测试设置 ---  // 部分：测试前设置
  beforeAll(async () => {
    // beforeAll钩子：所有测试前运行，超时60秒
    // 首先进行空投  // 先空投到各个账户
    await Promise.all([
      airdrop(governance.publicKey, 2 * LAMPORTS_PER_SOL),
      airdrop(creator.publicKey, 5 * LAMPORTS_PER_SOL),
      airdrop(buyer.publicKey, 60 * LAMPORTS_PER_SOL),
      airdrop(provider.wallet.publicKey, 5 * LAMPORTS_PER_SOL),
    ])

    // 循环查找一个有效的 Mint PDA 种子以确保测试的确定性  // 循环找有效铸币，直到所有PDA有效
    let validMintFound = false
    while (!validMintFound) {
      const candidateMint = Keypair.generate() // 生成候选铸币
      try {
        PublicKey.findProgramAddressSync(
          // 检查绑定曲线PDA
          [Buffer.from('bonding_curve'), candidateMint.publicKey.toBuffer()],
          program.programId,
        )
        PublicKey.findProgramAddressSync(
          // 检查DEX池PDA
          [Buffer.from('dex_pool'), candidateMint.publicKey.toBuffer()],
          program.programId,
        )
        PublicKey.findProgramAddressSync(
          // 检查DEX SOL金库PDA
          [Buffer.from('dex_sol_vault'), candidateMint.publicKey.toBuffer()],
          program.programId,
        )
        PublicKey.findProgramAddressSync(
          // 检查LP铸币PDA
          [Buffer.from('lp_mint'), candidateMint.publicKey.toBuffer()],
          program.programId,
        )
        tokenMint = candidateMint // 设置有效铸币
        validMintFound = true
        console.log(`Found a valid token mint for all PDAs: ${tokenMint.publicKey.toBase58()}`) // 日志：找到有效铸币
      } catch (err) {
        // 这是一个预期的失败情况，我们只需要继续循环  // 预期失败，继续循环
      }
    }

    // 计算并分配所有 PDA  // 计算所有PDA
    ;[protocolConfigPda] = PublicKey.findProgramAddressSync([Buffer.from('protocol_config')], program.programId) // 协议配置PDA
    ;[bondingCurvePda] = PublicKey.findProgramAddressSync(
      // 绑定曲线PDA
      [Buffer.from('bonding_curve'), tokenMint.publicKey.toBuffer()],
      program.programId,
    )
    tokenVaultAta = getAssociatedTokenAddressSync(
      // 金库ATA
      tokenMint.publicKey,
      bondingCurvePda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    buyerTokenAta = getAssociatedTokenAddressSync(
      // 买家ATA
      tokenMint.publicKey,
      buyer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  }, 60000) // 超时60秒

  describe('Configuration', () => {
    // 描述：配置测试
    it('should initialize the protocol config', async () => {
      // 测试：初始化协议配置
      await program.methods // 调用初始化方法
        .initializeConfig()
        .accounts({
          authority: governance.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([governance])
        .rpc({ commitment: 'confirmed' })

      const config = await program.account.protocolConfig.fetch(protocolConfigPda) // 获取配置
      expect(config.governanceAuthority.toString()).toEqual(governance.publicKey.toString()) // 断言治理权限
      expect(config.treasury.toString()).toEqual(treasury.publicKey.toString()) // 断言国库
    })

    it('should update the protocol config', async () => {
      // 测试：更新协议配置
      const newTreasury = Keypair.generate() // 生成新国库
      const originalConfig = await program.account.protocolConfig.fetch(protocolConfigPda) // 获取原配置
      const newConfigData = { ...originalConfig, treasury: newTreasury.publicKey, isPaused: true } // 新配置数据

      await program.methods // 调用更新方法
        .updateConfig(newConfigData)
        .accounts({ governanceAuthority: governance.publicKey, protocolConfig: protocolConfigPda })
        .signers([governance])
        .rpc({ commitment: 'confirmed' })

      const updatedConfig = await program.account.protocolConfig.fetch(protocolConfigPda) // 获取更新配置
      expect(updatedConfig.treasury.toString()).toEqual(newTreasury.publicKey.toString()) // 断言新国库
      expect(updatedConfig.isPaused).toBe(true) // 断言暂停状态

      await program.methods // 恢复原配置
        .updateConfig({ ...newConfigData, isPaused: false, treasury: treasury.publicKey })
        .accounts({ governanceAuthority: governance.publicKey, protocolConfig: protocolConfigPda })
        .signers([governance])
        .rpc({ commitment: 'confirmed' })
    })
  })

  describe('Token Lifecycle', () => {
    // 描述：代币生命周期测试
    it('should create a new token and bonding curve', async () => {
      // 测试：创建代币和曲线
      await program.methods // 调用创建方法
        .create('Test Token', 'TEST')
        .accounts({
          creator: creator.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          tokenMint: tokenMint.publicKey,
          bondingCurve: bondingCurvePda,
          tokenVault: tokenVaultAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([creator, tokenMint])
        .rpc({ commitment: 'confirmed' })

      const mintInfo = await getMint(connection, tokenMint.publicKey, 'confirmed', TOKEN_2022_PROGRAM_ID) // 获取铸币信息
      expect(mintInfo.mintAuthority.toString()).toEqual(bondingCurvePda.toString()) // 断言铸币权限
    })

    it('should allow a user to buy tokens', async () => {
      // 测试：用户购买代币
      const solIn = new BN(1 * LAMPORTS_PER_SOL) // 输入1 SOL
      await program.methods // 调用购买方法
        .buy(solIn, new BN(0), new BN(Math.floor(Date.now() / 1000) + 60))
        .accounts({
          buyer: buyer.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          bondingCurve: bondingCurvePda,
          tokenMint: tokenMint.publicKey,
          tokenVault: tokenVaultAta,
          buyerTokenAccount: buyerTokenAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .preInstructions([
          // 预指令：转移SOL到曲线
          SystemProgram.transfer({
            fromPubkey: buyer.publicKey,
            toPubkey: bondingCurvePda,
            lamports: solIn.toNumber(),
          }),
        ])
        .rpc({ commitment: 'confirmed' })

      const buyerTokenBalance = await getTokenBalance(buyerTokenAta) // 获取买家余额
      expect(buyerTokenBalance).toBeGreaterThan(BigInt(0)) // 断言余额>0
    })

    it('should allow a user to sell tokens', async () => {
      // 测试：用户出售代币
      const tokenBalanceBefore = await getTokenBalance(buyerTokenAta) // 出售前余额
      const tokensToSell = tokenBalanceBefore / BigInt(2) // 出售一半
      if (tokensToSell === BigInt(0)) throw new Error('No tokens to sell') // 如果0，抛错

      await program.methods // 调用出售方法
        .sell(new BN(tokensToSell.toString()), new BN(0), new BN(Math.floor(Date.now() / 1000) + 60))
        .accounts({
          seller: buyer.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          bondingCurve: bondingCurvePda,
          tokenMint: tokenMint.publicKey,
          tokenVault: tokenVaultAta,
          sellerTokenAccount: buyerTokenAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc({ commitment: 'confirmed' })

      const sellerTokenBalanceAfter = await getTokenBalance(buyerTokenAta) // 出售后余额
      expect(sellerTokenBalanceAfter).toEqual(tokenBalanceBefore - tokensToSell) // 断言减少
    })

    it('should allow the creator to claim fees', async () => {
      // 测试：创作者领取费用
      const creatorSolBefore = await getSolBalance(creator.publicKey) // 领取前SOL余额
      const curveStateBefore = await program.account.bondingCurve.fetch(bondingCurvePda) // 曲线状态
      if (curveStateBefore.creatorFeesOwed.eqn(0)) {
        // 如果无费用，跳过
        console.log('No creator fees to claim, skipping test.')
        return
      }

      await program.methods // 调用领取方法
        .claimCreatorFees()
        .accounts({
          creator: creator.publicKey,
          bondingCurve: bondingCurvePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator])
        .rpc({ commitment: 'confirmed' })

      const creatorSolAfter = await getSolBalance(creator.publicKey) // 领取后余额
      expect(creatorSolAfter).toBeGreaterThan(creatorSolBefore) // 断言增加
    })
  })

  describe('Migration', () => {
    // 描述：迁移测试
    let dexPoolPda: PublicKey, dexSolVaultPda: PublicKey, lpMintPda: PublicKey // DEX相关PDA
    let dexTokenVaultAta: PublicKey, lpVaultAta: PublicKey // DEX ATA

    beforeAll(() => {
      // beforeAll：计算DEX PDA
      ;[dexPoolPda] = PublicKey.findProgramAddressSync(
        // DEX池PDA
        [Buffer.from('dex_pool'), tokenMint.publicKey.toBuffer()],
        program.programId,
      )
      ;[dexSolVaultPda] = PublicKey.findProgramAddressSync(
        // DEX SOL金库PDA
        [Buffer.from('dex_sol_vault'), tokenMint.publicKey.toBuffer()],
        program.programId,
      )
      ;[lpMintPda] = PublicKey.findProgramAddressSync(
        // LP铸币PDA
        [Buffer.from('lp_mint'), tokenMint.publicKey.toBuffer()],
        program.programId,
      )
      dexTokenVaultAta = getAssociatedTokenAddressSync(tokenMint.publicKey, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // DEX代币金库ATA
      lpVaultAta = getAssociatedTokenAddressSync(lpMintPda, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // LP金库ATA
    })

    it('should prepare for migration by meeting the threshold', async () => {
      // 测试：准备迁移，达到阈值
      const config = await program.account.protocolConfig.fetch(protocolConfigPda) // 获取配置
      let curveData = await program.account.bondingCurve.fetch(bondingCurvePda) // 获取曲线数据
      if (curveData.realSolReserves.lt(config.migrationThresholdSol)) {
        // 如果储备不足阈值
        const solToBuy = config.migrationThresholdSol.sub(curveData.realSolReserves).add(new BN(LAMPORTS_PER_SOL)) // 计算需购买SOL
        console.log(`Buying ${solToBuy.toNumber() / LAMPORTS_PER_SOL} SOL to meet migration threshold...`) // 日志

        await program.methods // 调用购买以达到阈值
          .buy(solToBuy, new BN(0), new BN(Math.floor(Date.now() / 1000) + 60))
          .accounts({
            buyer: buyer.publicKey,
            protocolConfig: protocolConfigPda,
            treasury: treasury.publicKey,
            bondingCurve: bondingCurvePda,
            tokenMint: tokenMint.publicKey,
            tokenVault: tokenVaultAta,
            buyerTokenAccount: buyerTokenAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .preInstructions([
            // 预指令：转移SOL
            SystemProgram.transfer({
              fromPubkey: buyer.publicKey,
              toPubkey: bondingCurvePda,
              lamports: solToBuy.toNumber(),
            }),
          ])
          .rpc({ commitment: 'confirmed' })
      }

      curveData = await program.account.bondingCurve.fetch(bondingCurvePda) // 重新获取曲线
      expect(curveData.realSolReserves.gte(config.migrationThresholdSol)).toBe(true) // 断言达到阈值
    })

    it('should complete and migrate to a DEX pool', async () => {
      // 测试：完成并迁移到DEX池
      // Step 1: Initialize DEX accounts  // 步骤1：初始化DEX账户
      console.log('Initializing DEX pool accounts...') // 日志
      await program.methods // 调用初始化DEX池
        .initializeDexPool()
        .accounts({
          payer: provider.wallet.publicKey,
          tokenMint: tokenMint.publicKey,
          dexPool: dexPoolPda,
          dexSolVault: dexSolVaultPda,
          lpMint: lpMintPda,
          dexTokenVault: dexTokenVaultAta,
          lpVault: lpVaultAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' })
      console.log('DEX accounts initialized successfully.') // 日志

      // Step 2: Prepare for migration logic call  // 步骤2：准备迁移
      console.log('Migrating liquidity...') // 日志
      const curveStateBefore = await program.account.bondingCurve.fetch(bondingCurvePda) // 迁移前曲线状态
      const vaultBalanceBefore = await getTokenBalance(tokenVaultAta) // 金库余额
      const bondingCurveLamportsBefore = await getSolBalance(bondingCurvePda) // 曲线lamports
      const dexSolVaultBalanceBefore = await getSolBalance(dexSolVaultPda) // DEX SOL金库余额

      // Step 3: Call migration logic  // 步骤3：调用迁移
      await program.methods
        .completeAndMigrate()
        .accounts({
          protocolConfig: protocolConfigPda,
          bondingCurve: bondingCurvePda,
          creator: creator.publicKey,
          tokenMint: tokenMint.publicKey,
          tokenVault: tokenVaultAta,
          dexPool: dexPoolPda,
          dexSolVault: dexSolVaultPda,
          dexTokenVault: dexTokenVaultAta,
          lpMint: lpMintPda,
          lpVault: lpVaultAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([creator])
        .rpc({ commitment: 'confirmed' })

      // Step 4: Assertions (与新的链上逻辑匹配)  // 步骤4：断言（匹配链上逻辑）
      // 验证 bonding_curve 帐户现在存在并且其 isCompleted 标志为 true  // 注释已存在
      // 1. 验证 bonding_curve 帐户现在存在并且其 isCompleted 标志为 true
      const curveStateAfter = await program.account.bondingCurve.fetch(bondingCurvePda) // 迁移后曲线
      expect(curveStateAfter.isCompleted).toBe(true) // 断言完成

      // 2. 验证 token_vault 帐户已被成功关闭
      const tokenVaultInfoAfter = await connection.getAccountInfo(tokenVaultAta) // 获取金库信息
      expect(tokenVaultInfoAfter).toBeNull() // 断言已关闭（null）

      // 3. 验证 SOL 守恒：两个账户的总余额在迁移前后应该相等
      const bondingCurveLamportsAfter = await getSolBalance(bondingCurvePda) // 后lamports
      const dexSolVaultBalanceAfter = await getSolBalance(dexSolVaultPda) // 后DEX余额
      expect(bondingCurveLamportsAfter + dexSolVaultBalanceAfter).toEqual(
        // 断言SOL守恒
        bondingCurveLamportsBefore + dexSolVaultBalanceBefore,
      )

      // 4. 验证 DexPool 状态中的业务逻辑数据
      const dexPoolState = await program.account.dexPool.fetch(dexPoolPda) // 获取DEX池状态
      expect(dexPoolState.solReserves.toString()).toEqual(curveStateBefore.realSolReserves.toString()) // 断言SOL储备
      expect(dexPoolState.tokenReserves.toString()).toEqual(vaultBalanceBefore.toString()) // 断言代币储备
    })

    it('should fail to trade on a completed curve', async () => {
      // 测试：在完成曲线上的交易失败
      const solIn = new BN(0.1 * LAMPORTS_PER_SOL) // 输入0.1 SOL
      const buyPromise = program.methods // 调用购买（预期失败）
        .buy(solIn, new BN(0), new BN(Math.floor(Date.now() / 1000) + 60))
        .accounts({
          buyer: buyer.publicKey,
          protocolConfig: protocolConfigPda,
          treasury: treasury.publicKey,
          bondingCurve: bondingCurvePda,
          tokenMint: tokenMint.publicKey,
          tokenVault: tokenVaultAta, // 注意：这个账户已被关闭，交易会因此失败
          buyerTokenAccount: buyerTokenAta,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .preInstructions([
          // 预指令：转移SOL
          SystemProgram.transfer({
            fromPubkey: buyer.publicKey,
            toPubkey: bondingCurvePda,
            lamports: solIn.toNumber(),
          }),
        ])
        .rpc({ commitment: 'confirmed' })

      // 验证交易因我们预期的业务逻辑错误而失败  // 注释已存在：预期抛出错误
      await expect(buyPromise).rejects.toThrow('The bonding curve has been completed and trading is locked.')
    })
  })
})
