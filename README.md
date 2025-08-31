# Solana "Pump.fun" 风格的代币发行与交易平台 (全栈实现)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Powered by Anchor](https://img.shields.io/badge/Powered%20by-Anchor-blue.svg)](https://www.anchor-lang.com/) [![Token Standard: Token-2022](https://img.shields.io/badge/Token%20Standard-Token--2022-brightgreen.svg)](https://spl.solana.com/token-2022)

这是一个基于 Solana 和 Anchor 框架构建的全栈 dApp，实现了一个类似 "Pump.fun"
的新颖代币发行和早期交易模型。该平台旨在极大简化新代币的创建和初始流动性引导过程。用户只需支付少量 SOL 即可发行自己的代币，并通过一个自动化的
**联合曲线 (Bonding Curve)** 进行即时交易。当代币的流动性达到预设阈值后，协议会自动将其迁移到一个标准的 AMM DEX 池中。

## ✨ 核心功能

- **一键发币**: 用户无需复杂的配置，只需提供代币名称和符号，即可快速创建一种新的 SPL Token (Token-2022 标准)。
- **联合曲线交易**:
    - 新创建的代币通过一个遵循 `x * y = k` 公式的联合曲线进行自动定价和交易。
    - 所有交易直接在链上完成，无需等待做市商或订单簿。
- **自动流动性迁移**:
    - 当联合曲线中的 SOL 储备达到一个可配置的**迁移阈值**时，协议会自动将所有积累的 SOL 和代币注入到一个新的 DEX 池中。
    - 迁移过程是原子性的，确保了资金安全和无缝过渡。
- **创作者激励**:
    - 协议从每笔交易中收取少量费用，一部分进入国库，另一部分归代币的**创作者**所有。
    - 创作者可以随时提取其累积的费用收入。
- **去中心化治理**:
    - 协议的核心参数（如创建费、交易费率、迁移阈值）由一个**治理权限**控制，可通过链上交易进行更新。
- **现代化的前端体验**:
    - 提供一个直观的界面，用于创建、发现和交易所有通过该协议发行的代幣。
    - 实时显示代币价格、市值和迁移进度。
    - 集成钱包，为用户提供流畅的交易体验。

## 🛠️ 技术栈

- **智能合约**: Rust, **Anchor Framework v0.29+**
- **核心模型**: **联合曲线 (Bonding Curve)**, AMM
- **区块链**: Solana
- **代币标准**: **Token-2022**
- **前端框架**: **React**, **Next.js**
- **UI**: Shadcn/UI, Tailwind CSS, Radix UI Icons
- **异步状态管理**: **TanStack Query (React Query)**
- **钱包集成**: Solana Wallet Adapter
- **测试**: TypeScript, Mocha, Chai, Anchor Tests

## 📂 项目结构

```
.
├── anchor/                  # Anchor 项目
│   ├── programs/pumpfun/    # Pumpfun 智能合约源码 (lib.rs)
│   └── tests/pumpfun.ts     # 集成测试脚本
├── app/                     # Next.js 前端应用
│   ├── components/pumpfun/
│   │   ├── pumpfun-data-access.ts  # 核心数据访问层 (React Hooks)
│   │   └── pumpfun-ui.tsx          # 所有 UI 组件
│   └── app/pumpfun/page.tsx        # 功能主页/容器组件
├── package.json
└── README.md
```

## 🚀 快速开始

### 先决条件

- [Node.js v18 或更高版本](https://nodejs.org/en/)
- [Rust 工具链](https://www.rust-lang.org/tools/install)
- [Solana CLI v1.17 或更高版本](https://docs.solana.com/cli/install)
- [Anchor CLI v0.29 或更高版本](https://www.anchor-lang.com/docs/installation)

### 1. 部署智能合约

1. **启动本地验证器**:
   ```bash
   solana-test-validator
   ```
2. **构建并部署合约**: 在项目根目录下，打开另一个终端窗口运行：
   ```bash
   anchor build && anchor deploy
   ```
3. **记录程序 ID**: 部署成功后，复制输出的程序 ID。

### 2. 运行前端应用

1. **更新配置**: 将上一步获取的程序 ID 更新到前端代码中。
2. **安装依赖**:
   ```bash
   npm install
   ```
3. **启动开发服务器**:
   ```bash
   npm run dev
   ```
4. 在浏览器中打开 `http://localhost:3000` 即可访问 dApp。

## 🕹️ 如何使用

1. **连接钱包**: 访问应用主页，连接您的 Phantom 或其他兼容钱包。
2. **（首次）初始化协议**: 如果协议在当前网络上尚未初始化，治理员（通常是部署者）需要点击 "Initialize Program" 按钮来创建全局配置。
3. **创建代币**:
    - 在 "Create New Token" 表单中，输入您想要的代币名称和符号。
    - 点击 "Create Token" 并批准交易。您的代币将立即出现在下方的列表中。
4. **交易代币**:
    - 在任何代币卡片上，输入您希望购买或出售的数量。
    - 前端会实时预估交易价格。
    - 点击 "Buy" 或 "Sell" 并批准交易。
5. **（创作者）提取费用**: 如果您是某个代币的创作者，您可以在该代币的卡片上看到 "Creator Actions" 部分，点击按钮即可提取您累积的费用。
6. **迁移到 DEX**:
    - 随着代币被不断交易，其 SOL 储备会增加。迁移进度条会实时显示当前进度。
    - 当进度达到 100% 时，创作者可以点击 "Migrate to DEX" 按钮，将所有流动性永久性地迁移到一个新的 DEX 池中。

## ✅ 运行测试

我们提供了全面的集成测试，覆盖了从协议初始化、代币创建、交易到迁移的全过程。

```bash
anchor test
```

## 📜 智能合约深度解析

智能合约 (`programs/pumpfun/src/lib.rs`) 是整个系统的核心。

- **`BondingCurve` 账户**: 这是协议的创新之处。每个代币都有一个 `BondingCurve` PDA，它同时扮演多个角色：
    - **AMM 引擎**: 使用**虚拟储备** (`virtual_sol_reserves`, `virtual_token_reserves`) 和 `x * y = k` 公式来确定价格。
    - **SOL 金库**: 用户购买代币的 SOL 直接存入该账户的 lamports 余额中。
    - **状态机**: 包含 `is_completed` 标志，用于控制代币是否已迁移。
    - **权限中心**: 作为其代币 `Mint` 和 `Vault` 的权限，可以自动化地执行代币转账。
- **`ProtocolConfig` 账户**: 一个全局单例 PDA，用于存储整个协议的配置，实现了协议的可治理性。
- **`DexPool` 账户**: 作为流动性迁移的目标，定义了一个标准的 AMM 池结构。
- **原子化迁移 (`complete_and_migrate`)**: 迁移过程被设计成一个单一的原子指令。该指令负责将 `BondingCurve`
  标记为完成、将所有资金（SOL 和代币）转移到新的 DEX 金库、关闭旧的代币金库以回收租金，并发出事件。这确保了迁移过程的安全和一致性。
- **客户-服务器支付模型**: 在 `buy` 指令中，合约本身不处理从用户钱包扣款的逻辑。相反，它要求**客户端**（前端或测试脚本）在交易中包含一个
  `SystemProgram.transfer` **预指令 (preInstruction)** 来完成支付。这是一种将支付与业务逻辑分离的常见且高效的 Solana
  开发模式。

## 🖥️ 前端架构深度解析

前端应用 (`app/`) 采用了分层架构，确保了代码的模块化和可维护性。

- **数据访问层 (`pumpfun-data-access.ts`)**:
    - **分层 Hooks**:
        - `usePumpfunProgram`: 管理全局状态（如协议配置）和顶层操作（如创建代币）。
        - `useBondingCurve`: 负责**单个**代币（Bonding Curve）的所有数据查询和交互逻辑。
        - `useUserTokenBalance`: 一个可复用的原子化 Hook，用于查询任意代币的余额。
    - **智能状态管理**: 深度整合 **`TanStack Query`**，自动处理链上数据的获取、缓存和刷新。

- **UI 组件层 (`pumpfun-ui.tsx`)**:
    - **`PumpfunCard`**: 这是应用的核心 UI 组件，用于展示和操作单个代币。
        - **客户端价格预估**: 组件内部复刻了智能合约中的价格计算公式 (`getBuyPrice`, `getSellPrice`)，可以在用户输入时*
          *实时预估**交易结果，提供了卓越的交互体验。
        - **上下文感知 UI**: 界面根据用户身份（是否为创作者）和代币状态（是否已迁移、是否达到迁移阈值）动态显示不同的信息和操作按钮。
    - **清晰的用户引导**: 整个应用的用户流程非常清晰。如果协议未初始化，会首先引导治理员进行初始化。然后用户可以创建或交易代币，并能通过进度条直观地看到每个代币的生命周期进程。

## 📄 许可证

本项目采用 [MIT 许可证](https://opensource.org/licenses/MIT)。