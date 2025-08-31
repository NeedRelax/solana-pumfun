'use client'

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js' // 导入 Solana 的 PublicKey 和 LAMPORTS_PER_SOL 常量
import { useState, useEffect } from 'react' // 导入 React 的状态和副作用钩子
import { ExplorerLink } from '../cluster/cluster-ui' // 导入用于显示 Solana 区块链链接的组件
import { usePumpfunProgram, useBondingCurve, useUserTokenBalance } from './pumpfun-data-access' // 导入 Pumpfun 相关的自定义钩子
import { ellipsify } from '@/lib/utils' // 导入用于截断字符串的工具函数
import { Button } from '@/components/ui/button' // 导入按钮组件
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../ui/card' // 导入卡片组件及其子组件
import { Input } from '@/components/ui/input' // 导入输入框组件
import { useWallet, useConnection } from '@solana/wallet-adapter-react' // 导入 Solana 钱包和连接钩子
import { Progress } from '@/components/ui/progress' // 导入进度条组件
import { toast } from 'sonner' // 导入通知提示组件
import { useQuery } from '@tanstack/react-query' // 导入 React Query 的查询钩子

type PumpfunCreateProps = {
  isLoading: boolean // 定义组件的 props 类型，包含 isLoading 属性
}

export function PumpfunCreate({ isLoading }: PumpfunCreateProps) {
  // 创建新代币的组件
  const { createMutation } = usePumpfunProgram() // 获取 Pumpfun 程序的创建代币 mutation
  const [name, setName] = useState('') // 管理代币名称的状态
  const [symbol, setSymbol] = useState('') // 管理代币符号的状态

  const handleSubmit = () => {
    // 处理表单提交的函数
    if (!name || !symbol) {
      // 检查名称和符号是否为空
      return toast.error('Please enter a name and a symbol') // 显示错误提示
    }
    createMutation.mutateAsync({ name, symbol }) // 异步调用创建代币的 mutation
  }

  return (
    <div className="p-4 border rounded-md bg-background/50 space-y-4">
      <h2 className="text-xl font-semibold">Create New Token</h2>
      <fieldset disabled={isLoading} className="space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <Input placeholder="Token Name (e.g. MyCatCoin)" value={name} onChange={(e) => setName(e.target.value)} />{' '}
          {/* 代币名称输入框 */}
          <Input placeholder="Symbol (e.g. CAT)" value={symbol} onChange={(e) => setSymbol(e.target.value)} />{' '}
          {/* 代币符号输入框 */}
        </div>
        <Button onClick={handleSubmit} disabled={createMutation.isPending || isLoading}>
          {' '}
          {/* 提交按钮 */}
          {isLoading ? 'Loading Config...' : createMutation.isPending ? 'Creating Token...' : 'Create Token'}
        </Button>
      </fieldset>
    </div>
  )
}

export function PumpfunList() {
  // 显示代币列表的组件
  const { bondingCurves } = usePumpfunProgram() // 获取 Pumpfun 程序的绑定曲线数据

  if (bondingCurves.isLoading) {
    // 如果数据正在加载
    return (
      <div className="w-full text-center py-12">
        <span className="loading loading-spinner loading-lg"></span> {/* 显示加载动画 */}
      </div>
    )
  }
  if (!bondingCurves.data?.length) {
    // 如果没有代币数据
    return (
      <div className="alert alert-info flex justify-center mt-6">
        <span>No tokens found. Create one above to get started.</span> {/* 显示无代币提示 */}
      </div>
    )
  }
  return (
    <div className={'space-y-6 mt-6'}>
      <h2 className="text-2xl font-bold text-center">Available Tokens</h2>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bondingCurves.data?.map(
          (
            account, // 遍历代币数据并渲染卡片
          ) => (
            <PumpfunCard key={account.publicKey.toString()} bondingCurve={account.publicKey} />
          ),
        )}
      </div>
    </div>
  )
}

function PumpfunCard({ bondingCurve }: { bondingCurve: PublicKey }) {
  // 单个代币卡片组件
  // --- Hooks for program interaction and wallet state ---
  const { accountQuery, buyMutation, sellMutation, claimFeesMutation, initializeDexPoolMutation, migrateMutation } =
    useBondingCurve({ bondingCurve }) // 获取绑定曲线的相关 mutation 和查询
  const { protocolConfig } = usePumpfunProgram() // 获取 Pumpfun 程序的协议配置
  const { publicKey } = useWallet() // 获取当前钱包的公钥
  const { connection } = useConnection() // 获取 Solana 网络连接

  // --- State for input fields ---
  const [buyAmountSol, setBuyAmountSol] = useState('0.1') // 管理购买 SOL 数量的状态
  const [sellAmountToken, setSellAmountToken] = useState('10000') // 管理出售代币数量的状态

  // --- Data from program queries ---
  const data = accountQuery.data // 获取绑定曲线账户数据
  const config = protocolConfig.data // 获取协议配置数据

  // --- 获取用户代币余额 ---
  const { balanceQuery: userTokenBalance, refetch: refetchTokenBalance } = useUserTokenBalance({
    mint: data?.tokenMint, // 使用代币铸造地址查询用户余额
  })

  // --- 查询用户 SOL 余额 ---
  const userSolBalance = useQuery({
    queryKey: ['sol-balance', { cluster: connection.rpcEndpoint, user: publicKey?.toBase58() }], // 查询键
    queryFn: async () => {
      if (!publicKey) return 0 // 如果没有公钥，返回 0
      return (await connection.getBalance(publicKey)) / LAMPORTS_PER_SOL // 获取 SOL 余额并转换为 SOL 单位
    },
    enabled: !!publicKey, // 仅在公钥存在时启用查询
  })

  // --- 计算购买价格 ---
  const getBuyPrice = (solIn: number) => {
    if (!data || solIn <= 0) return 0 // 如果没有数据或输入无效，返回 0
    const solInLamports = solIn * LAMPORTS_PER_SOL // 转换为 lamports
    const x = data.virtualSolReserves.toNumber() // 获取虚拟 SOL 储备
    const y = data.virtualTokenReserves.toNumber() // 获取虚拟代币储备
    if (x === 0 || y === 0) return 0 // 如果储备为 0，返回 0
    const k = x * y // 计算常数 k
    const newX = x + solInLamports // 计算新的 SOL 储备
    return (y - k / newX) / 10 ** 6 // 返回购买获得的代币数量
  }

  // --- 计算出售价格 ---
  const getSellPrice = (tokensIn: number) => {
    if (!data || tokensIn <= 0) return 0 // 如果没有数据或输入无效，返回 0
    const tokensInBase = tokensIn * 10 ** 6 // 转换为代币基础单位
    const x = data.virtualSolReserves.toNumber() // 获取虚拟 SOL 储备
    const y = data.virtualTokenReserves.toNumber() // 获取虚拟代币储备
    if (x === 0 || y === 0) return 0 // 如果储备为 0，返回 0
    const k = x * y // 计算常数 k
    const newY = y + tokensInBase // 计算新的代币储备
    const newX = k / newY // 计算新的 SOL 储备
    return (x - newX) / LAMPORTS_PER_SOL // 返回出售获得的 SOL 数量
  }

  const solToTokenRate = getBuyPrice(1) // 计算 1 SOL 能购买的代币数量
  const tokenToSolRate = getSellPrice(1000) // 计算 1000 代币能换取的 SOL 数量

  // --- Derived State (computed from other state/data) ---
  const isCreator = data && publicKey && data.creator.equals(publicKey) // 判断当前用户是否为代币创建者
  const feesToClaim = data ? data.creatorFeesOwed.toNumber() / LAMPORTS_PER_SOL : 0 // 计算可提取的费用
  const migrationThreshold = config ? config.migrationThresholdSol.toNumber() : 1 // 获取迁移阈值
  const currentSolReserves = data ? data.realSolReserves.toNumber() : 0 // 获取当前 SOL 储备
  const migrationProgress = Math.min((currentSolReserves / migrationThreshold) * 100, 100) // 计算迁移进度
  const canMigrate = migrationProgress >= 100 // 判断是否可以迁移到 DEX

  // --- Effects for managing state and side effects ---
  useEffect(() => {
    // 初始化输入框状态和刷新余额
    setBuyAmountSol('0.1') // 设置默认购买 SOL 数量
    setSellAmountToken('10000') // 设置默认出售代币数量
    if (publicKey) {
      // 如果有公钥
      userTokenBalance.refetch() // 刷新代币余额
      userSolBalance.refetch() // 刷新 SOL 余额
    }
  }, [publicKey]) // 依赖于公钥变化

  useEffect(() => {
    // 在买卖交易成功后刷新余额
    if (buyMutation.isSuccess || sellMutation.isSuccess) {
      // 如果购买或出售成功
      refetchTokenBalance() // 刷新代币余额
      userSolBalance.refetch() // 刷新 SOL 余额
    }
  }, [buyMutation.isSuccess, sellMutation.isSuccess]) // 依赖于交易状态

  // --- Event Handlers ---
  const handleMigrate = async () => {
    // 处理迁移到 DEX 的函数
    if (!window.confirm('This will initialize the DEX pool and permanently migrate liquidity. Are you sure?')) return // 确认迁移操作
    try {
      toast.info('Step 1/2: Initializing DEX pool...') // 显示初始化 DEX 池提示
      await initializeDexPoolMutation.mutateAsync() // 初始化 DEX 池
      toast.info('Step 2/2: Migrating liquidity...') // 显示迁移流动性提示
      await migrateMutation.mutateAsync() // 迁移流动性
    } catch (e) {
      // 错误由 mutation 的 onError 回调处理
    }
  }

  // --- Render Logic ---
  if (accountQuery.isLoading) {
    // 如果账户数据正在加载
    return (
      <Card className="animate-pulse">
        <CardHeader>
          <div className="h-6 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-full mt-2"></div>
        </CardHeader>
        <CardContent className="h-48 bg-muted/50 rounded-b-md"></CardContent>
      </Card>
    )
  }

  if (!data) {
    // 如果没有账户数据
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error loading token</CardTitle>
          <CardDescription>Could not fetch data for this bonding curve.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Mint</CardTitle> {/* 显示代币铸造标题 */}
        <CardDescription>
          <ExplorerLink path={`account/${data.tokenMint.toString()}`} label={ellipsify(data.tokenMint.toString())} />{' '}
          {/* 显示代币铸造地址 */}
        </CardDescription>
        <div className="text-xs text-muted-foreground pt-1">
          Creator:{' '}
          <ExplorerLink path={`account/${data.creator.toString()}`} label={ellipsify(data.creator.toString())} />{' '}
          {/* 显示创建者地址 */}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* User Info Panel */}
        <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
          <h4 className="font-semibold text-center">Your Wallet</h4>
          <div className="flex justify-between">
            <span>SOL Balance:</span>
            <span className="font-mono">
              {userSolBalance.isLoading ? '...' : (userSolBalance.data?.toFixed(4) ?? '0.0000')} {/* 显示 SOL 余额 */}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Token Balance:</span>
            <span className="font-mono">
              {userTokenBalance.isLoading ? '...' : (userTokenBalance.data?.toLocaleString() ?? '0')}{' '}
              {/* 显示代币余额 */}
            </span>
          </div>
          <hr className="my-2 border-dashed" />
          <h4 className="font-semibold text-center mt-2">Live Rates (est.)</h4>
          <div className="flex justify-between text-xs">
            <span>1 SOL ≈</span>
            <span className="font-mono">
              {solToTokenRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} Tokens{' '}
              {/* 显示 SOL 到代币的汇率 */}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span>1,000 Tokens ≈</span>
            <span className="font-mono">{tokenToSolRate.toFixed(6)} SOL</span> {/* 显示代币到 SOL 的汇率 */}
          </div>
        </div>

        {/* Market Info */}
        <div>
          <p className="text-sm">
            SOL Reserves: <strong>{(data.realSolReserves.toNumber() / LAMPORTS_PER_SOL).toFixed(4)} SOL</strong>{' '}
            {/* 显示 SOL 储备 */}
          </p>
          <p className="text-sm text-muted-foreground">
            Market Cap: ~${((data.virtualSolReserves.toNumber() / LAMPORTS_PER_SOL) * 2).toFixed(2)}{' '}
            {/* 显示市场总值 */}
          </p>
        </div>

        {/* Trading Section */}
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              value={buyAmountSol}
              onChange={(e) => setBuyAmountSol(e.target.value)}
              placeholder="SOL Amount"
              disabled={buyMutation.isPending || data.isCompleted} // 购买输入框
            />
            <Button
              onClick={() => buyMutation.mutateAsync(parseFloat(buyAmountSol))}
              disabled={buyMutation.isPending || data.isCompleted} // 购买按钮
            >
              Buy {buyMutation.isPending && '...'}
            </Button>
          </div>
          <div className="flex gap-2 items-center">
            <Input
              type="number"
              value={sellAmountToken}
              onChange={(e) => setSellAmountToken(e.target.value)}
              placeholder="Token Amount"
              disabled={sellMutation.isPending || data.isCompleted} // 出售输入框
            />
            <Button
              variant="secondary"
              onClick={() => sellMutation.mutateAsync(parseFloat(sellAmountToken))}
              disabled={sellMutation.isPending || data.isCompleted} // 出售按钮
            >
              Sell {sellMutation.isPending && '...'}
            </Button>
          </div>
        </div>
        {data.isCompleted && (
          <p className="text-center font-bold text-green-500 p-2 bg-green-500/10 rounded-md">Trading Migrated to DEX</p> // 显示已迁移到 DEX 的提示
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-3">
        {/* Migration Progress Section */}
        {!data.isCompleted && (
          <div className="w-full">
            <label className="text-sm font-medium">Migration Progress</label>
            <Progress value={migrationProgress} className="w-full mt-1" /> {/* 显示迁移进度条 */}
            <p className="text-xs text-muted-foreground mt-1 text-center">
              {(currentSolReserves / LAMPORTS_PER_SOL).toFixed(2)} /{' '}
              {(migrationThreshold / LAMPORTS_PER_SOL).toFixed(2)} SOL to migrate {/* 显示迁移进度详情 */}
            </p>
          </div>
        )}

        {/* Creator Actions Section */}
        {isCreator && !data.isCompleted && (
          <div className="w-full border-t pt-3 flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-center">Creator Actions</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => claimFeesMutation.mutateAsync()}
              disabled={claimFeesMutation.isPending || feesToClaim === 0} // 提取费用按钮
            >
              Claim {feesToClaim.toFixed(4)} SOL Fees
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleMigrate}
              disabled={!canMigrate || migrateMutation.isPending || initializeDexPoolMutation.isPending} // 迁移到 DEX 按钮
            >
              {migrateMutation.isPending || initializeDexPoolMutation.isPending ? 'Migrating...' : 'Migrate to DEX'}
            </Button>
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
