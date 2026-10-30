// TransactionTypeHeader.tsx
// 记一笔页头（T13 抽取 / T14 改两行 —— 计划 9.2 第 ① 条「把挤的控件挪到单独一行」；
// T19-B V2 改玻璃 —— 稿 G_Add.dc.html / G_AddLight.dc.html）：
//   第一行：返回玻璃圆钮 + 居中白标题 + 右侧动作（扫票玻璃胶囊；编辑模式换成玻璃圆钮垃圾桶）
//   第二行：类型分段 SegmentedControl（玻璃槽 + 白色选中胶囊，stretch 四等分占满一整行，
//          每段约 82dp，英文 Exchange 也放得下；编辑模式没有类型切换，不渲染这一行）
//
// 扫票：支出/收入传 onScanPress；转账/兑换不做扫票识别（不传就不渲染，右侧用同宽占位保持标题居中）。
// 文字 / 图标 = text.primary（UI V2.1 §3：玻璃上的标题、按钮文字一律主文字色 —— 旧的
// 白色字面量在日间渐变上只有 1.4:1）；材质走 GlassView（半透明 + 亮边 + 内高光 + 模糊回退）。

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useLayout } from '../../theme/useLayout';
import { useT } from '../../i18n/LanguageContext';
import AppText from '../ui/AppText';
import BackButton from '../ui/BackButton';
import GlassView from '../ui/GlassView';
import PressableScale from '../PressableScale';
import SegmentedControl from '../SegmentedControl';
import type { Layout, Spacing } from '../../theme/theme';

/** UI 层四个类型入口（兑换在数据层复用 transfer） */
export type TransactionUiType = 'expense' | 'income' | 'transfer' | 'exchange';

interface Props {
  uiType: TransactionUiType;
  /** 点类型格：父层负责 setUiType / 清类别 / 切步骤（分段控件的选中震动由组件内部发） */
  onSelectType: (type: TransactionUiType) => void;
  onBack: () => void;
  /** 标题（记一笔 / 编辑账单） */
  title: string;
  /** 扫票入口（相机图标 + 文字，玻璃胶囊）；转账/兑换不传 */
  onScanPress?: () => void;
  /** 删除入口（编辑模式：玻璃圆钮里的红色垃圾桶，替代扫票） */
  onDeletePress?: () => void;
  /** 类型分段行（默认显示；编辑模式传 false） */
  showTypeSwitch?: boolean;
}

export function TransactionTypeHeader({
  uiType,
  onSelectType,
  onBack,
  title,
  onScanPress,
  onDeletePress,
  showTypeSwitch = true,
}: Props) {
  const { semantic, spacing, layout } = useTheme();
  // 矮屏（可用高 < 700）：页头上下留白再收一档（T15），给类别区留出「至少 2 行」的高度
  const { isShort } = useLayout();
  const t = useT();
  const styles = useMemo(() => makeStyles(spacing, layout), [spacing, layout]);

  const options = [
    { value: 'expense', label: t('addTx.expense') },
    { value: 'income', label: t('addTx.income') },
    { value: 'transfer', label: t('addTx.transfer') },
    { value: 'exchange', label: t('addTx.exchange') },
  ];

  return (
    <View style={[styles.header, isShort && styles.headerShort]}>
      <View style={styles.headerRow}>
        {/* 返回：44 玻璃圆钮（稿） */}
        <BackButton onPress={onBack} accessibilityLabel={t('common.back')} />
        {/* 标题居中、text.primary（稿 17/600）；放不下也不缩字、不省略 */}
        <AppText
          variant="headline"
          weight="600"
          align="center"
          color={semantic.textPrimary}
          numberOfLines={1}
          style={styles.title}
        >
          {title}
        </AppText>
        {onDeletePress ? (
          <PressableScale
            onPress={onDeletePress}
            activeScale={0.94}
            hitSlop={0}
            accessibilityRole="button"
            accessibilityLabel={t('common.delete')}
          >
            <GlassView radius={999} style={styles.glassRound}>
              <Ionicons name="trash-outline" size={20} color={semantic.danger} />
            </GlassView>
          </PressableScale>
        ) : onScanPress ? (
          <PressableScale
            onPress={onScanPress}
            activeScale={0.94}
            hitSlop={0}
            accessibilityRole="button"
            accessibilityLabel={t('addTx.scanReceipt')}
          >
            <GlassView radius={999} style={styles.glassScan}>
              <Ionicons name="camera-outline" size={18} color={semantic.textPrimary} />
              <AppText variant="subhead" weight="600" color={semantic.textPrimary}>
                {t('addTx.scanReceipt')}
              </AppText>
            </GlassView>
          </PressableScale>
        ) : (
          // 转账/兑换没有扫票：同宽占位，标题保持与有扫票时同一位置
          <View style={styles.roundSpacer} />
        )}
      </View>
      {showTypeSwitch && (
        <View style={[styles.typeRow, isShort && styles.typeRowShort]}>
          {/* 分段控件的选项值就是 UiType（字符串联合），回传时收窄；
              玻璃槽 + 白色选中胶囊（V2 稿），stretch 撑满整行。
              槽底托盘（UI V2.1 §4）：未选中标签是 13pt 小字（要 4.5:1），单层玻璃槽压在渐变
              最亮的一段上只有 3.7-4.1:1。托盘为**实底**（surfaceSunken，全 App「凹底」档）——
              半透明 scrim 会被玻璃槽的 backdrop 模糊从上下的亮渐变里回拉，压不下去。
              与槽同圆角、零内衬（观感就是「槽更深一档」，不多一层描边） */}
          <View style={[styles.typeTray, { backgroundColor: semantic.surfaceSunken }]}>
            <SegmentedControl
              options={options}
              selected={uiType}
              onSelect={(value) => onSelectType(value as TransactionUiType)}
              appearance="glass"
              thumb="white"
              stretch
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** 令牌进、StyleSheet 出（尺寸 / 间距走令牌；玻璃上的白字档是 V2 约定字面量） */
function makeStyles(spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    header: {
      paddingHorizontal: layout.page,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    // 矮屏：上留白 4→0、下留白 8→4（一档收紧）
    headerShort: { paddingTop: 0, paddingBottom: spacing.xs },
    // 第一行：返回 44 玻璃圆 + 标题（吃满剩余宽、居中）+ 右侧动作
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      columnGap: spacing.sm,
    },
    title: { flex: 1 },
    // 44 玻璃圆钮（返回 / 垃圾桶；chevron-back 图标视觉居中）
    glassRound: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    // 扫票玻璃胶囊：高 44、内 14、图标 18 + 14/600 文字（稿）
    glassScan: {
      height: 44,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 6,
    },
    // 无右侧动作时的占位：与返回钮同宽
    roundSpacer: { width: 44 },
    // 第二行：类型分段独占一行（stretch 撑满内容宽），与标题行只留半个格
    typeRow: { marginTop: spacing.sm },
    // 压暗托盘（UI V2.1 §4，见 JSX 注释）：全圆角、零内衬
    typeTray: { borderRadius: 999 },
    typeRowShort: { marginTop: spacing.xs },
  });
}

export default TransactionTypeHeader;
