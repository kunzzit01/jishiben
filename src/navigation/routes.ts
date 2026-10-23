// 路由键常量 + 各导航栈的参数类型。
// 之前路由键是各屏幕里手写的散落中文字符串，拼错编译期不报错、运行时才失败；
// 集中在这里之后：调用侧用 ROUTES.XXX，导航器加泛型，拼错直接是编译错误。
//
// 注意：栈内注册的 name 仍是中文（App.tsx），这里只是"调用侧不再手写字符串"，
// 改界面文案（行标题）不影响跳转，改路由只需要动 App.tsx 注册处 + 这里。

/** 跳转目标（= App.tsx 各 Stack.Screen 的 name，含 Tab 名） */
export const ROUTES = {
  // Tab 级
  TAB_HOME: '首页',
  TAB_ASSETS: '资产',
  TAB_ADD_TX: '记一笔',
  TAB_STATS: '统计',
  TAB_SETTINGS: '设置项',
  // HomeStack
  HOME: '首页主页',
  ADD_TX: '记一笔',
  CATEGORY_MGMT: '类别分类',
  LEDGER: '开设账本',
  ABOUT: '关于应用',
  FEEDBACK: '帮助与反馈',
  CALCULATOR: '计算器',
  LOAN_CALC: '贷款计算器',
  COMPOUND_CALC: '复利计算器',
  // ProfileStack（设置项 Tab）
  PROFILE: '我的主页',
  SETTINGS: '设置',
  AI: 'AI专区',
  AUTH: '登录注册',
  FINANCE_PLAN: '财务规划',
  FINANCE_PLAN_EDIT: '财务规划编辑',
  // AssetStack
  ASSETS: '资产主页',
  ADD_ASSET: '添加资产账户',
  // AddTransactionStack
  ADD_TX_ROOT: '记一笔主页',
} as const;

/** 「记一笔」的初始类型档（入口预设 / 编辑回填都落在这里） */
export type AddTxPresetType = 'expense' | 'income' | 'transfer';

export type TransactionLike = {
  id: string;
  amount: number;
  categoryId: string;
  type: 'expense' | 'income' | 'transfer';
  date: string;
  note: string;
  assetId?: string;
  receiptUri?: string;
};

/** HomeStack：首页 Tab 里的堆栈 */
export type HomeStackParamList = {
  首页主页: undefined;
  记一笔: {
    editTransaction?: TransactionLike;
    presetCategoryId?: string;
    autoScan?: boolean;
    // 首页四个快捷方块的预设档：expense / income / transfer（只决定初始类型）
    presetType?: AddTxPresetType;
    // 既有入口（资产页转账、AI 专区）用的同义字段，保留
    initialType?: AddTxPresetType;
  } | undefined;
  类别分类: undefined;
  开设账本: undefined;
  关于应用: undefined;
  帮助与反馈: undefined;
  计算器: undefined;
  贷款计算器: undefined;
  复利计算器: undefined;
  AI专区: undefined;
  // 记一笔选择账户弹窗的"添加新账户"双注册（与 AssetStack 同一组件）：push 本栈，goBack 天然回记一笔
  添加资产账户: { assetId?: string } | undefined;
};

/** ProfileStack：设置项 Tab 的堆栈 */
export type ProfileStackParamList = {
  我的主页: undefined;
  设置: undefined;
  类别分类: undefined;
  开设账本: undefined;
  AI专区: undefined;
  // 登录 / 注册独立页面（从设置项"账号与同步"进入）
  登录注册: undefined;
  // 财务规划（计划付款：固定支出自动扣账）
  财务规划: undefined;
  // 财务规划-新增/编辑计划(整页表单;planId 有值 = 编辑)
  财务规划编辑: { planId?: string } | undefined;
  // AI专区→"扫描小票自动记账" 会 push 本栈的"记一笔"（双注册）
  记一笔: {
    editTransaction?: TransactionLike;
    presetCategoryId?: string;
    autoScan?: boolean;
    // 与 HomeStack 同签名（AI 专区等入口双注册进来）
    presetType?: AddTxPresetType;
    initialType?: AddTxPresetType;
  } | undefined;
  // 原侧拉菜单的入口（从设置项列表跳转）
  关于应用: undefined;
  帮助与反馈: undefined;
  // 手势诊断页（临时）：定位账本弹层上滑滚不动的坏点，诊断完删除
  手势诊断: undefined;
  计算器: undefined;
  贷款计算器: undefined;
  复利计算器: undefined;
  // 记一笔选择账户弹窗的"添加新账户"双注册（与 AssetStack 同一组件）：push 本栈，goBack 天然回记一笔
  添加资产账户: { assetId?: string } | undefined;
};

/** AssetStack */
export type AssetStackParamList = {
  资产主页: undefined;
  添加资产账户: { assetId?: string } | undefined;
  // 账户详情的"转账" push 本栈的"记一笔"（与 HomeStack / ProfileStack 同一组件三注册）：
  // goBack 天然回账户详情。签名与另两处保持一致，presetType='transfer' 预选转账档
  记一笔: {
    editTransaction?: TransactionLike;
    presetCategoryId?: string;
    autoScan?: boolean;
    presetType?: AddTxPresetType;
    initialType?: AddTxPresetType;
  } | undefined;
};

/** AddTransactionStack（中间圆按钮的记一笔） */
export type AddTransactionStackParamList = {
  记一笔主页: undefined;
  类别分类: undefined;
  // 记一笔选择账户弹窗的"添加新账户"双注册（与 AssetStack 同一组件）：push 本栈，goBack 天然回记一笔
  添加资产账户: { assetId?: string } | undefined;
};

/** 底部 Tab 导航器；'设置项' 支持指定内层 screen（抽屉里跳设置主页用） */
export type MainTabParamList = {
  首页: undefined;
  资产: undefined;
  记一笔: undefined;
  统计: undefined;
  设置项: { screen: 'home' } | undefined;
};
