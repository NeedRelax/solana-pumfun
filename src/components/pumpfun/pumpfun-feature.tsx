'use client'

import { useWallet } from '@solana/wallet-adapter-react' // 导入 Solana 钱包适配器钩子，用于管理钱包连接
import { WalletButton } from '../solana/solana-provider' // 导入钱包连接按钮组件
import { ExplorerLink } from '../cluster/cluster-ui' // 导入区块链浏览器链接组件
import { usePumpfunProgram } from './pumpfun-data-access' // 导入自定义钩子，用于访问 Pumpfun 程序数据
import { PumpfunCreate, PumpfunList } from './pumpfun-ui' // 导入 Pumpfun 创建和列表 UI 组件
import { AppHero, AppHeroProps } from '../app-hero' // 导入应用标题和副标题组件及其类型
import { ellipsify } from '@/lib/utils' // 导入工具函数，用于截断字符串显示
import { Button } from '@/components/ui/button' // 导入通用按钮组件

export default function PumpfunFeature() {
  const { publicKey } = useWallet() // 从钱包钩子中解构获取用户公钥
  // 从 usePumpfunProgram 钩子中获取程序 ID、协议配置、加载状态和初始化配置的 mutation
  const { programId, protocolConfig, isConfigLoading, initializeConfigMutation } = usePumpfunProgram()

  // 定义主要内容，当程序已初始化时渲染
  const mainContent = (
    <div>
      <AppHero
        title="Pumpfun Clone" // 设置标题为 "Pumpfun Clone"
        subtitle={
          'Create a new token by filling out the form below. Once created, anyone can buy or sell the token through its bonding curve. Liquidity is automatically managed.'
          // 设置副标题，描述创建代币的功能和流动性管理
        }
      >
        <p className="mb-6">
          Program ID: <ExplorerLink path={`account/${programId}`} label={ellipsify(programId.toString())} />
        </p>
        <PumpfunCreate isLoading={isConfigLoading} />
      </AppHero>
      <PumpfunList />
    </div>
  )

  // 定义未初始化时的视图，提示用户初始化程序
  const initializeView = (
    <div className="text-center">
      <h2 className="text-2xl font-semibold mb-4">Program Not Initialized</h2>
      <p className="mb-6 text-muted-foreground">
        The global configuration for the Pumpfun program has not been created on this cluster yet.
        <br />
        Click the button below to initialize it.
      </p>
      <Button onClick={() => initializeConfigMutation.mutateAsync()} disabled={initializeConfigMutation.isPending}>
        {initializeConfigMutation.isPending ? 'Initializing...' : 'Initialize Program'}
      </Button>
    </div>
  )

  // 定义加载中的视图，显示加载动画和提示
  const loadingView = (
    <div className="w-full text-center py-12">
      <span className="loading loading-spinner loading-lg"></span>
      <p className="mt-4">Checking for program configuration...</p>
    </div>
  )

  // 定义渲染内容的逻辑，根据状态选择合适的视图
  const renderContent = () => {
    if (isConfigLoading) {
      return loadingView // 如果正在加载，显示加载视图
    }
    // 如果加载完成且没有配置数据，显示初始化视图
    if (!protocolConfig.data && !isConfigLoading) {
      return initializeView
    }
    // 否则，显示主要应用内容
    return mainContent
  }

  return publicKey ? (
    <div>{renderContent()}</div> // 如果用户已连接钱包，渲染根据状态选择的内容
  ) : (
    <div className="max-w-4xl mx-auto">
      <div className="hero py-[64px]">
        <div className="hero-content text-center">
          <WalletButton />
        </div>
      </div>
    </div>
  )
}
