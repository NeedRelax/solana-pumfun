'use client'

import { getPumpfunProgram, getPumpfunProgramId } from '@project/anchor' // 导入获取 Pumpfun 程序和程序 ID 的函数
import { useConnection } from '@solana/wallet-adapter-react' // 导入 Solana 连接钩子
import { Cluster, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js' // 导入 Solana 的核心类和常量
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query' // 导入 React Query 的钩子
import { useMemo } from 'react' // 导入 React 的 useMemo 钩子
import { useCluster } from '../cluster/cluster-data-access' // 导入集群数据访问钩子
import { useAnchorProvider } from '../solana/solana-provider' // 导入 Anchor 提供者钩子
import { useTransactionToast } from '../use-transaction-toast' // 导入交易通知钩子
import { toast } from 'sonner' // 导入通知提示组件
import { BN } from '@coral-xyz/anchor' // 导入 Anchor 的大数类
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token' // 导入 SPL Token 相关功能
import { useWallet } from '@solana/wallet-adapter-react' // 导入 Solana 钱包钩子

// --- Core Hook: Interacts with the entire pumpfun program ---
export function usePumpfunProgram() {
  const { connection } = useConnection() // 获取 Solana 网络连接
  const { cluster } = useCluster() // 获取当前集群信息
  const transactionToast = useTransactionToast() // 获取交易通知函数
  const provider = useAnchorProvider() // 获取 Anchor 提供者
  const { publicKey } = useWallet() // 获取当前钱包公钥
  const queryClient = useQueryClient() // 获取 React Query 客户端

  const programId = useMemo(() => getPumpfunProgramId(cluster.network as Cluster), [cluster]) // 基于集群计算程序 ID
  const program = useMemo(() => getPumpfunProgram(provider), [provider]) // 获取 Pumpfun 程序实例

  const [protocolConfigPda] = useMemo(
    () => PublicKey.findProgramAddressSync([Buffer.from('protocol_config')], programId), // 计算协议配置 PDA
    [programId],
  )

  const bondingCurves = useQuery({
    queryKey: ['pumpfun', 'all', { cluster }], // 查询键
    queryFn: () => program.account.bondingCurve.all(), // 获取所有绑定曲线账户
  })

  const protocolConfigQueryKey = ['pumpfun', 'config', { cluster }] // 协议配置查询键
  const protocolConfig = useQuery({
    queryKey: protocolConfigQueryKey,
    queryFn: () => program.account.protocolConfig.fetch(protocolConfigPda), // 获取协议配置数据
  })

  const initializeConfigMutation = useMutation({
    mutationKey: ['pumpfun', 'initializeConfig', { cluster, publicKey }], // 初始化配置 mutation 键
    mutationFn: async () => {
      if (!publicKey) {
        throw new Error('Wallet not connected') // 检查钱包是否连接
      }
      const treasury = Keypair.generate() // 生成新的金库密钥对
      console.log(`Using new treasury address: ${treasury.publicKey.toBase58()}`) // 打印金库地址

      return program.methods
        .initializeConfig()
        .accounts({
          authority: publicKey, // 设置授权账户
          protocolConfig: protocolConfigPda, // 协议配置 PDA
          treasury: treasury.publicKey, // 金库账户
          systemProgram: SystemProgram.programId, // 系统程序
        })
        .rpc() // 执行初始化配置的 RPC 调用
    },
    onSuccess: (signature) => {
      transactionToast(signature) // 显示交易成功通知
      protocolConfig.refetch() // 刷新协议配置数据
    },
    onError: (error) => {
      toast.error(`Failed to initialize program: ${error.message}`) // 显示初始化失败通知
    },
  })

  const createMutation = useMutation({
    mutationKey: ['pumpfun', 'create', { cluster, publicKey }], // 创建代币 mutation 键
    mutationFn: async ({ name, symbol }: { name: string; symbol: string }) => {
      const currentConfig = queryClient.getQueryData<any>(protocolConfigQueryKey) // 获取当前协议配置

      if (!publicKey || !currentConfig) {
        throw new Error('Wallet not connected or protocol config not available in cache') // 检查钱包和配置
      }

      const tokenMint = Keypair.generate() // 生成新的代币铸造密钥对
      const [bondingCurvePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding_curve'), tokenMint.publicKey.toBuffer()], // 计算绑定曲线 PDA
        programId,
      )
      const tokenVaultAta = getAssociatedTokenAddressSync(
        tokenMint.publicKey,
        bondingCurvePda,
        true,
        TOKEN_2022_PROGRAM_ID,
      ) // 获取代币金库关联账户地址

      return program.methods
        .create(name, symbol) // 调用创建代币方法
        .accounts({
          creator: publicKey, // 设置创建者账户
          protocolConfig: protocolConfigPda, // 协议配置 PDA
          treasury: currentConfig.treasury, // 金库账户
          tokenMint: tokenMint.publicKey, // 代币铸造地址
          bondingCurve: bondingCurvePda, // 绑定曲线 PDA
          tokenVault: tokenVaultAta, // 代币金库账户
          systemProgram: SystemProgram.programId, // 系统程序
          tokenProgram: TOKEN_2022_PROGRAM_ID, // Token 2022 程序
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序
        })
        .signers([tokenMint]) // 设置代币铸造密钥对为签名者
        .rpc() // 执行创建代币的 RPC 调用
    },
    onSuccess: (signature) => {
      transactionToast(signature) // 显示交易成功通知
      bondingCurves.refetch() // 刷新绑定曲线数据
    },
    onError: (error) => {
      toast.error(`Failed to create token: ${error.message}`) // 显示创建失败通知
    },
  })

  return {
    program, // Pumpfun 程序实例
    programId, // 程序 ID
    bondingCurves, // 绑定曲线查询
    protocolConfig, // 协议配置查询
    protocolConfigPda, // 协议配置 PDA
    isConfigLoading: protocolConfig.isLoading, // 配置加载状态
    initializeConfigMutation, // 初始化配置 mutation
    createMutation, // 创建代币 mutation
  }
}

// --- Helper Hook: Interacts with a single BondingCurve (token) account ---
export function useBondingCurve({ bondingCurve: bondingCurvePda }: { bondingCurve: PublicKey }) {
  const { cluster } = useCluster() // 获取当前集群信息
  const queryClient = useQueryClient() // 获取 React Query 客户端
  const transactionToast = useTransactionToast() // 获取交易通知函数
  const { program, programId, protocolConfig, protocolConfigPda } = usePumpfunProgram() // 获取 Pumpfun 程序相关数据
  const { publicKey: user } = useWallet() // 获取当前用户公钥
  const provider = useAnchorProvider() // 获取 Anchor 提供者

  const accountQuery = useQuery({
    queryKey: ['pumpfun', 'fetch', { cluster, bondingCurvePda }], // 查询键
    queryFn: () => program.account.bondingCurve.fetch(bondingCurvePda), // 获取绑定曲线账户数据
  })

  const buyMutation = useMutation({
    mutationKey: ['pumpfun', 'buy', { cluster, bondingCurvePda, user }], // 购买 mutation 键
    mutationFn: async (solIn: number) => {
      if (!user || !protocolConfig.data || !accountQuery.data) {
        throw new Error('Required accounts not ready') // 检查必要账户是否准备好
      }
      const buyerTokenAccount = getAssociatedTokenAddressSync(
        accountQuery.data.tokenMint,
        user,
        false,
        TOKEN_2022_PROGRAM_ID,
      ) // 获取买家代币账户地址
      const solInBn = new BN(solIn * LAMPORTS_PER_SOL) // 转换为 lamports
      const transferInstruction = SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: bondingCurvePda,
        lamports: solInBn.toNumber(),
      }) // 创建 SOL 转账指令

      return program.methods
        .buy(solInBn, new BN(0), new BN(Math.floor(Date.now() / 1000) + 60)) // 调用购买方法
        .accounts({
          buyer: user, // 买家账户
          protocolConfig: protocolConfigPda, // 协议配置 PDA
          treasury: protocolConfig.data.treasury, // 金库账户
          bondingCurve: bondingCurvePda, // 绑定曲线 PDA
          tokenMint: accountQuery.data.tokenMint, // 代币铸造地址
          tokenVault: accountQuery.data.tokenVault, // 代币金库账户
          buyerTokenAccount: buyerTokenAccount, // 买家代币账户
          systemProgram: SystemProgram.programId, // 系统程序
          tokenProgram: TOKEN_2022_PROGRAM_ID, // Token 2022 程序
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序
        })
        .preInstructions([transferInstruction]) // 添加转账指令
        .rpc() // 执行购买的 RPC 调用
    },
    onSuccess: (tx) => {
      transactionToast(tx) // 显示交易成功通知
      accountQuery.refetch() // 刷新绑定曲线数据
    },
    onError: (error) => toast.error(`Buy failed: ${error.message}`), // 显示购买失败通知
  })

  const sellMutation = useMutation({
    mutationKey: ['pumpfun', 'sell', { cluster, bondingCurvePda, user }], // 出售 mutation 键
    mutationFn: async (tokenAmount: number) => {
      if (!user || !protocolConfig.data || !accountQuery.data) {
        throw new Error('Required accounts not ready') // 检查必要账户是否准备好
      }
      const sellerTokenAccount = getAssociatedTokenAddressSync(
        accountQuery.data.tokenMint,
        user,
        false,
        TOKEN_2022_PROGRAM_ID,
      ) // 获取卖家代币账户地址
      const tokenAmountBn = new BN(tokenAmount * 10 ** 6) // 转换为代币基础单位（6 位小数）

      return program.methods
        .sell(tokenAmountBn, new BN(0), new BN(Math.floor(Date.now() / 1000) + 60)) // 调用出售方法
        .accounts({
          seller: user, // 卖家账户
          protocolConfig: protocolConfigPda, // 协议配置 PDA
          treasury: protocolConfig.data.treasury, // 金库账户
          bondingCurve: bondingCurvePda, // 绑定曲线 PDA
          tokenMint: accountQuery.data.tokenMint, // 代币铸造地址
          tokenVault: accountQuery.data.tokenVault, // 代币金库账户
          sellerTokenAccount: sellerTokenAccount, // 卖家代币账户
          systemProgram: SystemProgram.programId, // 系统程序
          tokenProgram: TOKEN_2022_PROGRAM_ID, // Token 2022 程序
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序
        })
        .rpc() // 执行出售的 RPC 调用
    },
    onSuccess: (tx) => {
      transactionToast(tx) // 显示交易成功通知
      accountQuery.refetch() // 刷新绑定曲线数据
    },
    onError: (error) => toast.error(`Sell failed: ${error.message}`), // 显示出售失败通知
  })

  // The claimFeesMutation does not directly interact with the token program, so it doesn't need the fix.
  const claimFeesMutation = useMutation({
    mutationKey: ['pumpfun', 'claimFees', { cluster, bondingCurvePda, user }], // 提取费用 mutation 键
    mutationFn: () => {
      if (!user || !accountQuery.data || !user.equals(accountQuery.data.creator)) {
        throw new Error('Only the creator can claim fees.') // 确保只有创建者可以提取费用
      }
      return program.methods.claimCreatorFees().accounts({ creator: user, bondingCurve: bondingCurvePda }).rpc() // 执行提取费用的 RPC 调用
    },
    onSuccess: (tx) => {
      transactionToast(tx) // 显示交易成功通知
      accountQuery.refetch() // 刷新绑定曲线数据
    },
    onError: (error) => toast.error(`Fee claim failed: ${error.message}`), // 显示提取费用失败通知
  })

  const initializeDexPoolMutation = useMutation({
    mutationKey: ['pumpfun', 'initDex', { cluster, bondingCurvePda, user }], // 初始化 DEX 池 mutation 键
    mutationFn: () => {
      if (!provider.wallet.publicKey || !accountQuery.data) throw new Error('Wallet or account data not ready') // 检查钱包和账户数据
      const tokenMint = accountQuery.data.tokenMint // 获取代币铸造地址
      const [dexPoolPda] = PublicKey.findProgramAddressSync([Buffer.from('dex_pool'), tokenMint.toBuffer()], programId) // 计算 DEX 池 PDA
      const [dexSolVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dex_sol_vault'), tokenMint.toBuffer()],
        programId,
      ) // 计算 DEX SOL 金库 PDA
      const [lpMintPda] = PublicKey.findProgramAddressSync([Buffer.from('lp_mint'), tokenMint.toBuffer()], programId) // 计算 LP 铸造 PDA
      const dexTokenVaultAta = getAssociatedTokenAddressSync(tokenMint, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // 获取 DEX 代币金库账户
      const lpVaultAta = getAssociatedTokenAddressSync(lpMintPda, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // 获取 LP 金库账户

      return program.methods
        .initializeDexPool()
        .accounts({
          payer: provider.wallet.publicKey, // 支付者账户
          tokenMint: tokenMint, // 代币铸造地址
          dexPool: dexPoolPda, // DEX 池 PDA
          dexSolVault: dexSolVaultPda, // DEX SOL 金库
          lpMint: lpMintPda, // LP 铸造地址
          dexTokenVault: dexTokenVaultAta, // DEX 代币金库账户
          lpVault: lpVaultAta, // LP 金库账户
          systemProgram: SystemProgram.programId, // 系统程序
          tokenProgram: TOKEN_2022_PROGRAM_ID, // Token 2022 程序
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序
        })
        .rpc() // 执行初始化 DEX 池的 RPC 调用
    },
    onSuccess: (tx) => toast.success('DEX pool initialized! Ready for migration.'), // 显示初始化成功通知
    onError: (error) => toast.error(`DEX init failed: ${error.message}`), // 显示初始化失败通知
  })

  const migrateMutation = useMutation({
    mutationKey: ['pumpfun', 'migrate', { cluster, bondingCurvePda, user }], // 迁移 mutation 键
    mutationFn: () => {
      if (!user || !accountQuery.data || !user.equals(accountQuery.data.creator)) {
        throw new Error('Only the creator can migrate.') // 确保只有创建者可以迁移
      }
      const tokenMint = accountQuery.data.tokenMint // 获取代币铸造地址
      const [dexPoolPda] = PublicKey.findProgramAddressSync([Buffer.from('dex_pool'), tokenMint.toBuffer()], programId) // 计算 DEX 池 PDA
      const [dexSolVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('dex_sol_vault'), tokenMint.toBuffer()],
        programId,
      ) // 计算 DEX SOL 金库 PDA
      const [lpMintPda] = PublicKey.findProgramAddressSync([Buffer.from('lp_mint'), tokenMint.toBuffer()], programId) // 计算 LP 铸造 PDA
      const dexTokenVaultAta = getAssociatedTokenAddressSync(tokenMint, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // 获取 DEX 代币金库账户
      const lpVaultAta = getAssociatedTokenAddressSync(lpMintPda, dexPoolPda, true, TOKEN_2022_PROGRAM_ID) // 获取 LP 金库账户

      return program.methods
        .completeAndMigrate()
        .accounts({
          creator: user, // 创建者账户
          protocolConfig: protocolConfigPda, // 协议配置 PDA
          bondingCurve: bondingCurvePda, // 绑定曲线 PDA
          tokenMint: tokenMint, // 代币铸造地址
          tokenVault: accountQuery.data.tokenVault, // 代币金库账户
          dexPool: dexPoolPda, // DEX 池 PDA
          dexSolVault: dexSolVaultPda, // DEX SOL 金库
          dexTokenVault: dexTokenVaultAta, // DEX 代币金库账户
          lpMint: lpMintPda, // LP 铸造地址
          lpVault: lpVaultAta, // LP 金库账户
          systemProgram: SystemProgram.programId, // 系统程序
          tokenProgram: TOKEN_2022_PROGRAM_ID, // Token 2022 程序
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, // 关联代币程序
        })
        .rpc() // 执行迁移的 RPC 调用
    },
    onSuccess: (tx) => {
      transactionToast(tx) // 显示交易成功通知
      toast.success('Migration complete!') // 显示迁移完成通知
      accountQuery.refetch() // 刷新绑定曲线数据
      queryClient.invalidateQueries({ queryKey: ['pumpfun', 'all', { cluster }] }) // 使所有绑定曲线查询失效
    },
    onError: (error) => toast.error(`Migration failed: ${error.message}`), // 显示迁移失败通知
  })

  return {
    accountQuery, // 绑定曲线账户查询
    buyMutation, // 购买 mutation
    sellMutation, // 出售 mutation
    claimFeesMutation, // 提取费用 mutation
    initializeDexPoolMutation, // 初始化 DEX 池 mutation
    migrateMutation, // 迁移 mutation
  }
}

export function useUserTokenBalance({ mint }: { mint?: PublicKey }) {
  const { connection } = useConnection() // 获取 Solana 网络连接
  const { publicKey } = useWallet() // 获取当前用户公钥

  const userAta = useMemo(() => {
    if (!publicKey || !mint) return null // 如果缺少公钥或铸造地址，返回 null
    return getAssociatedTokenAddressSync(mint, publicKey, false, TOKEN_2022_PROGRAM_ID) // 计算用户关联代币账户地址
  }, [publicKey, mint])

  const balanceQuery = useQuery({
    queryKey: [
      'user-token-balance',
      { cluster: connection.rpcEndpoint, user: publicKey?.toBase58(), mint: mint?.toBase58() }, // 查询键
    ],
    queryFn: async () => {
      if (!userAta) return 0 // 如果没有关联代币账户，返回 0
      try {
        const account = await getAccount(connection, userAta, 'confirmed', TOKEN_2022_PROGRAM_ID) // 获取代币账户信息
        return Number(account.amount) / 10 ** 6 // 转换为代币单位（6 位小数）
      } catch (e) {
        return 0 // 如果获取失败，返回 0
      }
    },
    enabled: !!publicKey && !!mint && !!userAta, // 仅在公钥、铸造地址和关联账户都存在时启用查询
  })

  return {
    balanceQuery, // 代币余额查询
    refetch: () => balanceQuery.refetch(), // 刷新余额查询的函数
  }
}
