use anchor_lang::{
    // 导入Anchor框架的核心模块，用于Solana程序开发
    prelude::*, // 导入Anchor的预导入项，包括常用类型和宏
    solana_program::{
        // 导入Solana程序运行时的核心模块
        // 新增导入 Rent 和 system_program  // 注释已存在：新增导入Rent（租金计算）和system_program（系统程序）
        clock::Clock,                            // 导入时钟模块，用于获取当前时间戳
        instruction::Instruction,                // 导入指令模块，用于构建程序指令
        program::invoke,                         // 导入invoke函数，用于调用其他程序
        program::invoke_signed,                  // 导入invoke_signed函数，用于以签名方式调用程序
        rent::Rent,                              // 导入Rent，用于计算账户最小租金余额
        system_program as anchor_system_program, // 别名为anchor_system_program，用于系统程序操作
    },
    system_program, // 导入系统程序，用于账户创建和转移
};
use anchor_spl::{
    // 导入Anchor的SPL（Solana Program Library）集成模块
    associated_token::{create as create_ata, AssociatedToken}, // 导入关联代币账户创建函数和程序
    token_2022::{
        // 导入Token-2022扩展标准
        spl_token_2022::extension::Length,
        transfer_checked,
        Burn,
        Transfer,
        TransferChecked, // 导入扩展、转账、销毁等功能
    },
    token_interface::{
        // 导入通用代币接口
        self,
        spl_pod::optional_keys::OptionalNonZeroPubkey,
        spl_token_2022, // 导入自身、可选Pubkey和Token-2022
        spl_token_metadata_interface,
        Mint,
        MintTo,
        SetAuthority,
        TokenAccount,
        TokenInterface, // 导入元数据接口、铸币、设置权限等
    },
};
use borsh::BorshSerialize; // 导入Borsh序列化，用于数据序列化
use spl_token_2022::instruction::AuthorityType; // 导入Token-2022的权限类型
use spl_token_2022::{
    // 导入Token-2022扩展
    extension::{ExtensionType, StateWithExtensions}, // 导入扩展类型和状态
    state::Mint as SplMint,                          // 导入铸币状态
};
use spl_token_metadata_interface::{
    // 导入Token元数据接口
    instruction::initialize as initialize_metadata,
    state::TokenMetadata, // 导入初始化函数和元数据状态
};
use std::convert::TryFrom; // 导入TryFrom，用于类型转换
use std::mem::size_of; // 导入size_of，用于计算结构体大小

declare_id!("E61ngnb26CrW5CHtx2gAWzKhnJ5o6TMDVFoNS9Lhr62g"); // 声明程序ID，用于标识这个Solana程序

const TOTAL_SUPPLY: u64 = 1_000_000_000 * 10_u64.pow(6); // 定义总供应量：10亿代币，精度为6位小数
const MINT_DECIMALS: u8 = 6; // 定义铸币小数位数：6位
const MIN_SOL_TRADE_AMOUNT: u64 = 1_000_000; // 定义最小SOL交易金额：0.001 SOL（以lamports计）
const LIQUIDITY_TOKEN_PERCENT: u64 = 90; // 定义流动性代币百分比：90%

mod math {
    // 定义数学模块，用于费用计算
    pub fn calculate_fees(
        // 函数：计算费用
        amount: u128,                    // 输入金额
        total_bps: u64,                  // 总基点（bps）
        creator_share_of_total_bps: u64, // 创作者在总bps中的份额
    ) -> (u128, u128) {
        // 返回：(创作者费用, 国库费用)
        if total_bps == 0 || amount == 0 {
            // 如果bps为0或金额为0，返回0
            return (0, 0);
        }
        let total_fee = amount // 计算总费用：金额 * bps / 10000
            .checked_mul(total_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap();
        if total_fee == 0 || total_bps == 0 {
            // 如果总费用为0，返回(0, total_fee)
            return (0, total_fee);
        }
        let creator_fee = total_fee // 计算创作者费用：总费用 * 份额 / 总bps
            .checked_mul(creator_share_of_total_bps as u128)
            .unwrap()
            .checked_div(total_bps as u128)
            .unwrap();
        let treasury_fee = total_fee.checked_sub(creator_fee).unwrap(); // 计算国库费用：总费用 - 创作者费用
        (creator_fee, treasury_fee) // 返回费用对
    }
}

#[program] // Anchor宏：定义Solana程序模块
pub mod pumpfun {
    // 程序模块名：pumpfun
    use super::*; // 导入上级作用域的所有项

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        // 函数：初始化配置
        let config = &mut ctx.accounts.protocol_config; // 获取可变配置账户
        config.governance_authority = ctx.accounts.authority.key(); // 设置治理权限
        config.treasury = ctx.accounts.treasury.key(); // 设置国库地址
        config.creation_fee_sol = 1 * 10_u64.pow(9); // 设置创建费用：1 SOL
        config.total_trade_fee_bps = 30; // 设置总交易费用bps：30
        config.creator_fee_bps_share = 10; // 设置创作者费用份额：10
        config.migration_threshold_sol = 50 * 10_u64.pow(9); // 设置迁移阈值：50 SOL
        config.is_paused = false; // 设置暂停状态：false
        config.bump = ctx.bumps.protocol_config; // 设置bump种子
        emit!(ConfigInitialized {
            // 发出事件：配置初始化
            governance: config.governance_authority,
            treasury: config.treasury
        });
        Ok(()) // 返回成功
    }

    pub fn update_config(ctx: Context<UpdateConfig>, new_config: ProtocolConfigV1) -> Result<()> {
        // 函数：更新配置
        let config = &mut ctx.accounts.protocol_config; // 获取可变配置账户
        config.set_inner(new_config.into()); // 更新配置内部数据
        config.bump = ctx.bumps.protocol_config; // 更新bump
        emit!(ConfigUpdated {
            // 发出事件：配置更新
            new_governance: config.governance_authority,
            new_treasury: config.treasury
        });
        Ok(()) // 返回成功
    }

    pub fn create(ctx: Context<Create>, name: String, symbol: String) -> Result<()> {
        // 函数：创建代币
        let config = &ctx.accounts.protocol_config; // 获取配置
        let curve = &mut ctx.accounts.bonding_curve; // 获取可变绑定曲线账户
        curve.creator = ctx.accounts.creator.key(); // 设置创作者
        curve.token_mint = ctx.accounts.token_mint.key(); // 设置代币铸币地址
        curve.token_vault = ctx.accounts.token_vault.key(); // 设置代币金库
        curve.virtual_sol_reserves = 1 * 10_u64.pow(9); // 设置虚拟SOL储备：1 SOL
        curve.virtual_token_reserves = 100_000 * 10_u64.pow(6); // 设置虚拟代币储备：100,000 代币
        curve.real_sol_reserves = 0; // 设置真实SOL储备：0
        curve.is_completed = false; // 设置完成状态：false
        curve.dex_pool = Pubkey::default(); // 设置DEX池：默认
        curve.creator_fees_owed = 0; // 设置欠创作者费用：0
        curve.bump = ctx.bumps.bonding_curve; // 设置bump
        system_program::transfer(
            // 转移创建费用到国库
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            config.creation_fee_sol,
        )?;
        token_interface::set_authority(
            // 设置铸币权限给曲线账户
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                SetAuthority {
                    current_authority: ctx.accounts.creator.to_account_info(),
                    account_or_mint: ctx.accounts.token_mint.to_account_info(),
                },
            ),
            AuthorityType::MintTokens,
            Some(curve.key()),
        )?;
        let token_mint_key = ctx.accounts.token_mint.key(); // 获取铸币key
        let curve_signer_seeds = &[b"bonding_curve", token_mint_key.as_ref(), &[curve.bump]]; // 准备签名种子
        token_interface::mint_to(
            // 铸币到金库
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: curve.to_account_info(),
                },
                &[&curve_signer_seeds[..]],
            ),
            TOTAL_SUPPLY,
        )?;
        emit!(TokenCreated {
            // 发出事件：代币创建
            mint: ctx.accounts.token_mint.key(),
            creator: ctx.accounts.creator.key(),
            bonding_curve: curve.key(),
            name,
            symbol
        });
        Ok(()) // 返回成功
    }

    pub fn buy(
        // 函数：购买代币
        ctx: Context<Buy>,
        total_sol_in: u64,
        min_tokens_out: u64,
        deadline: i64,
    ) -> Result<()> {
        // 1. 现在这个检查可以正常工作了，因为 Anchor 不会再因为 token_vault 而提前失败。  // 注释已存在：检查曲线未完成
        let curve = &mut ctx.accounts.bonding_curve;
        require!(!curve.is_completed, PumpError::CurveCompleted);

        // 2. 对于正常的交易路径，我们必须手动补上 `has_one` 的安全检查。  // 注释已存在：手动检查金库key
        require_keys_eq!(
            curve.token_vault,
            ctx.accounts.token_vault.key(),
            PumpError::InvalidMetadataLength // 复用一个错误码，或创建一个新的如 `InvalidTokenVault`
        );

        // 3. 原始的业务逻辑保持不变。  // 注释已存在：原始逻辑
        let token_amount_out;
        {
            let clock = Clock::get()?; // 获取当前时钟
            require!(
                // 检查截止时间
                clock.unix_timestamp <= deadline,
                PumpError::DeadlineExceeded
            );
            let config = &ctx.accounts.protocol_config; // 获取配置
            require!(!config.is_paused, PumpError::ProtocolPaused); // 检查协议未暂停
            require!(
                // 检查交易金额不小于最小
                total_sol_in >= MIN_SOL_TRADE_AMOUNT,
                PumpError::TradeAmountTooSmall
            );

            let (creator_fee, treasury_fee) = math::calculate_fees(
                // 计算费用
                total_sol_in as u128,
                config.total_trade_fee_bps,
                config.creator_fee_bps_share,
            );
            let amount_for_curve = total_sol_in // 计算曲线金额：总输入 - 费用
                .checked_sub(treasury_fee as u64)
                .unwrap()
                .checked_sub(creator_fee as u64)
                .unwrap();

            let calculated_tokens_out = curve.get_buy_output(amount_for_curve); // 计算输出代币
            require!(
                // 检查滑点
                calculated_tokens_out >= min_tokens_out,
                PumpError::SlippageLimitExceeded
            );

            curve.creator_fees_owed = curve // 更新欠创作者费用
                .creator_fees_owed
                .checked_add(creator_fee as u64)
                .unwrap();
            curve.update_buy_state(amount_for_curve, calculated_tokens_out); // 更新曲线状态
            token_amount_out = calculated_tokens_out; // 设置输出金额
        }

        let token_mint_key = ctx.accounts.token_mint.key(); // 获取铸币key
        let curve_bump = ctx.accounts.bonding_curve.bump; // 获取bump
        let curve_signer_seeds = &[b"bonding_curve", token_mint_key.as_ref(), &[curve_bump]]; // 准备签名种子
        let signer = &[&curve_signer_seeds[..]]; // 签名者

        token_interface::transfer_checked(
            // 转账代币给买家
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.token_vault.to_account_info(), // 使用 .to_account_info()
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer,
            ),
            token_amount_out,
            MINT_DECIMALS,
        )?;

        emit!(BuyEvent {
            // 发出事件：购买事件
            mint: ctx.accounts.token_mint.key(),
            buyer: ctx.accounts.buyer.key(),
            sol_in: total_sol_in,
            tokens_out: token_amount_out
        });

        Ok(()) // 返回成功
    }

    pub fn sell(
        // 函数：出售代币
        ctx: Context<Sell>,
        token_amount: u64,
        min_sol_out: u64,
        deadline: i64,
    ) -> Result<()> {
        let sol_amount_out_net; // 声明净输出SOL
        let treasury_fee; // 声明国库费用
        {
            let curve = &mut ctx.accounts.bonding_curve; // 获取可变曲线
            let clock = Clock::get()?; // 获取时钟
            require!(
                // 检查截止时间
                clock.unix_timestamp <= deadline,
                PumpError::DeadlineExceeded
            );
            let config = &ctx.accounts.protocol_config; // 获取配置
            require!(!config.is_paused, PumpError::ProtocolPaused); // 检查未暂停
            require!(!curve.is_completed, PumpError::CurveCompleted); // 检查曲线未完成
            let sol_amount_out_gross = curve.get_sell_output(token_amount); // 计算总输出SOL
            require!(
                // 检查金额有效
                token_amount > 0 && sol_amount_out_gross >= MIN_SOL_TRADE_AMOUNT,
                PumpError::TradeAmountTooSmall
            );
            require!(
                // 检查储备足够
                curve.real_sol_reserves >= sol_amount_out_gross,
                PumpError::InsufficientSolReserves
            );
            let (creator_fee, treasury_fee_calc) = math::calculate_fees(
                // 计算费用
                sol_amount_out_gross as u128,
                config.total_trade_fee_bps,
                config.creator_fee_bps_share,
            );
            let calculated_sol_out_net =
                sol_amount_out_gross // 计算净输出：总输出 - 费用
                    .checked_sub((creator_fee + treasury_fee_calc) as u64)
                    .unwrap();
            require!(
                // 检查滑点
                calculated_sol_out_net >= min_sol_out,
                PumpError::SlippageLimitExceeded
            );
            curve.creator_fees_owed = curve // 更新欠费用
                .creator_fees_owed
                .checked_add(creator_fee as u64)
                .unwrap();
            curve.update_sell_state(token_amount, sol_amount_out_gross); // 更新曲线状态
            sol_amount_out_net = calculated_sol_out_net; // 设置净输出
            treasury_fee = treasury_fee_calc; // 设置国库费用
        }
        token_interface::transfer_checked(
            // 转账代币到金库
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            token_amount,
            MINT_DECIMALS,
        )?;
        let curve_account_info = ctx.accounts.bonding_curve.to_account_info(); // 获取曲线账户信息
        let total_sol_to_transfer = sol_amount_out_net.checked_add(treasury_fee as u64).unwrap(); // 计算总转移SOL
        if **curve_account_info.lamports.borrow() < total_sol_to_transfer {
            // 检查余额足够
            return err!(PumpError::InsufficientSolReserves);
        }
        let seller_account_info = ctx.accounts.seller.to_account_info(); // 获取卖家账户
        **curve_account_info.try_borrow_mut_lamports()? -= sol_amount_out_net; // 从曲线扣除净输出
        **seller_account_info.try_borrow_mut_lamports()? += sol_amount_out_net; // 转移到卖家
        if treasury_fee > 0 {
            // 如果有国库费用
            let treasury_account_info = ctx.accounts.treasury.to_account_info(); // 获取国库
            **curve_account_info.try_borrow_mut_lamports()? -= treasury_fee as u64; // 从曲线扣除
            **treasury_account_info.try_borrow_mut_lamports()? += treasury_fee as u64;
            // 转移到国库
        }
        emit!(SellEvent {
            // 发出事件：出售事件
            mint: ctx.accounts.bonding_curve.token_mint,
            seller: ctx.accounts.seller.key(),
            tokens_in: token_amount,
            sol_out: sol_amount_out_net
        });
        Ok(()) // 返回成功
    }

    pub fn claim_creator_fees(ctx: Context<ClaimCreatorFees>) -> Result<()> {
        // 函数：领取创作者费用
        let curve = &mut ctx.accounts.bonding_curve; // 获取可变曲线
        let fees_to_claim = curve.creator_fees_owed; // 获取欠费用
        require!(fees_to_claim > 0, PumpError::NoFeesToClaim); // 检查有费用可领
        let rent = Rent::get()?; // 获取租金计算
        let min_balance = rent.minimum_balance(curve.to_account_info().data_len()); // 计算最小余额
        let available_sol_for_fees = curve // 计算可用SOL：总lamports - 最小租金 - 真实储备
            .to_account_info()
            .lamports()
            .saturating_sub(min_balance)
            .saturating_sub(curve.real_sol_reserves);
        require!(
            // 检查可用足够
            available_sol_for_fees >= fees_to_claim,
            PumpError::InsufficientFeeReserves
        );
        curve.creator_fees_owed = 0; // 清零欠费用
        let curve_account_info = curve.to_account_info(); // 获取曲线信息
        let creator_account_info = ctx.accounts.creator.to_account_info(); // 获取创作者信息
        if **curve_account_info.lamports.borrow() < fees_to_claim {
            // 再次检查余额
            return err!(PumpError::InsufficientFeeReserves);
        }
        **curve_account_info.try_borrow_mut_lamports()? -= fees_to_claim; // 扣除费用
        **creator_account_info.try_borrow_mut_lamports()? += fees_to_claim; // 转移到创作者
        emit!(CreatorFeeClaimed {
            // 发出事件：费用领取
            mint: curve.token_mint,
            creator: curve.creator,
            amount: fees_to_claim
        });
        Ok(()) // 返回成功
    }

    pub fn complete_and_migrate(ctx: Context<CompleteAndMigrate>) -> Result<()> {
        // 函数：完成并迁移到DEX
        // Phase 1: 获取所需的值  // 阶段1：获取值
        let curve = &ctx.accounts.bonding_curve;
        let token_mint_key = curve.token_mint;
        let curve_bump = curve.bump;
        let sol_to_deposit = curve.real_sol_reserves;
        let tokens_to_deposit = ctx.accounts.token_vault.amount;

        // Phase 2: 更新 DexPool 的状态  // 阶段2：更新DEX池
        let dex_pool = &mut ctx.accounts.dex_pool;
        dex_pool.token_mint = token_mint_key;
        dex_pool.sol_reserves = sol_to_deposit;
        dex_pool.token_reserves = tokens_to_deposit;
        dex_pool.token_vault = ctx.accounts.dex_token_vault.key();
        dex_pool.sol_vault = ctx.accounts.dex_sol_vault.key();

        // Phase 3: 准备 PDA 签名  // 阶段3：准备签名
        let curve_signer_seeds = &[
            b"bonding_curve".as_ref(),
            token_mint_key.as_ref(),
            &[curve_bump],
        ];
        let curve_signer = &[&curve_signer_seeds[..]];

        // Phase 4: 转移 Token 并手动关闭 token_vault  // 阶段4：转移并关闭金库
        if tokens_to_deposit > 0 {
            token_interface::transfer_checked(
                // 转移代币到DEX金库
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.token_vault.to_account_info(),
                        mint: ctx.accounts.token_mint.to_account_info(),
                        to: ctx.accounts.dex_token_vault.to_account_info(),
                        authority: ctx.accounts.bonding_curve.to_account_info(),
                    },
                    curve_signer,
                ),
                tokens_to_deposit,
                MINT_DECIMALS,
            )?;
        }

        token_interface::close_account(CpiContext::new_with_signer(
            // 关闭金库账户
            ctx.accounts.token_program.to_account_info(),
            token_interface::CloseAccount {
                account: ctx.accounts.token_vault.to_account_info(),
                destination: ctx.accounts.creator.to_account_info(),
                authority: ctx.accounts.bonding_curve.to_account_info(),
            },
            curve_signer,
        ))?;

        // Phase 5: 铸造和销毁 LP token  // 阶段5：铸造并销毁LP代币
        let lp_amount_to_mint = 1_000_000_000;
        let dex_pool_signer_seeds = &[
            b"dex_pool".as_ref(),
            token_mint_key.as_ref(),
            &[dex_pool.bump],
        ];
        let dex_signer = &[&dex_pool_signer_seeds[..]];

        token_interface::mint_to(
            // 铸造LP代币
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    to: ctx.accounts.lp_vault.to_account_info(),
                    authority: dex_pool.to_account_info(),
                },
                dex_signer,
            ),
            lp_amount_to_mint,
        )?;

        token_interface::burn(
            // 销毁LP代币
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.lp_mint.to_account_info(),
                    from: ctx.accounts.lp_vault.to_account_info(),
                    authority: dex_pool.to_account_info(),
                },
                dex_signer,
            ),
            lp_amount_to_mint,
        )?;

        emit!(DexMigrated {
            // 发出事件：DEX迁移
            mint: token_mint_key,
            dex_pool: dex_pool.key(),
            sol_reserves: dex_pool.sol_reserves,
            token_reserves: dex_pool.token_reserves
        });

        // ==================== 最终的、根本性的修复 ====================  // 修复：标记完成并转移多余SOL
        // 1. 先将 bonding_curve 帐户标记为已完成
        let curve = &mut ctx.accounts.bonding_curve;
        curve.is_completed = true;

        // 2. 计算并转移多余的 SOL，同时保留足够的租金以维持帐户存在
        let rent = Rent::get()?;
        let curve_account_info = ctx.accounts.bonding_curve.to_account_info();
        let min_rent_for_curve = rent.minimum_balance(curve_account_info.data_len());

        let transferable_lamports = curve_account_info
            .lamports()
            .saturating_sub(min_rent_for_curve);

        if transferable_lamports > 0 {
            **curve_account_info.try_borrow_mut_lamports()? -= transferable_lamports; // 扣除可转移lamports
            **ctx
                .accounts
                .dex_sol_vault
                .to_account_info()
                .try_borrow_mut_lamports()? += transferable_lamports; // 转移到DEX SOL金库
        }
        // ==================== 修复结束 ====================

        Ok(()) // 返回成功
    }
    pub fn initialize_dex_pool(ctx: Context<InitializeDexPool>) -> Result<()> {
        // 函数：初始化DEX池
        // ===================== 最終的、真正的修復 =====================  // 修复：手动设置bump
        // Anchor 不會自動幫你把 bump 存到帳戶的數據裡，你必須手動做這件事。
        let dex_pool = &mut ctx.accounts.dex_pool;
        dex_pool.bump = ctx.bumps.dex_pool;
        // ===================== 修復結束 =================================

        // 1. 準備創建帳戶所需的 PDA 种子和签名  // 准备签名种子
        let token_mint_key = ctx.accounts.token_mint.key();

        let vault_bump = ctx.bumps.dex_sol_vault;
        let vault_signer_seeds: &[&[u8]] =
            &[b"dex_sol_vault", token_mint_key.as_ref(), &[vault_bump]];
        let signer = &[&vault_signer_seeds[..]];

        // 2. 通過 CPI 調用系統程序來創建帳戶  // 通过CPI创建SOL金库账户
        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.dex_sol_vault.to_account_info(),
                },
                signer,
            ),
            Rent::get()?.minimum_balance(0),
            0,
            ctx.program_id,
        )?;

        Ok(()) // 返回成功
    }
}

#[derive(Accounts)] // Anchor宏：定义账户结构
pub struct InitializeDexPool<'info> {
    // 结构：初始化DEX池账户
    #[account(mut)] // 可变
    pub payer: Signer<'info>, // 支付者签名者

    // 我们需要 token mint 来派生 PDA 的种子  // 注释已存在：用于派生种子
    pub token_mint: InterfaceAccount<'info, Mint>, // 代币铸币

    #[account(  // 初始化DEX池账户
        init,
        payer = payer,
        space = DexPool::LEN,
        seeds = [b"dex_pool", token_mint.key().as_ref()],
        bump
    )]
    pub dex_pool: Account<'info, DexPool>,

    // ===================== FIX START: MODIFY SOL VAULT DEFINITION =====================  // 修复开始：修改SOL金库定义
    // 移除 `init` 和 `space` 约束，因为我们将在指令逻辑中手动处理。
    // 保留 `seeds` 和 `bump`，这样 Anchor 依然可以为我们计算和验证 PDA 地址及 bump。
    // 将类型更改为 `UncheckedAccount`，因为它在指令开始时还不存在。
    #[account(
        mut,
        seeds = [b"dex_sol_vault", token_mint.key().as_ref()],
        bump
    )]
    /// CHECK: 这个账户将在指令逻辑中通过 CPI 被安全地创建。  // 检查：通过CPI安全创建
    pub dex_sol_vault: UncheckedAccount<'info>,
    // ===================== FIX END ====================================================
    #[account(  // 初始化LP铸币
        init,
        payer = payer,
        seeds = [b"lp_mint", token_mint.key().as_ref()],
        bump,
        mint::decimals = MINT_DECIMALS,
        mint::authority = dex_pool,
        mint::token_program = token_program
    )]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    #[account(  // 初始化DEX代币金库
        init,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = dex_pool,
        associated_token::token_program = token_program
    )]
    pub dex_token_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(  // 初始化LP金库
        init,
        payer = payer,
        associated_token::mint = lp_mint,
        associated_token::authority = dex_pool,
        associated_token::token_program = token_program
    )]
    pub lp_vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>, // 系统程序
    pub token_program: Interface<'info, TokenInterface>, // 代币程序
    pub associated_token_program: Program<'info, AssociatedToken>, // 关联代币程序
}

// STATE ACCOUNTS  // 状态账户
#[account] // Anchor宏：协议配置账户
pub struct ProtocolConfig {
    // 结构：协议配置
    pub governance_authority: Pubkey, // 治理权限
    pub treasury: Pubkey,             // 国库
    pub creation_fee_sol: u64,        // 创建费用
    pub total_trade_fee_bps: u64,     // 总交易费用bps
    pub creator_fee_bps_share: u64,   // 创作者份额
    pub migration_threshold_sol: u64, // 迁移阈值
    pub is_paused: bool,              // 暂停状态
    pub bump: u8,                     // bump种子
}
impl ProtocolConfig {
    // 实现：协议配置
    pub const LEN: usize = 8 + size_of::<Self>(); // 计算账户长度：8字节锚 + 结构体大小
}

#[account] // Anchor宏：绑定曲线账户
pub struct BondingCurve {
    // 结构：绑定曲线
    pub creator: Pubkey,             // 创作者
    pub token_mint: Pubkey,          // 代币铸币
    pub token_vault: Pubkey,         // 代币金库
    pub virtual_sol_reserves: u64,   // 虚拟SOL储备
    pub virtual_token_reserves: u64, // 虚拟代币储备
    pub real_sol_reserves: u64,      // 真实SOL储备
    pub is_completed: bool,          // 完成状态
    pub dex_pool: Pubkey,            // DEX池
    pub creator_fees_owed: u64,      // 欠创作者费用
    pub bump: u8,                    // bump
}
impl BondingCurve {
    // 实现：绑定曲线
    pub const LEN: usize = 8 + size_of::<Self>(); // 计算长度
    pub fn get_buy_output(&self, sol_in: u64) -> u64 {
        // 函数：计算购买输出
        let x = self.virtual_sol_reserves as u128; // x = 虚拟SOL
        let y = self.virtual_token_reserves as u128; // y = 虚拟代币
        let k = x.checked_mul(y).unwrap(); // k = x * y
        let new_x = x.checked_add(sol_in as u128).unwrap(); // 新x = x + 输入
        (y.checked_sub(k.checked_div(new_x).unwrap()).unwrap()) as u64 // 输出 = y - (k / 新x)
    }
    pub fn get_sell_output(&self, tokens_in: u64) -> u64 {
        // 函数：计算出售输出
        let x = self.virtual_sol_reserves as u128;
        let y = self.virtual_token_reserves as u128;
        if x == 0 || y == 0 {
            // 如果储备为0，返回0
            return 0;
        }
        let k = x.checked_mul(y).unwrap();
        let new_y = y.checked_add(tokens_in as u128).unwrap();
        if new_y == 0 {
            // 如果新y为0，返回x
            return x as u64;
        }
        let new_x = k
            .checked_add(new_y)
            .unwrap()
            .checked_sub(1)
            .unwrap()
            .checked_div(new_y)
            .unwrap();
        (x.saturating_sub(new_x)) as u64 // 输出 = x - 新x
    }
    pub fn update_buy_state(&mut self, sol_in: u64, tokens_out: u64) {
        // 函数：更新购买状态
        self.real_sol_reserves = self.real_sol_reserves.checked_add(sol_in).unwrap(); // 更新真实SOL
        self.virtual_sol_reserves = self.virtual_sol_reserves.checked_add(sol_in).unwrap(); // 更新虚拟SOL
        self.virtual_token_reserves = self.virtual_token_reserves.checked_sub(tokens_out).unwrap();
        // 更新虚拟代币
    }
    pub fn update_sell_state(&mut self, tokens_in: u64, sol_out: u64) {
        // 函数：更新出售状态
        self.real_sol_reserves = self.real_sol_reserves.checked_sub(sol_out).unwrap();
        self.virtual_sol_reserves = self.virtual_sol_reserves.checked_sub(sol_out).unwrap();
        self.virtual_token_reserves = self.virtual_token_reserves.checked_add(tokens_in).unwrap();
    }
}

#[account] // Anchor宏：DEX池账户
pub struct DexPool {
    // 结构：DEX池
    pub token_mint: Pubkey,  // 代币铸币
    pub token_vault: Pubkey, // 代币金库
    pub sol_vault: Pubkey,   // SOL金库
    pub sol_reserves: u64,   // SOL储备
    pub token_reserves: u64, // 代币储备
    pub bump: u8,            // bump
}
impl DexPool {
    // 实现：DEX池
    pub const LEN: usize = 8 + size_of::<Self>(); // 计算长度
}

// INSTRUCTION CONTEXTS  // 指令上下文
#[derive(Accounts)] // 初始化配置上下文
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>, // 权限签名者
    #[account(init, payer = authority, seeds = [b"protocol_config"], bump, space = ProtocolConfig::LEN)]
    pub protocol_config: Account<'info, ProtocolConfig>, // 配置账户
    #[account(mut)]
    pub treasury: SystemAccount<'info>, // 国库
    pub system_program: Program<'info, System>, // 系统程序
}

#[derive(Accounts)] // 更新配置上下文
#[instruction(new_config: ProtocolConfigV1)]
pub struct UpdateConfig<'info> {
    pub governance_authority: Signer<'info>, // 治理签名者
    #[account(mut, seeds = [b"protocol_config"], bump, has_one = governance_authority)]
    pub protocol_config: Account<'info, ProtocolConfig>, // 配置账户
}

#[derive(Accounts)] // 创建上下文
pub struct Create<'info> {
    #[account(mut)]
    pub creator: Signer<'info>, // 创作者
    #[account(seeds = [b"protocol_config"], bump = protocol_config.bump, has_one = treasury)]
    pub protocol_config: Account<'info, ProtocolConfig>, // 配置
    #[account(mut)]
    pub treasury: SystemAccount<'info>, // 国库
    #[account(
        init,
        payer = creator,
        mint::decimals = MINT_DECIMALS,
        mint::authority = creator,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>, // 铸币
    #[account(
        init,
        payer = creator,
        seeds = [b"bonding_curve", token_mint.key().as_ref()],
        bump,
        space = BondingCurve::LEN
    )]
    pub bonding_curve: Account<'info, BondingCurve>, // 曲线
    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = bonding_curve,
        associated_token::token_program = token_program
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>, // 金库
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)] // 购买上下文
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>, // 买家

    #[account(seeds = [b"protocol_config"], bump = protocol_config.bump, has_one = treasury)]
    pub protocol_config: Account<'info, ProtocolConfig>, // 配置

    #[account(mut)]
    pub treasury: SystemAccount<'info>, // 国库

    // 关键修复 1: 移除了 `has_one = token_vault` 约束。  // 修复1：移除约束
    // 我们将在函数逻辑中手动进行此检查。
    #[account(
        mut,
        seeds = [b"bonding_curve", token_mint.key().as_ref()],
        bump = bonding_curve.bump,
        has_one = token_mint
    )]
    pub bonding_curve: Account<'info, BondingCurve>, // 曲线

    #[account(mut)]
    pub token_mint: InterfaceAccount<'info, Mint>, // 铸币

    // 关键修复 2: 将类型更改为 `UncheckedAccount`。  // 修复2：更改为Unchecked
    // 这会阻止 Anchor 在函数执行前反序列化这个可能已被关闭的帐户。
    #[account(mut)]
    /// CHECK: We manually verify this account's address against the bonding curve's state.
    pub token_vault: UncheckedAccount<'info>, // 金库

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = token_mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program
    )]
    pub buyer_token_account: InterfaceAccount<'info, TokenAccount>, // 买家账户

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)] // 出售上下文
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>, // 卖家
    #[account(seeds = [b"protocol_config"], bump = protocol_config.bump, has_one = treasury)]
    pub protocol_config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    #[account(mut, seeds = [b"bonding_curve", token_mint.key().as_ref()], bump = bonding_curve.bump, has_one = token_mint, has_one = token_vault)]
    pub bonding_curve: Account<'info, BondingCurve>,
    #[account(mut)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint = token_mint, associated_token::authority = seller, associated_token::token_program = token_program)]
    pub seller_token_account: InterfaceAccount<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)] // 领取费用上下文
pub struct ClaimCreatorFees<'info> {
    #[account(mut, address = bonding_curve.creator)]
    pub creator: Signer<'info>, // 创作者
    #[account(mut, seeds = [b"bonding_curve", bonding_curve.token_mint.as_ref()], bump = bonding_curve.bump)]
    pub bonding_curve: Account<'info, BondingCurve>, // 曲线
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)] // 完成迁移上下文
pub struct CompleteAndMigrate<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(seeds = [b"protocol_config"], bump = protocol_config.bump)]
    pub protocol_config: Account<'info, ProtocolConfig>,

    // 关键：确保 bonding_curve 上没有 `close` 约束  // 关键：无close约束
    #[account(
        mut,
        seeds = [b"bonding_curve", token_mint.key().as_ref()],
        bump,
        has_one = creator
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(address = bonding_curve.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        address = bonding_curve.token_vault
    )]
    pub token_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds = [b"dex_pool", token_mint.key().as_ref()], bump)]
    pub dex_pool: Account<'info, DexPool>,

    #[account(mut, seeds = [b"dex_sol_vault", token_mint.key().as_ref()], bump)]
    /// CHECK: PDA's correctness is guaranteed by seeds.
    pub dex_sol_vault: UncheckedAccount<'info>,

    #[account(mut)]
    pub dex_token_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, seeds=[b"lp_mint", token_mint.key().as_ref()], bump)]
    pub lp_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub lp_vault: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)] // 配置V1结构
pub struct ProtocolConfigV1 {
    pub governance_authority: Pubkey,
    pub treasury: Pubkey,
    pub creation_fee_sol: u64,
    pub total_trade_fee_bps: u64,
    pub creator_fee_bps_share: u64,
    pub migration_threshold_sol: u64,
    pub is_paused: bool,
}
impl From<ProtocolConfigV1> for ProtocolConfig {
    // 从V1转换到配置
    fn from(v1: ProtocolConfigV1) -> Self {
        Self {
            governance_authority: v1.governance_authority,
            treasury: v1.treasury,
            creation_fee_sol: v1.creation_fee_sol,
            total_trade_fee_bps: v1.total_trade_fee_bps,
            creator_fee_bps_share: v1.creator_fee_bps_share,
            migration_threshold_sol: v1.migration_threshold_sol,
            is_paused: v1.is_paused,
            bump: 0,
        }
    }
}

#[event] // 事件：配置初始化
pub struct ConfigInitialized {
    pub governance: Pubkey,
    pub treasury: Pubkey,
}
#[event] // 事件：配置更新
pub struct ConfigUpdated {
    pub new_governance: Pubkey,
    pub new_treasury: Pubkey,
}
#[event] // 事件：代币创建
pub struct TokenCreated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub bonding_curve: Pubkey,
    pub name: String,
    pub symbol: String,
}
#[event] // 事件：购买
pub struct BuyEvent {
    pub mint: Pubkey,
    pub buyer: Pubkey,
    pub sol_in: u64,
    pub tokens_out: u64,
}
#[event] // 事件：出售
pub struct SellEvent {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub tokens_in: u64,
    pub sol_out: u64,
}
#[event] // 事件：费用领取
pub struct CreatorFeeClaimed {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}
#[event] // 事件：DEX迁移
pub struct DexMigrated {
    pub mint: Pubkey,
    pub dex_pool: Pubkey,
    pub sol_reserves: u64,
    pub token_reserves: u64,
}

#[error_code] // 错误码枚举
pub enum PumpError {
    #[msg("The bonding curve has been completed and trading is locked.")]
    CurveCompleted, // 曲线完成
    #[msg("Insufficient SOL reserves in the bonding curve for this trade.")]
    InsufficientSolReserves, // 储备不足
    #[msg("The calculated output amount is below the minimum amount specified.")]
    SlippageLimitExceeded, // 滑点超限
    #[msg("Metadata string length exceeds the maximum allowed.")]
    InvalidMetadataLength, // 元数据长度无效
    #[msg("There are no creator fees available to claim.")]
    NoFeesToClaim, // 无费用可领
    #[msg("The protocol is currently paused by the governance authority.")]
    ProtocolPaused, // 协议暂停
    #[msg("The transaction deadline has been exceeded.")]
    DeadlineExceeded, // 截止时间超
    #[msg("The transaction amount is too small.")]
    TradeAmountTooSmall, // 金额太小
    #[msg("Insufficient SOL in the contract to pay out creator fees.")]
    InsufficientFeeReserves, // 费用储备不足
    #[msg("The bonding curve has already been migrated to a DEX.")]
    AlreadyMigrated, // 已迁移
    #[msg("The SOL reserves have not met the threshold for DEX migration.")]
    MigrationThresholdNotMet, // 未达迁移阈值
}
