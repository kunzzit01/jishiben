// SegmentedControl.tsx
// 分段开关（T05 升级 / 计划 4.5）：灰底胶囊槽 + 实底滑块（accent 底 + onAccent 字）。
//
// UI V2（2026-10-10）新增两个变体，旧调用点不改也照常：
// - appearance="glass"：玻璃底胶囊（落在品牌渐变上，如统计页 年/月/周、支出/收入）；
// - thumb="white"（默认）：选中块 = 白色胶囊（夜字 #0A0A0F / 日字 #2A1678）；
//   thumb="accent"：选中块 = accent 渐变 + 白字（设置页「深色模式」三选一）。
//
// 本版升级点
// - 高度 36（触控区用外层 padding + 段 hitSlop 补到 44，见 TOUCH_HEIGHT）；
// - 滑块改 Reanimated 弹簧（motion.spring.default）：位移与宽度一起弹，切换是「滑过去」不是「跳过去」；
// - 无障碍：每段 accessibilityRole="button" + accessibilityState.selected，读屏能读出「已选中」；
// - 全部颜色 / 圆角 / 字号改取令牌（semantic / radius / typography）。
//
// 保持不变的（都是用户真机校准过的，别改）
// - props 仍是 { options, selected, onSelect }（设置页 ×3、日历卡 ×1 调用点不用改）；
// - 滑块定位必须逐段 onLayout 实测 —— 段与段文字宽度不同（英文 Expense/Income/Net、中文 中/英），
//   按「槽宽 ÷ 段数」等分推算会让滑块和文字错位（真机截图 bug 换来的一条）；
// - 段最小宽 52：两段开关（中/英）不至于太窄；
// - 首帧几何未测到时滑块先藏起来，实测到位再淡入，避免停在 0 位盖住第一段。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';
import { Radius, SemanticColors } from '../theme/theme';
import { hapticSelection } from '../utils/haptics';
import AppText from './ui/AppText';
import GlassView from './ui/GlassView';

export interface SegmentOption {
  label: string;
  value: string;
}

interface Props {
  options: SegmentOption[];
  /** 当前选中的 option.value */
  selected: string;
  /** 点选项立即生效（含重复点已选中项，由调用方决定行为） */
  onSelect: (value: string) => void;
  /**
   * 等分撑满父容器宽度（T14：记一笔类型分段「支出/收入/转账/兑换」占满一整行，每段约 82dp）。
   * 默认 false = 保持原来的「内容宽 + 左对齐」，现有调用方（设置页 / 日历卡）外观不变。
   */
  stretch?: boolean;
  /** 槽身材质：'solid'（默认，灰底）/ 'glass'（UI V2：玻璃底，落在渐变上） */
  appearance?: 'solid' | 'glass';
  /** 选中块：'white'（默认，白色胶囊）/ 'accent'（accent 渐变 + 白字，设置页深色模式用） */
  thumb?: 'white' | 'accent';
  /** 紧凑档：段最小宽 40、内衬 8（一行里还要和别的内容并排时用，如统计页 周/月/年/自定义） */
  compact?: boolean;
}

/** 槽高（视觉高度） */
const TRACK_HEIGHT = 36;
/** 槽内边距：滑块贴槽内缘留 3 */
const TRACK_PADDING = 3;
/** 触控区高度下限（UI_RULES：可点元素 ≥44pt） */
const TOUCH_HEIGHT = 44;
/** 段最小宽（用户定版：两段开关不至于太窄） */
const SEGMENT_MIN_WIDTH = 52;
/** 每段上下各补多少触控：轨道 36 + 外侧留白 → 整块 44 */
const SEGMENT_HIT_SLOP = (TOUCH_HEIGHT - TRACK_HEIGHT) / 2 + TRACK_PADDING;

export default function SegmentedControl({
  options,
  selected,
  onSelect,
  stretch,
  appearance = 'solid',
  thumb = 'white',
  compact,
}: Props) {
  const { semantic, radius, motion, gradients, glassPill } = useTheme();
  const styles = useMemo(() => makeStyles(semantic, radius), [semantic, radius]);
  const isGlass = appearance === 'glass';

  // 每段的实测几何：key=value，x 为段左缘在槽坐标系里的位置。
  // 逐段 onLayout 上报 —— 各段文字宽度不同也各自准确（不许改成等分推算）
  const [segFrames, setSegFrames] = useState<Record<string, { x: number; width: number }>>({});
  const onSegmentLayout = (value: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setSegFrames((prev) =>
      prev[value]?.x === x && prev[value]?.width === width ? prev : { ...prev, [value]: { x, width } }
    );
  };

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.value === selected)
  );
  const active = options[activeIndex];
  const activeFrame = active ? segFrames[active.value] : undefined;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!activeFrame) return;
    // 首帧（几何未测得）：不播动画直接落位，然后淡入 —— 避免滑块从 0 位滑过去盖住第一段
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = activeFrame.x;
      thumbWidth.value = activeFrame.width;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    thumbX.value = withSpring(activeFrame.x, motion.spring.default);
    thumbWidth.value = withSpring(activeFrame.width, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFrame?.x, activeFrame?.width]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  /** 选中字色（三套变体各不同） */
  const activeTextColor = isGlass
    ? thumb === 'accent'
      ? semantic.onAccent
      : glassPill.text
    : semantic.onAccent;
  /** 未选中字色：玻璃上是稿取样 muted，灰底槽上是次要字色 */
  const idleTextColor = isGlass ? glassPill.muted : semantic.textSecondary;

  /** 滑块底色：solid=accent 实底 / glass+white=白胶囊 / glass+accent=null（渐变子层自绘） */
  const thumbBgStyle = !isGlass
    ? { backgroundColor: semantic.accent }
    : thumb === 'white'
      ? { backgroundColor: glassPill.fill }
      : null;

  const rows = (
    <>
      <Animated.View style={[styles.thumb, thumbBgStyle, thumbStyle]}>
        {thumb === 'accent' ? (
          <LinearGradient
            colors={gradients.accent.colors}
            locations={gradients.accent.locations as [number, number, ...number[]]}
            start={gradients.accent.start}
            end={gradients.accent.end}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
      </Animated.View>
      {options.map((opt) => {
        const isActive = opt.value === selected;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segment, compact && styles.segmentCompact, stretch && styles.segmentStretch]}
            activeOpacity={0.75}
            onLayout={onSegmentLayout(opt.value)}
            hitSlop={{ top: SEGMENT_HIT_SLOP, bottom: SEGMENT_HIT_SLOP, left: 0, right: 0 }}
            onPress={() => {
              if (!isActive) hapticSelection();
              onSelect(opt.value);
            }}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: isActive }}
          >
            {/* 分段压在滑块上（透明底），缩放反馈看不见 → 沿用按下降透明度的反馈。
                ⚠ 文字层必须 pointerEvents="none"：某些叠层/合成场景下命中会落在文字上而没到
                TouchableOpacity，表现为「点字没反应、点字外围才行」（用户 2026-10-30 反馈）。
                加 wrapper View 是因为 RNW 的 AppText 不保证把该 prop 透传到 DOM。 */}
            <View pointerEvents="none">
              <AppText
                variant="footnote"
                weight={isActive ? '600' : '400'}
                color={isActive ? activeTextColor : idleTextColor}
                numberOfLines={1}
              >
                {opt.label}
              </AppText>
            </View>
          </TouchableOpacity>
        );
      })}
    </>
  );

  return (
    <View style={[styles.touchWrap, stretch && styles.touchWrapStretch]}>
      {isGlass ? (
        // 玻璃槽（UI V2）：半透明 + 1px 亮边 + 顶部内高光（GlassView 自带模糊回退）
        <GlassView radius={radius.full} style={stretch ? [styles.trackBase, styles.trackStretch] : styles.trackBase}>
          {rows}
        </GlassView>
      ) : (
        <View style={stretch ? [styles.track, styles.trackStretch] : styles.track}>{rows}</View>
      )}
    </View>
  );
}

function makeStyles(semantic: SemanticColors, radius: Radius) {
  // 槽的布局部分：灰底槽与玻璃槽共用（玻璃槽的底 / 边 / 高光由 GlassView 提供，不覆盖它）
  const trackBase = {
    flexDirection: 'row' as const,
    borderRadius: radius.full,
    padding: TRACK_PADDING,
    minHeight: TRACK_HEIGHT,
    alignItems: 'center' as const,
  };
  return StyleSheet.create({
    // 外侧留白：把触控区从 36 撑到 44，视觉轨道仍是 36
    touchWrap: { paddingVertical: (TOUCH_HEIGHT - TRACK_HEIGHT) / 2, alignSelf: 'flex-start' },
    // stretch 档：外层撑满父容器（轨道随之等宽），段与段 flex:1 四等分
    touchWrapStretch: { alignSelf: 'stretch' },
    trackBase,
    // stretch 档：轨道本体也撑满（玻璃槽是 GlassView，不吃 track 的样式）
    trackStretch: { alignSelf: 'stretch' },
    // 槽：中性灰底（hairline 在日夜两套里都是"浅一档的底"），minHeight 而非固定高度
    track: {
      ...trackBase,
      backgroundColor: semantic.hairline,
    },
    // 滑块：贴槽内缘，水平位置完全由 translateX（实测段 x）驱动；宽度随段弹
    // （底色按变体在 JSX 里给：solid=accent / white=白胶囊 / accent=渐变子层）
    thumb: {
      position: 'absolute',
      top: TRACK_PADDING,
      bottom: TRACK_PADDING,
      left: 0,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    segment: {
      minWidth: SEGMENT_MIN_WIDTH,
      minHeight: TRACK_HEIGHT - TRACK_PADDING * 2,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // stretch 档：每段等分（四段各占 1/4 行宽）
    segmentStretch: { flex: 1 },
    segmentCompact: { minWidth: 40, paddingHorizontal: 8 },
  });
}
