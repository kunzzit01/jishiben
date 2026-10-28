export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income';
  /** 所属大类名（仅支出分类用，如"餐饮购物"）；没有该字段的分类在选择页归入"其他"节 */
  group?: string;
}

/** 用户自定义的支出大类（在选择类别页底部"新增大分类"创建） */
export interface CategoryGroup {
  name: string;
  /** 主题色：组标题文字用这个颜色 */
  color?: string;
  icon?: string;
  type: 'expense' | 'income';
}

export interface Transaction {
  id: string;
  amount: number;
  categoryId: string;
  type: TransactionType;
  date: string;
  note: string;
  // 没有分类时用来当标题显示的名字（比如计划付款的"房租"）。
  // 跟 note 分开存，这样列表标题和备注不会挤成一句话、也不用互相判断该不该重复显示。
  displayName?: string;
  createdAt: number;
  ledgerId: string;
  assetId?: string;
  receiptUri?: string;
  fromAssetId?: string;
  toAssetId?: string;
  exchangeRate?: number;
  convertedAmount?: number;
  fee?: number;
  /** 手续费伴随行指回主转账的 id（转账编辑时用它精确找到并重建这条手续费） */
  feeForTxId?: string;
}

export interface Budget {
  categoryId: string;
  amount: number;
  /**
   * 后端返回的预算行 id（budgets.client_uid）。清预算走 DELETE /api/budgets/{clientUid}，
   * 所以拉回来的预算要把这个 id 带着；本地新建的预算没有该字段，
   * 由同步层按 (分类|币种) 派生出同样的值（后端缺省 clientUid 时也用同一规则）。
   */
  clientUid?: string;
  /** 预算所属币种（'total' 总预算按币种各存一条）；老数据没有该字段 = 跟随全局设置货币 */
  currency?: string;
}

export interface Ledger {
  id: string;
  name: string;
  icon: string;
  color?: string;
  createdAt: number;
  /** 最近一次切换使用的时间戳(ms)；账本弹层按它降序排（MRU），未用过的保持原顺序 */
  lastUsedAt?: number;
}

export type PeriodType = 'day' | 'week' | 'month' | 'year' | 'custom';

export interface PeriodPreference {
  type: PeriodType;
  customStart?: string;
  customEnd?: string;
}

// 记账设定：日期显示格式
export type DateFormat = 'YYYY/MM/DD' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';

// 记账设定：一周的第一天，0 = 星期日，1 = 星期一
export type WeekStartsOn = 0 | 1;

// 记账设定：金额小数位数
export type DecimalPlaces = 0 | 1 | 2;

/** 扣账周期：每周 / 每月 / 每年 */
export type PaymentCycle = 'weekly' | 'monthly' | 'yearly';

/** 财务规划-计划付款：固定支出/收入按周期自动入账 */
export interface PaymentPlan {
  id: string;
  ledgerId: string;
  /** 计划名称，如"房租"；自动入账时写入交易的 displayName */
  name: string;
  amount: number;
  /** 支出 = 固定扣账；收入 = 固定入账 */
  type: 'expense' | 'income';
  cycle: PaymentCycle;
  /** monthly: 每月几号(1-31，超出当月天数时兜底为当月最后一天) */
  dayOfMonth?: number;
  /** weekly: 周几(1=周一 … 5=周五；0=周日) */
  dayOfWeek?: number;
  /** yearly: 月 + 日 */
  month?: number;
  day?: number;
  /** 首次扣账日 YYYY-MM-DD */
  startDate: string;
  /** 可选结束日，之后不再生成 */
  endDate?: string;
  /** 到点自动入账；关闭时只发提醒不扣账 */
  autoDeduct: boolean;
  /** 关联分类；null = 归"其他" */
  categoryId: string | null;
  /** 关联资产账户(可选)；记录该笔从哪个账户出/入 */
  assetId?: string;
  /** 暂停/启用：暂停中不扣账不提醒 */
  active: boolean;
  /** 补账游标：已处理到的最后一期日期(YYYY-MM-DD)；启动时从它追赶，上限 24 期 */
  lastProcessedDate?: string;
  createdAt: number;
}

export type AssetType = 'cash' | 'bank' | 'credit' | 'ewallet' | 'investment' | 'other';

export interface Asset {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: AssetType;
  currency: string;
  initialBalance: number;
  ledgerId: string;
  createdAt: number;
  // 以下字段仅信用卡类型使用
  creditLimit?: number; // 额度
  statementDay?: number; // 账单日，1-28
  dueDay?: number; // 还款日，1-28（若小于等于账单日，视为下个月的这一天）
  interestRate?: number; // 年利率(%)，逾期未还时用于估算利息
  // 默认账户：记一笔时自动带出这个账户。同一时间最多一个资产是默认（由 setDefaultAsset 保证）
  isDefault?: boolean;
  // 归档时间（ISO）：有值 = 已归档。归档账户不出现在账户列表/记账选择/净资产里，
  // 但历史交易仍引用它（取得正确币种与账户名）。老数据没有该字段 = 活跃账户
  archivedAt?: string;
}
