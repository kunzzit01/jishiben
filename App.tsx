import React, { useEffect, useState, Profiler } from 'react';
import { StatusBar } from 'expo-status-bar';
// V2.2：Android 系统导航栏按钮明暗跟随应用主题（声明式，非 Android 端渲染 null）
// —— 栏身底色不需要 API：SDK 57 强制 edge-to-edge，导航条后面就是页面根视图的
//    semantic.bg（日 #F5F2FB / 夜 #06050C），app.json 的 expo-navigation-bar 插件
//    关掉了系统对比度蒙层（enforceContrast: false），底色原样透出
import { NavigationBar } from 'expo-navigation-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { View, StyleSheet, Pressable, Animated, Platform, InteractionManager } from 'react-native';
import { NavigationContainer, CommonActions, DarkTheme, DefaultTheme, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import type {
  MainTabParamList,
  HomeStackParamList,
  ProfileStackParamList,
  AddTransactionStackParamList,
  AssetStackParamList,
} from './src/navigation/routes';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';

import { AppProvider, useApp } from './src/context/AppContext';
import { AuthProvider } from './src/context/AuthContext';
import { AppLockProvider, AppLockOverlay } from './src/context/AppLockContext';
import { AppDialogProvider } from './src/components/AppDialog';
import { useSyncManager } from './src/hooks/useSyncManager';
import { ThemeModeProvider, useThemeMode } from './src/context/ThemeModeContext';
import { LanguageProvider, useT } from './src/i18n/LanguageContext';
// ⚠ 组件预览页（T03–T05 起）：只在 __DEV__ + web + ?gallery=1 时生效，不进正式导航。
//   后续每一批都用它做回归截图，**T32 清理任务时才删**（本行 + App() 里的 galleryMode 守卫 + 预览页文件）。
import ComponentGallery from './src/screens/_preview/ComponentGallery';
import { useNotificationSetup } from './src/hooks/useNotificationSetup';
import { usePaymentReminders } from './src/hooks/usePaymentReminders';
import { useBottomSystemInset } from './src/hooks/useBottomSystemInset';
import {
  TabBarAutoHideProvider,
  useCreateTabBarAutoHide,
  useTabBarAutoHide,
} from './src/context/TabBarAutoHideContext';
import { useTheme } from './src/theme/useTheme';
import { TabSceneDisplayGate } from './src/navigation/TabSceneDisplayGate';
import { useSystemColorScheme } from './src/theme/useSystemColorScheme';
// 浮空 Tab 栏的几何常量（全项目唯一来源）：外壳 / 底部留白 / 收起距离共用同一组数
import {
  TAB_BAR_HEIGHT,
  TAB_BAR_GAP,
  TAB_BAR_SHELL_HEIGHT,
  TAB_CENTER_BUTTON_SIZE,
  TAB_CENTER_BUTTON_BOTTOM,
} from './src/hooks/useTabClearance';
// 标签文字走统一文字组件（令牌字号 caption2 = 11pt；英文自动走打包 Inter）
import { AppText, GlassView } from './src/components/ui';
import { StartupSkeleton } from './src/components/ui/StartupSkeleton';
// 启动占位页只需要"现有主题底色"这一个令牌：此时 ThemeModeProvider 还没挂载，
// useTheme() 用不了（它会抛错），只能直接引 token
import { lightColors, darkColors } from './src/theme/theme';
import { hapticLight, hapticSelection } from './src/utils/haptics';
import HomeScreen from './src/screens/HomeScreen';
import AddTransactionScreen from './src/screens/AddTransactionScreen';
import ReportScreen from './src/screens/ReportScreen';
import AssetScreen from './src/screens/AssetScreen';
import AddAssetScreen from './src/screens/AddAssetScreen';
import AIScreen from './src/screens/AIScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AuthScreen from './src/screens/AuthScreen';
import FinancialPlanningScreen from './src/screens/FinancialPlanningScreen';
import PlanFormScreen from './src/screens/PlanFormScreen';
import CategoryManagementScreen from './src/screens/CategoryManagementScreen';
import LedgerScreen from './src/screens/LedgerScreen';

import AboutAppScreen from './src/screens/AboutAppScreen';
import HelpFeedbackScreen from './src/screens/HelpFeedbackScreen';
import CalculatorHubScreen from './src/screens/CalculatorHubScreen';
import LoanCalculatorScreen from './src/screens/LoanCalculatorScreen';
import CompoundInterestScreen from './src/screens/CompoundInterestScreen';
import OverviewScreen from './src/screens/OverviewScreen';


const Tab = createBottomTabNavigator<MainTabParamList>();
const HomeStackNav = createNativeStackNavigator<HomeStackParamList>();
const ProfileStackNav = createNativeStackNavigator<ProfileStackParamList>();
const AddTransactionStackNav = createNativeStackNavigator<AddTransactionStackParamList>();
const AssetStackNav = createNativeStackNavigator<AssetStackParamList>();

// "首页"Tab内部堆栈：仪表盘首页 → 记一笔（编辑/从今日账单点进来）
// 这里的"记一笔"和下面底部Tab里的"记一笔"是同一个组件，注册两次：
// - 这里用于"编辑已有记录"这种场景，走Stack的push/back，体验更顺
// - 底部Tab那个用于"点击中间圆按钮直接开始记一笔"，每次都是全新的
function HomeStack() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  return (
    <HomeStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <HomeStackNav.Screen name="首页主页" component={HomeScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      {/* 跟 ProfileStack 里的"开设账本"是同一个组件注册两次：这样从首页进来 push 到的是
          HomeStack 自己的栈，系统返回箭头 goBack() 天然回首页；从设置项进来同理天然回设置 */}
      <HomeStackNav.Screen name="开设账本" component={LedgerScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="关于应用" component={AboutAppScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="帮助与反馈" component={HelpFeedbackScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="计算器" component={CalculatorHubScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="贷款计算器" component={LoanCalculatorScreen} options={{ headerShown: false }} />
      <HomeStackNav.Screen name="复利计算器" component={CompoundInterestScreen} options={{ headerShown: false }} />
      {/* AI专区双注册（与 ProfileStack 同一组件）：从首页侧进 AI专区（如 AI专区→记一笔 的往返）
          时 push 的是 HomeStack 自己的实例，goBack 天然回记一笔/首页，不会串到设置项 Tab */}
      <HomeStackNav.Screen name="AI专区" component={AIScreen} options={{ headerShown: false }} />
      {/* 概览模式双注册（与 ProfileStack 同一组件）：从设置项进来 push 的是 ProfileStack 实例，
          goBack 天然回设置；从首页侧导航过来时走本栈实例，goBack 天然回首页 */}
      <HomeStackNav.Screen name="概览模式" component={OverviewScreen} options={{ headerShown: false }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：首页编辑记一笔时选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <HomeStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </HomeStackNav.Navigator>
  );
}

// "设置项"Tab内部堆栈：我的主页（预算） → 设置 → 各设置子页面 + AI专区
function ProfileStack() {
  const { colors } = useTheme();
  return (
    <ProfileStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <ProfileStackNav.Screen name="我的主页" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      <ProfileStackNav.Screen name="开设账本" component={LedgerScreen} options={{ headerShown: false }} />
      {/* AI专区改用与其他二级页一致的自绘头部（圆框返回键），原生头部关闭 */}
      <ProfileStackNav.Screen name="AI专区" component={AIScreen} options={{ headerShown: false }} />
      {/* 概览模式（设计稿第 11 屏）：从设置项「功能」分组进入 */}
      <ProfileStackNav.Screen name="概览模式" component={OverviewScreen} options={{ headerShown: false }} />
      {/* 登录 / 注册独立页面（未登录时从"账号与同步"进入；已登录显示个人中心内容+退出登录。
          "我的账户"入口也指向这里——一个页面两种状态 */}
      <ProfileStackNav.Screen name="登录注册" component={AuthScreen} options={{ headerShown: false }} />
      {/* 财务规划（计划付款：固定支出自动扣账）——从设置项"财务规划"进入 */}
      <ProfileStackNav.Screen name="财务规划" component={FinancialPlanningScreen} options={{ headerShown: false }} />
      {/* 财务规划-新增/编辑计划（整页表单；planId 有值 = 编辑） */}
      <ProfileStackNav.Screen name="财务规划编辑" component={PlanFormScreen} options={{ headerShown: false }} />
      {/* 原侧拉菜单的入口现在从设置项列表跳转，同样注册到 ProfileStack：
          goBack 天然回"我的主页"（与 HomeStack 的同名页面互不干扰） */}
      <ProfileStackNav.Screen name="关于应用" component={AboutAppScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="帮助与反馈" component={HelpFeedbackScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="计算器" component={CalculatorHubScreen} options={{ headerShown: false }} />
      {/* 计算器 Hub 的两个子页也要注册到 ProfileStack：从设置项进来的计算器 Hub
          navigate('贷款计算器'/'复利计算器') 才有目标（否则报 NAVIGATE not handled） */}
      <ProfileStackNav.Screen name="贷款计算器" component={LoanCalculatorScreen} options={{ headerShown: false }} />
      <ProfileStackNav.Screen name="复利计算器" component={CompoundInterestScreen} options={{ headerShown: false }} />
      {/* 记一笔双注册（与 HomeStack 同一组件）：AI专区→"扫描小票自动记账" push 的是
          ProfileStack 自己的记一笔实例，goBack 天然回 AI专区，不会跳去首页 Tab */}
      <ProfileStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：AI专区→记一笔选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <ProfileStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </ProfileStackNav.Navigator>
  );
}

// "资产"Tab内部堆栈：总资产 → 添加资产账户（整页表单，返回键 goBack 回资产页）
function AssetStack() {
  const { colors } = useTheme();
  return (
    <AssetStackNav.Navigator
      screenOptions={{
        headerShown: false,
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <AssetStackNav.Screen name="资产主页" component={AssetScreen} />
      <AssetStackNav.Screen name="添加资产账户" component={AddAssetScreen} />
      {/* 记一笔三注册（HomeStack / ProfileStack / 本栈同一组件）：账户详情的"转账"从本栈 push，
          goBack 天然回账户详情（而不是切去首页 Tab 的长驻实例）；三处各自注册同一组件、
          互不共享导航栈，是"返回回到来源页"这一条体验的统一做法 */}
      <AssetStackNav.Screen name="记一笔" component={AddTransactionScreen} options={{ headerShown: false }} />
    </AssetStackNav.Navigator>
  );
}

// 中间圆按钮"记一笔"专属堆栈：只是为了让它能 push「类别分类」并正确 goBack 回到记一笔本身，
// 跟 HomeStack/ProfileStack 里各自的「类别分类」是同一个组件注册第三次
function AddTransactionStack() {
  const { colors } = useTheme();
  return (
    <AddTransactionStackNav.Navigator
      screenOptions={{
        headerTitleAlign: 'center',
        headerStyle: { backgroundColor: colors.headerTint },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        headerShadowVisible: false,
      }}
    >
      <AddTransactionStackNav.Screen name="记一笔主页" component={AddTransactionScreen} options={{ headerShown: false }} />
      <AddTransactionStackNav.Screen name="类别分类" component={CategoryManagementScreen} options={{ headerShown: false, animation: 'slide_from_right', animationDuration: 220 }} />
      {/* 添加资产账户双注册（与 AssetStack 同一组件）：记一笔 Tab 选择账户弹窗的
          "添加新账户" push 本栈实例，goBack 天然回记一笔，不会切去资产 Tab */}
      <AddTransactionStackNav.Screen name="添加资产账户" component={AddAssetScreen} options={{ headerShown: false }} />
    </AddTransactionStackNav.Navigator>
  );
}

// ---------- 启动闸门 / 原生启动页 / 开发期计时 ----------
const JS_START_MS = Date.now();
/** 开发期启动计时：只在 __DEV__ 打印，发布包里是空操作 */
function devMark(label: string) {
  if (__DEV__) console.log(`[startup] ${label} +${Date.now() - JS_START_MS}ms`);
}
let splashHidden = false;
/** 收起原生启动页（只做一次）。骨架屏 / 页面接力，不会留白 */
function hideSplash(reason: string) {
  if (splashHidden) return;
  splashHidden = true;
  devMark(`splash-hidden (${reason})`);
  if (Platform.OS !== 'web') SplashScreen.hideAsync().catch(() => undefined);
}
if (Platform.OS !== 'web') SplashScreen.preventAutoHideAsync().catch(() => undefined);
devMark('js-start');
// 安全上限 2.5 秒：字体 / 本地数据迟迟不就绪也要收起启动页，之后由骨架屏接力（web / 开发期不会卡死）
setTimeout(() => hideSplash('cap'), 2500);

/**
 * 启动闸门：本地数据（AppContext.loading）与主题偏好（ThemeModeProvider.loaded）读完前不挂载页面，
 * 只显示骨架屏（不写任何空态文案）。两者都就绪后，真实首页在原位挂载：净资产从 0 滚到真实值（见 HeroRollMoney）。
 * 根视图完成首次布局后收起原生启动页（0.5 秒兜底，2.5 秒硬上限）。
 */
function StartupGate({ children }: { children: React.ReactNode }) {
  const { loading } = useApp();
  const { loaded: themeLoaded } = useThemeMode();
  const { semantic } = useTheme();
  const ready = !loading && themeLoaded;
  const [laidOut, setLaidOut] = useState(false);

  useEffect(() => {
    if (!ready) return;
    devMark('hydrated');
    devMark('children-mounted (first frame of the real app)');
  }, [ready]);

  useEffect(() => {
    if (ready && laidOut) hideSplash('ready');
  }, [ready, laidOut]);

  // 兜底：数据已就绪但根视图的布局回调迟迟不来 → 0.5 秒后也收起，不让启动页干等到上限
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => hideSplash('ready-fallback'), 500);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <View style={{ flex: 1, backgroundColor: semantic.bg }} onLayout={() => setLaidOut(true)}>
      {ready ? children : <StartupSkeleton />}
    </View>
  );
}

/** 开发期：记录每次提交的耗时（只在 __DEV__，>4ms 才打印；用于日历切换的成本测量） */
function devOnRender(id: string, phase: string, actualDuration: number) {
  if (actualDuration > 4) console.log(`[cal] commit ${id} ${phase} ${actualDuration.toFixed(1)}ms at ${Math.round(performance.now())}`);
}

/** 首屏之后再启动的后台服务（推送注册 / 云同步 / 付款提醒）：交互结束后再延后一小会儿 */
function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handle = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setReady(true), 600);
    });
    return () => {
      handle.cancel();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return ready;
}

/** 后台服务挂载点（只在首屏之后渲染一次，逻辑与原先 AppContent 里的三个 hook 完全一致） */
function DeferredServices() {
  useNotificationSetup();
  useSyncManager();
  usePaymentReminders();
  useEffect(() => {
    devMark('deferred services started');
  }, []);
  return null;
}

/** 系统导航栏区（底部安全区）实底遮罩：Expo Go 下原生导航栏设置不生效，由 App 自己画 */
function NavBarScrim() {
  // 与计算器键盘的底部让位共用同一个高度来源（useBottomSystemInset），遮罩高 == 键盘让出高，中间无缝
  const bottomInset = useBottomSystemInset();
  const { semantic } = useTheme();
  if (bottomInset <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bottomInset, backgroundColor: semantic.navBarBg, zIndex: 35 }}
    />
  );
}

// 中央「记一笔」圆钮（UI V2 §3.4，2026-10-10；V2.4 改几何）：
// 58pt 圆 + accent 渐变 + 顶部内高光 + 柔和粉紫投影，**凸出栏顶 13**（栏 48 高，圆钮底距栏底 3）。
// 触摸区：整圆都在外壳内，Android 判得中。
// 铁律：不加任何按压视觉反馈（无缩放 / 无位移 / 无水波），只保留点击震动。
function CenterTabButton({ onPress }: { onPress?: () => void }) {
  const { semantic } = useTheme();
  const t = useT();

  return (
    <Pressable
      onPressIn={hapticLight}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('nav.add')}
      style={[styles.centerButton, { boxShadow: '0px 8px 18px rgba(108,77,246,0.45)' }]}
    >
      {/* 根元素是普通 View（圆角 + overflow 裁切），渐变画在子层 */}
      <LinearGradient
        colors={['#6C4DF6', '#9B5BD6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* 顶部柔和高光：上半圆白色渐隐 */}
      <LinearGradient
        colors={['rgba(255,255,255,0.32)', 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.centerButtonGloss}
        pointerEvents="none"
      />
      <Ionicons name="add" size={26} color={semantic.onAccent} />
    </Pressable>
  );
}

// 浮空 Tab 栏外壳（UI V2 §3.4）：几何定位（absolute / 左右 16 / 贴安全区 / 高 48 / 全圆角胶囊）与
// 收起展开的 transform 在这里；材质（栏身色 / 阴影）交给内层栏自己的 tabBarStyle。
// 中央「+」58 圆凸出栏顶 13（V2.4）—— 外壳高度 = 栏身 + 凸起。
// 注意：v7 会以普通函数方式调用 tabBar（tabBar(props) 而非 <tabBar/>），
// 所以这层不能放 hooks——hooks 全部在 SlidingTabBarInner 组件里。
function SlidingTabBar(props: any) {
  return <SlidingTabBarInner {...props} />;
}

function SlidingTabBarInner(props: any) {
  const insets = useSafeAreaInsets();
  const { translateY, opacity } = useTabBarAutoHide();
  const { radius, semantic } = useTheme();
  const { state, navigation } = props;

  // 中央「+」的按压：与 react-navigation 内层 BottomTabItem 的行为逐字一致
  // （先 emit tabPress，没被阻止才 navigate）——这样 resetToRootOnTabPress 的
  // 「回根页 + 震动」监听照常生效；「记一笔」已聚焦时只 emit（回它自己的根页）
  const addIndex = state.routes.findIndex((r: any) => r.name === '记一笔');
  const onPressAdd = () => {
    const route = state.routes[addIndex];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.index !== addIndex && !event.defaultPrevented) {
      navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
    }
  };

  return (
    <Animated.View
      // box-none：外壳本身不吃触摸（透明区域让页面照常点击），子元素（栏 / 圆钮）正常接收
      pointerEvents="box-none"
      style={[
        styles.tabShell,
        {
          // 栏底贴着安全区上沿（GAP 0）；外壳向上多出圆钮凸起
          bottom: TAB_BAR_GAP + insets.bottom,
          height: TAB_BAR_SHELL_HEIGHT,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      {/* 内层栏（react-navigation 自带）：几何（高度 / 全圆角）留在 screenOptions 的 tabBarStyle；
          材质（填充 / 描边 / 顶部内高光 / 投影 / 模糊回退）统一走 UI V2.1 §2 的 GlassView。
          V2.2：栏身填充换成高不透明度磨砂（夜 92% / 日 94%，semantic.tabBar）；
          D5：strongBlur 强模糊（iOS 强度 70 / web backdrop-filter 28px）；Android 无原生模糊，只靠 fill */}
      <View style={styles.tabBarRow}>
        <GlassView radius={radius.full} fill={semantic.tabBar} strongBlur style={[styles.tabBarGlass, { borderWidth: StyleSheet.hairlineWidth, borderColor: semantic.hairline }]}>
          <BottomTabBar {...props} />
        </GlassView>
      </View>

      {/* 中央「+」：绝对定位在外壳之内（整圆都在可点区里），横向居中对齐五个槽位的中缝 */}
      <View style={styles.centerButtonSlot} pointerEvents="box-none">
        <CenterTabButton onPress={onPressAdd} />
      </View>
    </Animated.View>
  );
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  首页: 'home-outline',
  资产: 'wallet-outline',
  统计: 'bar-chart-outline',
  设置项: 'settings-outline',
};

// 首页/设置项这两个 Tab 底下套了 Stack，切走再切回来时 React Navigation 默认会
// 保留你当时停在 Stack 第几层，不会自动回到根页面。
// 这个函数生成一个 tabPress 监听：每次点这个 Tab，都强制把它内层 Stack 重置回根页面。
//
// 注意：判断"要不要重置"必须在 dispatch 之前用 navigation.getState() 做完，
// 不能写在 dispatch(updaterFn) 的回调里再 return state 当"不用处理"的信号——
// 那样等于把整个导航 state（自带 type: 'tab' 字段）当成一个 action 派发出去，
// 会报 "The action 'tab' was not handled by any navigator" 这个错。
function resetToRootOnTabPress(tabName: string) {
  return ({ navigation }: any) => ({
    tabPress: () => {
      // Tab 切换触感：轻"咔哒"（selection），与水滴指示器动画同帧
      hapticSelection();
      const state = navigation.getState();
      const tabIndex = state.routes.findIndex((r: any) => r.name === tabName);
      const tabRoute = state.routes[tabIndex];
      // 已经在根页面（没有嵌套 state，或者嵌套 index 就是 0），什么都不用做，直接返回
      if (!tabRoute?.state || tabRoute.state.index === 0) return;
      const newRoutes = state.routes.map((r: any) => (r.name === tabName ? { ...r, state: undefined } : r));
      // reset 显式带上 index：重置与"切换到该 tab"合并为同一个确定性动作，不和默认切换竞态
      navigation.dispatch(CommonActions.reset({ ...state, index: tabIndex, routes: newRoutes }));
    },
  });
}

// Tab 导航 + 状态栏，拆成 ThemeModeProvider 下面的内层组件，
// 这样才能在这里调用 useTheme() 读到用户在设置项里选的深色模式偏好。
// App() 自己不行——ThemeModeProvider 是 App() 渲染出来的，
// useTheme() 得在它渲染出的子孙组件里调用才能读到值。
function AppContent() {
  const { isDark, colors, semantic, spacing, radius } = useTheme();
  // 选中态圆盘（纯状态指示，无按压动画）：夜 白 10% / 日 accent 10%
  const tabDiscColor = isDark ? 'rgba(255,255,255,0.10)' : semantic.accentSoft;
  const t = useT();
  const tabAutoHide = useCreateTabBarAutoHide();

  // 底部 Tab 显示名随语言切换；路由内部名保持中文（见 routes.ts 注释），
  // 所以这里按「中文路由名 → 当前语言标签」做映射，跳转逻辑完全不受影响
  const tabLabels: Record<string, string> = {
    首页: t('nav.home'),
    资产: t('nav.assets'),
    记一笔: t('nav.add'),
    统计: t('nav.stats'),
    设置项: t('nav.settings'),
  };

  // 推送注册 / 云同步 / 付款提醒：首屏之后再启动（见 DeferredServices），不抢首帧
  const servicesReady = useAfterFirstPaint();



  // web 端根节点底部有约 12px 布局偏移区，不垫色会露出白色；
  // 顺带把浏览器滚动溢出区也染成应用底色（T06 G1：跟随语义底色 semantic.bg）
  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = semantic.bg;
      document.documentElement.style.backgroundColor = semantic.bg;
    }
  }, [semantic.bg]);

  // 导航容器主题：背景跟应用底色一致（T06 G1：纯色 semantic.bg，不再跟薰衣草渐变）——
  // TabShell 预留的悬空条带、浮空栏圆角的缺口都由它上色，深色模式下才不会露出导航默认的浅灰
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: semantic.bg,
      card: colors.card,
      border: colors.dividerHair,
      text: colors.textPrimary,
      primary: colors.link,
      notification: colors.expenseOver,
    },
  };

  return (
    <>
      <TabBarAutoHideProvider value={tabAutoHide}>
      {/* T06 G1：全 App 页面底 = 纯色 semantic.bg（旧的薰衣草渐变退役；Hero 卡的紫色渐变
          是 HomeScreen 自己的事，不在这里）；屏幕容器透明，这一层就是全局底色画布。
          T07：根视图不再 marginBottom: insets.bottom + overflow: hidden 裁剪 ——
          抽屉 / 弹层可以正常贴到屏幕底边，页面内容也能画进导航条区域（edge-to-edge 正常行为） */}
      <View style={{ flex: 1, backgroundColor: semantic.bg }}>
      <NavigationContainer
        theme={navTheme}
        // 任何导航变化（切 Tab、push、pop）都让栏回到可见——
        // 新页面从顶部开始，收着栏会让人迷失
        onStateChange={tabAutoHide.reset}
      >
        <Tab.Navigator
          initialRouteName="首页"
          // 注意：tabBar 必须挂在 Navigator 本身（v7 经 ...rest 传进 BottomTabView），
          // 放在 screenOptions 里只会进 descriptors、不会被消费
          tabBar={SlidingTabBar}
          // 非活跃 Tab 的内容容器挂 display:none（不卸载 → 状态 / 滚动都留着）：
          // 整棵子树退出布局与合成树，首页日历玻璃卡不会再在别的 Tab 背后当隐形图层
          screenLayout={({ route, children }) => (
            <TabSceneDisplayGate sceneName={route.name}>{children}</TabSceneDisplayGate>
          )}
          screenOptions={({ route }) => ({
            headerShown: false,
            // 选中 = 实心图标 + tabActive（夜白 / 日紫）；未选中 = 线框图标 + tabInactive（UI V2 §1）
            tabBarActiveTintColor: semantic.tabActiveLabel,
            // 未选中标签：夜间 .66 alpha 保证 11pt 文字 ≥4.5:1（日间沿用 textTertiary）
            tabBarInactiveTintColor: semantic.tabInactive,
            // 无障碍读屏名（标签改成函数式渲染后，库不再自动拼「x, tab, n of m」，显式给名字）
            tabBarAccessibilityLabel: tabLabels[route.name] ?? route.name,
            // 标签走统一文字组件：令牌字号 caption2 = 11pt（旧的 13pt 让英文「Settings」
            // 贴住选中托的边缘）+ 系统大字上限 1.3 + 英文自动 Inter
            tabBarLabel: ({ color, position }: { color: string; position: 'beside-icon' | 'below-icon' }) => (
              <AppText
                variant="caption2"
                color={color}
                numberOfLines={1}
                style={position === 'beside-icon' ? { marginStart: spacing.xs } : undefined}
              >
                {tabLabels[route.name] ?? route.name}
              </AppText>
            ),
            // 栏身材质（UI V2.1 §2）：浮空胶囊的填充 / 描边 / 顶部内高光 / 投影 / 模糊回退
            // 统一由外层 GlassView 画，这里只留几何（高度 / 全圆角 / 裁切）——底色与描边清空；
            // 几何（左右 16 / 距底 18）由 SlidingTabBar 外壳负责
            tabBarStyle: {
              height: TAB_BAR_HEIGHT,
              // 关键:覆盖 BottomTabBar 内部默认的 paddingBottom: insets.bottom——
              // 外壳已经用 bottom: TAB_BAR_GAP + insets.bottom 避开过安全区，库内部再 pad 一次
              // 会把内容区压扁，导致 Tab 文字下半截被挤出卡片
              paddingBottom: 0,
              backgroundColor: 'transparent',
              borderTopWidth: 0,
              // 全圆角胶囊（UI V2：不再用 20 圆角方框，也不再画发丝描边）
              borderRadius: radius.full,
              // 圆角要裁掉内容（历史上按渐变出血的装饰层会漏出来出直角）
              overflow: 'hidden',
              // ⚠库的 BottomTabBar 自带 styles.bottom.elevation: 8（安卓默认"黑"阴影）——
              // 半透明/浅色栏身上会透出一条中性暗带（=用户追过的"白条"暗半）；清零，
              // 阴影统一交给外层 GlassView 的令牌投影
              elevation: 0,
            },
            // 图标托默认 31×28（TabBarIcon 的 HIG 尺寸），比 20 号图标多出的 4pt 空档会算进上留白；
            // 收到 20（=图标本身），图标与标签的墨迹才真正上下等距。
            tabBarIconStyle: { height: 20 },
            // 自定义 tab 按钮：去掉 Android 默认的灰色水波纹（和紫色水滴叠在一起很脏）。
            // 铁律：底部 Tab 按钮不加任何按压视觉反馈、不发生布局位移（保留震动）
            tabBarButton: (props: any) => (
              <PlatformPressable
                {...props}
                pressColor="transparent"
                android_ripple={undefined}
                // V2.3：库默认顶对齐（styles.tabVerticalUiKit = justifyContent:'flex-start' + padding:5，
                // 按 Apple HIG 栏高≈内容高设计的），68 高胶囊里多出的高度全堆到标签下方 ——
                // 图标整体偏上、下方留白翻倍。按钮自身撑满栏高，在这里居中即可上下等距。
                // 水平内边距收到 4：给 11pt 英文标签（Settings 等）多留一点排版余量
                style={[props.style, { paddingHorizontal: 4, justifyContent: 'center' }]}
              >
                {/* 选中圆盘：绝对定位画在图标 + 标签之下，不占排版、不随按压变化 */}
                {props.accessibilityState?.selected ? (
                  <View pointerEvents="none" style={[styles.tabDisc, { backgroundColor: tabDiscColor }]} />
                ) : null}
                {props.children}
              </PlatformPressable>
            ),
            tabBarIcon: ({ color, focused }) => {
              const icon = TAB_ICONS[route.name];
              if (!icon) return null;
              // 层次感：选中图标从描线切换为实底（Ionicons -outline ↔ 实底名）——
              // 稿里「轻微填充」的近似（20 号是 UI V2 稿的 Tab 图标尺寸）
              let name: keyof typeof Ionicons.glyphMap = icon;
              if (focused && icon.endsWith('-outline')) {
                const solid = icon.replace('-outline', '') as keyof typeof Ionicons.glyphMap;
                if (solid in Ionicons.glyphMap) name = solid;
              }
              return <Ionicons name={name} size={20} color={color} />;
            },
          })}
        >
          <Tab.Screen
            name="首页"
            component={HomeStack}
            listeners={resetToRootOnTabPress('首页')}
          />
          <Tab.Screen
            name="资产"
            component={AssetStack}
            listeners={resetToRootOnTabPress('资产')}
          />
          <Tab.Screen
            name="记一笔"
            component={AddTransactionStack}
            options={{
              // 中央凸起圆钮由 SlidingTabBar 外壳自己画（这里让库只保留槽位，不渲染按钮/文字），
              // 圆钮横向居中对齐五个槽位的中缝
              tabBarLabel: () => null,
              tabBarButton: () => null,
            }}
            listeners={resetToRootOnTabPress('记一笔')}
          />
          <Tab.Screen name="统计">
            {() => <ReportScreen />}
          </Tab.Screen>
          <Tab.Screen
            name="设置项"
            component={ProfileStack}
            listeners={resetToRootOnTabPress('设置项')}
          />
        </Tab.Navigator>
      </NavigationContainer>
      </View>
      </TabBarAutoHideProvider>
      {/* 'auto' 只跟随系统外观，不认用户在设置里选的"始终亮色/暗色"；
          改成根据 isDark 显式指定，才能和应用内其他地方的主题联动一致 */}
      <AppLockOverlay />
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* V2.2 系统导航栏：日 #F5F2FB 底 + 深色按钮 / 夜 #06050C 底 + 浅色按钮，
          随主题切换（style 的可选值里 dark = 深色按钮、light = 浅色按钮） */}
      <NavigationBar style={isDark ? 'light' : 'dark'} />
      <NavBarScrim />
      {servicesReady ? <DeferredServices /> : null}
    </>
  );
}

export default function App() {
  // ⚠ 组件预览页开关（仅 __DEV__ + web + ?gallery=1；后续批次回归测试用，T32 清理时删）
  const galleryMode =
    Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]gallery=1/.test(window.location.search);

  // 打包字体（V2.2c）：数字 / 英文 = Inter（4 档），中文 = Noto Sans SC（3 档子集，1.4MB/档）。
  // 键名 = 字体内部 PostScript 名，必须与 src/theme/theme.ts 的 fontFamily / fontFamilyCjk
  // 令牌保持一致（改一处要同步另一处）。加载失败（fontError）回退系统字体，绝不白屏 / 卡死。
  const [fontsLoaded, fontError] = useFonts({
    // 图标字体（Ionicons）也在首屏前加载：否则第一帧里图标是空白圆
    ...Ionicons.font,
    'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('./assets/fonts/Inter-Bold.ttf'),
    'NotoSansSC-Regular': require('./assets/fonts/NotoSansSC-Regular.ttf'),
    'NotoSansSC-Medium': require('./assets/fonts/NotoSansSC-Medium.ttf'),
    'NotoSansSC-Bold': require('./assets/fonts/NotoSansSC-Bold.ttf'),
  });
  useEffect(() => {
    if (fontsLoaded) devMark('fonts-ready');
  }, [fontsLoaded]);
  // 占位页底色：ThemeModeProvider 还没挂载（它在下面才渲染），读不到用户在设置项里选的
  // 深色偏好，只能按系统外观取 theme.ts 的既有底色令牌——只影响字体加载这一瞬间的画面。
  // ⚠ 用自研的 useSystemColorScheme（RN 自带 useColorScheme 在 web 上不跟随系统变化，见该文件头注释）
  const systemScheme = useSystemColorScheme();

  // 字体未就绪：先铺满屏幕一层纯底色（不写任何文字）——不给用户看白屏，也不会闪一下
  // 系统字体再切换；加载失败（fontError 非空）照常往下渲染 App，退回系统字体，绝不卡死。
  // 不引 expo-splash-screen：app.json 现在没有任何 splash 插件配置，加它要动 app.json
  // 和原生工程，超出本任务边界。
  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: systemScheme === 'dark' ? darkColors.bg : lightColors.bg,
        }}
      />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <LanguageProvider>
            <AuthProvider>
              {/* Bio Lock：登录后可开启，开 App / 切后台回来时要求生物识别解锁 */}
              <AppLockProvider>
                <AppDialogProvider>
                  <AppProvider>
                    {/* ⚠ 组件预览页（后续批次回归测试用，T32 清理时删）：
                        只在 __DEV__ + web + URL 带 ?gallery=1 时替换真实 App，不进正式导航。 */}
                    {__DEV__ && galleryMode ? <ComponentGallery /> : <StartupGate>{__DEV__ ? <Profiler id="app" onRender={devOnRender}><AppContent /></Profiler> : <AppContent />}</StartupGate>}
                    {/* 全局主题化弹窗 Host 已内置于 AppDialogProvider：
                        <AppDialog /> 的 DialogHost 随 Provider 渲染 */}
                  </AppProvider>
                </AppDialogProvider>
              </AppLockProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  // 浮空 Tab 栏外壳：只负责几何定位 + 承载收起/展开的 transform。
  // 高度 / 距底 / 圆钮槽位在外壳内联给（都要读 insets 与令牌常量）。
  // 中央「+」凸出栏顶 13（V2.4），整圆都在外壳内；
  // overflow 必须 visible（+ 的投影画到外壳边缘之外）。
  // 左右 16：UI V2 稿的悬浮胶囊缩进（与页面内容边距一致）
  tabShell: {
    position: 'absolute',
    left: 16,
    right: 16,
    overflow: 'visible',
  },
  // 内层栏的内容区：与外壳同尺寸（栏身 = 外壳高度；+ 收进栏内后不再留凸起区）
  tabBarRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: TAB_BAR_SHELL_HEIGHT - TAB_BAR_HEIGHT,
    height: TAB_BAR_HEIGHT,
  },
  // 栏身材质层（UI V2.1 §2 的 GlassView）：铺满内容区，全圆角由组件 radius='full' 给
  tabBarGlass: { height: '100%' },
  // 中央圆钮槽：整圆都在槽内（槽高 = 圆径），横向居中 → 圆钮对准五个槽位的中缝
  centerButtonSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: TAB_CENTER_BUTTON_BOTTOM,
    height: TAB_CENTER_BUTTON_SIZE,
    alignItems: 'center',
  },
  // 选中圆盘：绝对定位，居中于栏身（高 48）内（内容 33 + 上下各留 3.5）
  tabDisc: {
    position: 'absolute',
    top: 4,
    left: 8,
    right: 8,
    height: 40,
    borderRadius: 20,
  },
  // 圆钮顶部柔和高光（上半圆）
  centerButtonGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  // 中央圆钮本体（UI V2）：58pt 圆，accent 渐变 + 顶部内高光在 JSX 内联给；
  // 根元素是普通 View（圆角 + overflow 裁切），渐变画在 absolute 子层
  centerButton: {
    width: TAB_CENTER_BUTTON_SIZE,
    height: TAB_CENTER_BUTTON_SIZE,
    borderRadius: TAB_CENTER_BUTTON_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 顶部内高光：1dp 白色亮线（稿里 inset 0 1px 0 rgba(255,255,255,.35)）
  centerButtonHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
