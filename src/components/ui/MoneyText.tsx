// MoneyText.tsx
// 全 App 唯一金额文字组件（T03 / 计划 4.4、4.5）。
//
// 职责
// - 一律经 formatMoney() 出文本（千分位 / 真减号 / 币种开关 / 紧凑格式 / 隐藏态），
//   页面里不许再出现 toFixed(2) 或手写千分位；
// - 按语义自动取色：支出 = 主文字色 + 「−」、收入 = 绿 + 「+」、转账 = 次要文字色 + 无符号；
// - 等宽数字（fontVariant ['tabular-nums']）+ 一行显示；
// - 金额永不被挤压：容器默认 flexShrink: 0；
// - 超大金额按「实际可用宽」降级：40 → 34 → 28 → 22 → 18（不做连续压缩，只按档位跳）；
// - 数字变化时逐位滚动（Reanimated 自写，不加依赖）：每位错开 30ms、600ms 缓出；
//   首次渲染（挂载）与首屏数据到位（挂载后 600ms 内的首次赋值）都不滚动。
//
// 金额永不截断、永不换行（验收 2026-10-09 退回第 2 条与返工）
//   1. 档位用**完整字符串**（含 +/− 号、币种前缀/后缀 RM、千分位、小数点）的宽度估算选，
//      取能放下的最大档；系数是 Inter 逐字符实测值（见下方 CHAR_EM 注释），
//      逐字符相加比整串实测略宽（~1.6% 字距），方向安全 —— 漏算 +RM 里的 M（0.92em）
//      就会选大一号档位、把最后一个 0 挤到第二行；
//   2. 连最小档都放不下 → 停在**地板档**（阶梯末档），再由调用方决定要不要紧凑：
//      compactFallback 默认关闭，显式打开的地方（首页净资产金额槽、资产页资产行）改用紧凑格式
//      + 长按 / 读屏看完整值；日历是显式传 `compact`（格式选项，与这里无关）的那一个。
//      ⚠ Hero 路径必须停在阶梯末档 —— 退回顶档（-1 → 0）会让长金额按最大字号画出去被页面裁掉；
//   3. 兜底：金额 Text 恒 numberOfLines={1} + ellipsizeMode="clip"
//      —— 就算估算失灵也只是裁掉尾巴，**绝不换行、绝不出省略号**。
//
// V2.2c 全局金额规范
//   - 字重下限 600（非 Hero 路径）：令牌里 300/400/500 的金额一律提到 600；
//   - ≥28 号的大金额字距 = −2% 字号（40 号 → −0.8，与 display 令牌同值）；
//   - 等宽数字（AppText 统一加 fontVariant ['tabular-nums']）。
//
// 用法
//   <MoneyText value={tx.amount} kind="expense" variant="body" />
//   <MoneyText value={netWorth} variant="display" currency="MYR" showCurrency />
//   <MoneyText value={balance} hidden={hideAmount} />

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleProp, StyleSheet, TextStyle, View } from 'react-native';
import Animated, {
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { formatMoney, FormatMoneyOptions, MINUS } from '../../utils/formatMoney';
import { FontWeightKey, TypographyVariant } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useDialogOptional } from '../AppDialog';
import AppText from './AppText';

/**
 * 降级阶梯（计划 4.2 的 40 → 34 → 28，验收再加 22 与 18 两档兜底；
 * 18 不是 typography 令牌档，是验收点名的兜底字号下限）。
 */
const SHRINK_LADDER = [40, 34, 28, 22, 18];
/**
 * 小于 40 号的非 Hero 金额：按 Hero 同款比例降级（1 / .86 / .72 / .59），
 * 但**不越过字号下限 11pt**（UI_RULES：禁止 7–10pt）—— 低于下限的档直接丢掉。
 */
const MIN_AMOUNT_FONT_SIZE = 11;
/** V2.2c：金额最低字重（非 Hero 路径） */
const MIN_AMOUNT_WEIGHT: FontWeightKey = '600';
/** V2.2c：≥这个字号的大金额字距 = −2%（40 号 → −0.8，与 display 令牌同值） */
const LARGE_AMOUNT_SIZE = 28;
const LARGE_AMOUNT_LETTER_RATIO = -0.02;

/**
 * UI V2 Hero 金额（首页 58 / 资产 42 / 记一笔 64）：整数段 500 + 负字距，
 * RM 与小数为 300 且降透明度。其余部件按稿比例派生（58 → RM 24 / 小数 28 / 行高 64 / 字距 −2.4）。
 */
const HERO_PREFIX_RATIO = 0.414;
// 尾数（小数段）与整数段同大小（2026-10-29 用户要求「尾数的大小要和前面的数字一样」）。
// 原值 0.483（整数 40 配小数 22）；改成 1 后小数段直接沿用当前档的字号、行高与字距。
const HERO_DECIMALS_RATIO = 1;
/** Hero 等比缩小的下限（dp）：19 位金额在 360 屏约剩 26dp，此下限只为拦数据异常值 */
const HERO_MIN_FIT_SIZE = 14;
const HERO_LINE_RATIO = 1.103;
const HERO_LETTER_RATIO = -0.0414;
/** RM 与整数之间的间距（稿：4） */
const HERO_PREFIX_GAP = 4;
/**
 * Hero 降级阶梯（UI V2 定稿）：58 → 50 → 42 → 34，**全部放不下才用紧凑格式**。
 * 比例制，heroSize=42/64 时同样按这四档等比降级。
 */
const HERO_LADDER_RATIOS = [1, 0.86, 0.72, 0.59];
/** 各档的整数位上限（含）：≤9 → 阶梯[0] · ≤12 → [1] · ≤15 → [2] · 更多 → [3]（位数地板） */
const LADDER_MAX_INT_DIGITS = [9, 12, 15];
/**
 * 逐字符宽度表（em，Inter-SemiBold 100px 用 canvas measureText 实测，2026-10-09）：
 *   '0'-'9' = 0.62（等宽数字）· ',' '.' = 0.335 · '+' '−' = 0.68
 *   A-Z = 见下表（M 0.922 最宽之一、I 0.277 最窄）
 *   其余未知字符（币种符号 ¥ ₩ ฿ …）按 1.02 估（最宽字符 W 的宽度，宁可多算）。
 * ⚠ 这是「能不能放下」的判定用的估算，不参与排版 —— 排版永远交给 flex。
 */
const DIGIT_EM = 0.62;
const SEPARATOR_EM = 0.335;
const SIGN_EM = 0.68;
const UNKNOWN_EM = 1.02;
const LETTER_EM: Record<string, number> = {
  A: 0.728, B: 0.659, C: 0.737, D: 0.722, E: 0.605, F: 0.588, G: 0.749, H: 0.746,
  I: 0.277, J: 0.58, K: 0.703, L: 0.565, M: 0.922, N: 0.759, O: 0.769, P: 0.645,
  Q: 0.773, R: 0.652, S: 0.65, T: 0.66, U: 0.736, V: 0.728, W: 1.02, X: 0.72,
  Y: 0.713, Z: 0.652,
};
/** 每位错开 60ms，从左（最高位）到右依次启动（V3 统一滚动标准） */
const STAGGER_MS = 60;
/** 滚动格里的数字带：0-9 连排两遍，滚动时可以从任一位越过 9 回到 0 */
const DIGIT_STRIP = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** 挂载后这段时间内的首次赋值 = 首屏数据到位，不滚动（首次加载不滚动） */
const FIRST_LOAD_WINDOW_MS = 600;

export interface MoneyTextProps extends FormatMoneyOptions {
  value: number;
  /** 字号档位（默认 body） */
  variant?: TypographyVariant;
  /** 字重覆盖（默认跟随 variant 令牌）——V2.2 资产页：行余额 17/500、分组净资产合计 22/600 */
  weight?: FontWeightKey;
  /** 颜色覆盖（默认按 kind 取 semantic 语义色） */
  color?: string;
  /** 数字变化时逐位滚动：**默认只 Hero 滚**（V2.2c 定版：其余金额一律直接换内容，任何情况
   *  都不做逐位滚动 —— 切币种时下方合计/预算换值不再播滚动动画）；显式传参可覆盖 */
  roll?: boolean;
  /**
   * 超大金额的字号阶梯（默认：基准 ≥40 时 [40,34,28,22,18]，否则不降级）；
   * 传 null 表示永不降级。
   */
  shrinkLadder?: number[] | null;
  /** 连最小档都放不下时改用紧凑格式 + 长按看全文（默认 false —— V2.2c：金额一律完整显示，
   *  放不下只按字号档位降级；只有确实要缩写的地方才显式打开） */
  compactFallback?: boolean;
  /**
   * UI V2 Hero 样式：整数大（500）、RM 与小数为 300 且降透明度（渐变上的大金额用）。
   * 整数段仍保留逐位滚动；首页 58 / 资产 42 / 记一笔 64 由 heroSize 传入。
   */
  hero?: boolean;
  /** Hero 整数段字号（默认 58），其余部件按稿比例派生：RM ≈ 0.414×、小数 ≈ 0.483× */
  heroSize?: number;
  /** Hero 小数段字号（dp，按 heroSize 等比；默认 = 比例派生 1×，即与整数同大小；传值可单独调小） */
  heroDecimalSize?: number;
  /** Hero 小数段字重（默认 300）*/
  heroDecimalWeight?: FontWeightKey;
  /** Hero 小数段颜色（默认 = 金额色并降 0.7 透明度；传入后按该色、不降透明度）*/
  heroDecimalColor?: string;
  /** Hero 整数段字距比例（默认 -0.0414；首页传 -0.03）*/
  heroLetterRatio?: number;
  /** 文本/布局微调（color / opacity / margin / textAlign 等；flexShrink 默认 0 = 金额不被挤压） */
  style?: StyleProp<TextStyle>;
  /**
   * 父级已知的可用宽（px）：传了就用它判档位，不再用「自身盒宽」。
   * ⚠ 自身盒宽 = 内容宽，而内容宽又随档位（字号）变 —— 两者互为输入会形成逐帧来回的
   *   反馈环：盒宽 273 → 判档放得下 → 40 号 → 内容 273 → 位数动画把盒宽先设回上一值 232
   *   → 判档放不下 → 34 号 → 内容 232 → …。行高随之 44↔38 抖动，整页高度也跟着跳 6px。
   *   首页金额行（heroPagerPage）宽是父级给定的定值，直接传进来即可断开这个环。
   */
  availableWidth?: number;
  /** 读屏文本（默认 = 完整金额，即使屏上显示的是紧凑格式） */
  accessibilityLabel?: string;
}

/* ------------------------------------------------------- 宽度估算 / 档位 */

/** 逐字符宽度和（em，估算用；判定优先用实测，见 MeasuredLayer） */
function estimateEm(text: string): number {
  let em = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch >= '0' && ch <= '9') em += DIGIT_EM;
    else if (ch === ',' || ch === '.') em += SEPARATOR_EM;
    else if (ch === '+' || ch === MINUS) em += SIGN_EM;
    else em += LETTER_EM[ch.toUpperCase()] ?? UNKNOWN_EM;
  }
  return em;
}

/**
 * 宽度是否放得下：em 只算**字形**宽度，字距（letterSpacing）另算。
 * ⚠ 字距是固定 px（display 档 −0.8），不随字号缩放 —— 把它并进 em 里会得到
 *   「不同字号算出的 em 不一样」的假象（实测时在 18px 量、拿到 22px 去判就会误判放得下），
 *   所以这里显式拆开：宽(size) = 字形em × size + 字距 × 字符数。
 */
function fitsByEm(em: number, fontSize: number, spacingTotal: number, availableWidth: number): boolean {
  return em * fontSize + spacingTotal <= availableWidth;
}

/** 能放下的最大档位；-1 = 连最小档都放不下 */
function tierFitting(
  em: number,
  spacingTotal: number,
  ladder: number[],
  availableWidth: number
): number {
  if (availableWidth <= 0) return 0;
  for (let i = 0; i < ladder.length; i++) {
    if (fitsByEm(em, ladder[i] ?? 0, spacingTotal, availableWidth)) return i;
  }
  return -1;
}

/** 整数位个数（不含符号、千分位、小数点、币种） */
function moneyIntDigits(text: string): number {
  const dot = text.indexOf('.');
  const head = dot === -1 ? text : text.slice(0, dot);
  let n = 0;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch !== undefined && ch >= '0' && ch <= '9') n++;
  }
  return n;
}

/**
 * Hero 拆段（UI V2）：'−RM17,061.15 USD' → 前缀(−RM) · 整数(17,061) · 小数(.15) · 后缀( USD)。
 * 前缀 / 小数 / 后缀是 300 字重的小字，中间整数段保留逐位滚动。
 */
function splitHeroParts(text: string): { prefix: string; int: string; decimals: string; suffix: string } {
  const m = /^([^0-9]*)([0-9][0-9,]*)(\.[0-9]+)?(.*)$/.exec(text);
  if (!m) return { prefix: '', int: text, decimals: '', suffix: '' };
  return { prefix: m[1] ?? '', int: m[2] ?? '', decimals: m[3] ?? '', suffix: m[4] ?? '' };
}

/** 按整数位个数取阶梯档位（计划 4.2 的位数规则，作为地板，不单独决定最终档） */
function digitTier(intDigits: number): number {
  for (let i = 0; i < LADDER_MAX_INT_DIGITS.length; i++) {
    if (intDigits <= (LADDER_MAX_INT_DIGITS[i] ?? 0)) return i;
  }
  return LADDER_MAX_INT_DIGITS.length;
}

/** 字重下限：低于 floor 的档一律提到 floor（金额最低 600，V2.2c） */
function weightAtLeast(weight: FontWeightKey, floor: FontWeightKey): FontWeightKey {
  return Number(weight) >= Number(floor) ? weight : floor;
}

/* ---------------------------------------------------------------- 字符格 */

type MoneyCell = {
  /** 位置键：从右往左编号（金额变化时最低位最稳定，右边对齐不会整行错位） */
  key: string;
  char: string;
  /** 上一轮的字符：非 null 表示这格正在滚动 */
  from: string | null;
  /** 错开延迟（毫秒，从左到右） */
  delay: number;
  /** 新出现的位（位数变多）：淡入 + 微上滑 */
  enter: boolean;
  /** 消失的位（位数变少）：淡出，char = 旧字符 */
  exit: boolean;
};

/** 把金额拆成字符格（从左到右渲染，键按「从右数第几位」编号）。
 *  stagger = 允许滚动：数字位全部滚动（含未变的位，滚一整圈）；位数增减 → 新位淡入、旧位淡出；
 *  分隔符 / 符号直换不滚。 */
function splitCells(text: string, prevText: string | null, stagger: boolean): MoneyCell[] {
  const plain = (c: { key: string; char: string }, i: number): MoneyCell => ({
    key: c.key,
    char: c.char,
    from: null,
    delay: i * STAGGER_MS,
    enter: false,
    exit: false,
  });
  if (prevText === null || prevText === text || !stagger) {
    return splitChars(text).map((c, i) => plain(c, i));
  }
  const prevMap = new Map(splitChars(prevText).map((c) => [c.key, c.char]));
  const nowChars = splitChars(text);
  const nowKeys = new Set(nowChars.map((c) => c.key));
  const rows: { idx: number; cell: MoneyCell }[] = nowChars.map(({ key, char, indexFromRight }, i) => {
    const prevChar = prevMap.get(key);
    const roll = /\d/.test(char) && prevChar !== undefined && /\d/.test(prevChar);
    return {
      idx: indexFromRight,
      cell: {
        key,
        char,
        from: roll ? (prevChar as string) : null,
        delay: i * STAGGER_MS,
        enter: prevChar === undefined,
        exit: false,
      },
    };
  });
  prevMap.forEach((ch, key) => {
    if (nowKeys.has(key)) return;
    rows.push({
      idx: Number(key.slice(1)),
      cell: { key, char: ch, from: ch, delay: 0, enter: false, exit: true },
    });
  });
  // 从左到右排列（右对齐的键：indexFromRight 大的在左）
  rows.sort((x, y) => y.idx - x.idx);
  return rows.map((r) => r.cell);
}

function splitChars(text: string): { key: string; char: string; indexFromRight: number }[] {
  const out: { key: string; char: string; indexFromRight: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const indexFromRight = text.length - 1 - i;
    out.push({ key: `c${indexFromRight}`, char: text[i] ?? '', indexFromRight });
  }
  return out;
}

/* ------------------------------------------------------- 单格（逐位滚动） */

function RollingCell({
  char,
  from,
  enter,
  exit,
  progress,
  startFraction,
  variant,
  weight,
  textStyle,
  color,
}: {
  char: string;
  /** 旧字符：非 null 且两边都是数字 → 数字带滚动；exit 时即要淡出的旧字符 */
  from: string | null;
  enter: boolean;
  exit: boolean;
  /** 整段滚动进度 0 → 1（一个组件共用一个：每位用 startFraction 从左到右错开） */
  progress: SharedValue<number>;
  startFraction: number;
  variant: TypographyVariant;
  /** 字重覆盖（Hero 整数段用 500；省略 = variant 自带档位） */
  weight?: FontWeightKey;
  textStyle: StyleProp<TextStyle>;
  color: string;
}) {
  // 格子高度 = 一行文字的自然高（onLayout 实测：系统大字 / 最大缩放上限都自动跟上）
  const [cellHeight, setCellHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== cellHeight) setCellHeight(h);
  };

  const isStrip = !exit && from !== null && /\d/.test(char) && /\d/.test(from);
  const fromDigit = isStrip ? Number(from) : 0;
  // 数字带向上滚的步数：到新数字为止，走过中间所有数字；同一数字则滚整整一圈
  const steps = isStrip ? (Number(char) - fromDigit + 10) % 10 || 10 : 0;

  const stripStyle = useAnimatedStyle(() => {
    const t = progress.value <= startFraction ? 0 : Math.min(1, (progress.value - startFraction) / (1 - startFraction));
    return { transform: [{ translateY: -(fromDigit + steps * t) * cellHeight }] };
  }, [fromDigit, steps, startFraction, cellHeight]);

  const fadeStyle = useAnimatedStyle(() => {
    const t = progress.value <= startFraction ? 0 : Math.min(1, (progress.value - startFraction) / (1 - startFraction));
    if (exit) return { opacity: 1 - t };
    if (enter) return { opacity: t, transform: [{ translateY: (1 - t) * cellHeight * 0.35 }] };
    return { opacity: 1 };
  }, [enter, exit, startFraction, cellHeight]);

  if (isStrip) {
    return (
      <View style={styles.cell} onLayout={onLayout}>
        {/* 隐形占位：撑起格子的宽高（不可见，不参与显示） */}
        <AppText variant={variant} weight={weight} color="transparent" style={[textStyle, styles.cellGhost]} numberOfLines={1}>
          {char}
        </AppText>
        <Animated.View style={[styles.cellStrip, stripStyle]} pointerEvents="none">
          {DIGIT_STRIP.map((d, i) => (
            <View key={i} style={{ height: cellHeight, justifyContent: 'center' }}>
              <AppText variant={variant} weight={weight} color={color} style={textStyle} numberOfLines={1}>
                {d}
              </AppText>
            </View>
          ))}
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.cell} onLayout={onLayout}>
      {/* 每格只有 1 个字符：这里 numberOfLines={1} 不是「截断金额」，只是保证格子恒为一行高 */}
      <Animated.View style={fadeStyle}>
        <AppText variant={variant} weight={weight} color={color} style={textStyle} numberOfLines={1}>
          {char}
        </AppText>
      </Animated.View>
    </View>
  );
}

/* ------------------------------------------------------- 隐藏测量层 */

/**
 * 隐藏测量层：把金额用**同样字号**在「不受容器宽度约束」的盒子里渲染一遍，量出真实宽度。
 * - 可见的那份是 numberOfLines={1}，被容器夹住时量不出真实宽度，只能靠它；
 * - 绝对定位：不参与任何排版（宽 = 估算上限 ×1.3 + 24，保证不被盒子本身夹住）；
 * - 只在估算说「放不下」时渲染，量完就卸载（平时零开销）；
 * - 位置无所谓（只取宽度），所以可以直接放在 Fragment 里跟可见文字并列。
 */
function MeasureLayer({
  text,
  variant,
  weight,
  textStyle,
  boxWidth,
  onMeasured,
}: {
  text: string;
  variant: TypographyVariant;
  /** 字重覆盖（与可见文本一致，量宽才准） */
  weight?: FontWeightKey;
  textStyle: StyleProp<TextStyle>;
  boxWidth: number;
  onMeasured: (width: number) => void;
}) {
  return (
    <View pointerEvents="none" accessible={false} style={[styles.measureBox, { width: boxWidth }]}>
      <AppText
        variant={variant}
        weight={weight}
        color="transparent"
        numberOfLines={1}
        style={textStyle}
        onLayout={(e) => onMeasured(e.nativeEvent.layout.width)}
      >
        {text}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------- MoneyText */

export function MoneyText({
  value,
  variant = 'body',
  weight,
  kind = 'plain',
  currency,
  showCurrency,
  currencyPosition,
  compact,
  hidden,
  decimals,
  color,
  roll,
  shrinkLadder,
  compactFallback = false,
  hero = false,
  heroSize = 58,
  heroDecimalSize,
  heroDecimalWeight,
  heroDecimalColor,
  heroLetterRatio,
  style,
  availableWidth: availableWidthProp,
  accessibilityLabel,
}: MoneyTextProps) {
  const { typography, semantic, motion } = useTheme();
  const token = typography[variant];
  // UI V2 Hero：整数段基准档 = heroSize（首页 58 / 资产 42 / 记一笔 64），
  // 各档尺寸在下面按「降级阶梯」从基准档算出（见 heroLadder）
  const heroIntSize = hero ? heroSize : 0;
  const baseSize = hero ? heroIntSize : token.fontSize;
  // 逐位滚动开关：默认只 Hero 滚（V2.2c）；显式传 roll 可强制开/关
  const rollEnabled = roll ?? hero;
  // 软获取：不在 AppDialogProvider 里时返回 null（长按看全文自动禁用，不报错）
  const dialog = useDialogOptional();

  const formatOptions = useMemo(
    () => ({ kind, currency, showCurrency, currencyPosition, compact, hidden, decimals }),
    [kind, currency, showCurrency, currencyPosition, compact, hidden, decimals]
  );
  // 完整金额（永不缩写的“真身”）：屏上被紧凑化时，它也进 accessibilityLabel
  const fullText = useMemo(() => formatMoney(value, formatOptions), [value, formatOptions]);

  // 颜色：支出中性 + −、收入绿 + +、转账次要色 + 无符号（UI_RULES 第 1 节）
  const kindColor =
    kind === 'expense'
        ? semantic.amountExpense
        : kind === 'income'
          ? semantic.amountIncome
          : kind === 'transfer'
            ? semantic.amountTransfer
            : semantic.textPrimary;
  const resolvedColor = color ?? kindColor;

  // 阶梯：基准 ≥40 的大字号档走五档（display / amountEntry）；
  // 40 以下按 Hero 同款比例降级（V2.2c：放不下只降档、绝不紧凑），地板 11pt
  // Hero 走自己的四档（58 → 50 → 42 → 34，比例制）
  const ladder = useMemo(() => {
    if (shrinkLadder === null) return [baseSize];
    if (shrinkLadder) return shrinkLadder;
    if (hero) return Array.from(new Set(HERO_LADDER_RATIOS.map((r) => Math.round(heroSize * r))));
    if (token.fontSize < SHRINK_LADDER[0]) {
      return Array.from(new Set(HERO_LADDER_RATIOS.map((r) => Math.round(token.fontSize * r)))).filter(
        (size) => size >= MIN_AMOUNT_FONT_SIZE
      );
    }
    return SHRINK_LADDER.map((step, index) => (index === 0 ? token.fontSize : step));
  }, [shrinkLadder, token.fontSize, hero, heroSize, baseSize]);

  /**
   * V2.2c「金额最低 600」：非 Hero 路径一律不低于 600（令牌里的 300/400/500 全提到 600）；
   * Hero 整数段同样提到 600，RM 前缀 / 小数保持 Hero 规格的 300 小字。
   */
  const amountWeight: FontWeightKey = weightAtLeast(
    weight ?? (String(token.fontWeight) as FontWeightKey),
    MIN_AMOUNT_WEIGHT
  );
  const heroIntWeight: FontWeightKey = hero && weight ? weight : MIN_AMOUNT_WEIGHT;

  // 本组件被允许占的宽度：优先用父级给的定值（availableWidth prop），否则退回 onLayout 实测盒宽。
  // ⚠ 实测盒宽在「宽 = 内容宽」的容器里恒等于内容宽，内容宽又随档位变 → 不能单独用它判档。
  const [boxW, setBoxW] = useState(0);
  const measureWidth = (e: LayoutChangeEvent) => {
    // 父级已给定可用宽时，实测盒宽不参与判档（值随内容变，写进 state 只会白重渲一次）
    if (availableWidthProp !== undefined && availableWidthProp > 0) return;
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== boxW) setBoxW(w);
  };
  const availableWidth =
    availableWidthProp !== undefined && availableWidthProp > 0 ? availableWidthProp : boxW;

  // 实测每 px 字形宽（em）：隐藏测量层量出的「(真实宽 − 字距) ÷ 当时字号」。
  // 换文本要重新量；换字号不用（字形 em 与字号无关，见 fitsByEm 注释）
  const [measuredEm, setMeasuredEm] = useState<number | null>(null);
  useEffect(() => {
    setMeasuredEm(null);
  }, [fullText]);

  /**
   * Hero 专线（与上面的 em 估算无关）：
   * 1) 用隐藏测量层在**基准档**下量出整串的真实宽度（RM/整数/小数按各自字号拼，绝不被容器裁）；
   * 2) 各档宽度 = 基准宽 × (档位 ÷ 基准档) —— 所有部件比例都随档位等比，是线性关系；
   * 3) 可用宽 = 组件当帧实际盒宽。同一行的眼睛按钮（36 + 间距 10）由 Flex 布局从盒宽里
   *    扣掉**一次**，组件内不再二次扣减（页面别重复扣）。
   */
  const [heroBaseWidth, setHeroBaseWidth] = useState<number | null>(null);
  // ⚠ 换文本时**不清空**基准宽：清空会让 heroTier 在重测到之前恒为 0（掉回最大档），
  //   而金额滚动 / 逐位滚动每帧都在换文本 → 档位逐帧 0 → 1 → 0 来回跳，行高跟着跳。
  //   隐藏测量层随文本重渲、同一帧就会把新基准宽量回来，保留旧值只是「最多一帧略偏」。
  /* Hero 连续等比缩放（2026-10-29 用户规格）：
     以「heroSize 下整串的实测自然宽」为基准，可用宽不足时**整串一起**按比例缩，
     不是分段降档、不单独缩小数、不转 K/M。同一比例作用于整数 / 小数点 / 小数 / 后缀，
     字号、字重、颜色、基线因此天然一致；行高固定用 heroSize 的档位 → 金额行高度稳定。
     还没量到自然宽时先用 em 估算兜底，避免「先按最大字号画出去、下一帧再跳小」。 */
  const heroEstNaturalWidth = useMemo(() => {
    if (!hero) return 0;
    const parts = splitHeroParts(fullText);
    const em =
      estimateEm(parts.prefix) * HERO_PREFIX_RATIO +
      estimateEm(parts.int) +
      (estimateEm(parts.decimals) + estimateEm(parts.suffix)) * HERO_DECIMALS_RATIO;
    return Math.ceil(em * heroSize * 1.06);
  }, [hero, fullText, heroSize]);
  const heroNaturalWidth = heroBaseWidth ?? heroEstNaturalWidth;
  const heroFitSize = useMemo(() => {
    if (!hero || heroSize <= 0) return heroSize;
    if (heroNaturalWidth <= 0 || availableWidth <= 0) return heroSize;
    const scale = availableWidth / heroNaturalWidth;
    // 放得下：沿用默认字号，绝不缩
    if (scale >= 1) return heroSize;
    // 缩放态：向下取整 + 0.99 余量。线性等比模型忽略了「逐字取整」误差，
    // 长串累计约 1% —— 实测 700,030,000.00 @412 会稳定溢 4px（330.1 vs 326），
    // 两者一起扣掉后落在槽内且不引入可见跳变。
    return Math.max(HERO_MIN_FIT_SIZE, Math.floor(heroSize * scale * 0.99));
  }, [hero, heroSize, heroNaturalWidth, availableWidth]);

  // ── 选文本 + 选档（顺序很重要：先按完整金额选，放不下才退紧凑格式） ──
  // 字距总贡献（px，与字号无关）：display 档 −0.8 × 26 字符 ≈ −21px，不能忽略
  const spacingTotal = token.letterSpacing * fullText.length;
  const estimatedEm = useMemo(() => estimateEm(fullText), [fullText]);
  const widthEm = measuredEm ?? estimatedEm;
  // 只在「估算说放不下、又还没实测过」时渲染隐藏测量层做精确判定（平时不占节点）
  const needsMeasure =
    !hero &&
    measuredEm === null &&
    availableWidth > 0 &&
    !fitsByEm(estimatedEm, ladder[0] ?? token.fontSize, spacingTotal, availableWidth);
  const fullTier = tierFitting(widthEm, spacingTotal, ladder, availableWidth);
  // 紧凑格式只在**实测确认**放不下时才启用：估算有 ±3% 误差，在「父容器宽度=内容宽」
  // 的地方（TransactionRow 的金额、ListRow 的值列）会把放得下的金额误判成放不下，
  // 屏上就会莫名变成 +6.8k 这种缩写（自检里抓到过）。
  // ⚠ |值| ≥ 1e21 时 JS 的 toFixed 会吐指数写法（"1.23e+21"）—— 这种文本一律走紧凑格式，
  //   屏幕上不能出现 e+21 这种东西（现实金额到不了这个量级，属于数据异常兜底）。
  const unusableText = /e[+-]\d/.test(fullText);
  // V2.2：自动紧凑格式只给「真的省得下宽度」的金额（≥1000，紧凑成 1.2k 才有意义）。
  // 千元以下的完整写法本来就短（−5.00），紧凑化会把小数去掉尾零变成「−5」——
  // 用户验收退回「全 App 金额一律两位小数」（日历除外，它是显式传 compact 的那一个）。
  const compactWorthwhile = Math.abs(value) >= 1000;
  const useCompact = hero
    ? false // Hero 永不转 K/M（用户规格：金额必须完整显示，靠整串等比缩小适配）
    : compactFallback &&
      !hidden &&
      compactWorthwhile &&
      (unusableText || (measuredEm !== null && fullTier < 0 && availableWidth > 0));
  const shownText = useMemo(
    () => (useCompact ? formatMoney(value, { ...formatOptions, compact: true }) : fullText),
    [useCompact, value, formatOptions, fullText]
  );
  // ⚠ heroTier === -1（四档全放不下）必须停在**地板档**（阶梯末档），
  //   不能 Math.max(0, -1) 退回顶档 —— 退回顶档 = 长金额在窄视口直接按最大字号画出去被页面裁掉
  //   （320 视口 15 位金额实测：40 号内容 440px / 预算 256px）。停在地板是「尽力显示」，
  //   地板仍放不下再交给 compactFallback（首页金额槽已打开）。
  const tier = hero
    ? 0
    : useCompact
      ? Math.max(0, tierFitting(estimateEm(shownText), token.letterSpacing * shownText.length, ladder, availableWidth))
      : Math.max(0, fullTier, digitTier(moneyIntDigits(fullText)));
  const fontSize = hero ? heroFitSize : ladder[Math.min(tier, ladder.length - 1)] ?? token.fontSize;
  const lineHeight = Math.round((token.lineHeight / token.fontSize) * fontSize);
  // V2.2c：≥28 号的大金额字距 −2%（40 号 = −0.8，与 display 令牌同值）；Hero 走自己的 −4.14%
  const largeLetterSpacing =
    !hero && fontSize >= LARGE_AMOUNT_SIZE
      ? Math.round(fontSize * LARGE_AMOUNT_LETTER_RATIO * 10) / 10
      : undefined;
  const sizeStyle: TextStyle | undefined =
    fontSize === token.fontSize && lineHeight === token.lineHeight && largeLetterSpacing === undefined
      ? undefined
      : { fontSize, lineHeight, letterSpacing: largeLetterSpacing };

  // Hero 渲染尺寸：各部件都从**当前档**（可能是降级后的 50/42/34）派生，保证整串等比缩放
  // Hero 的前缀只可能是正负号（币种码在卡头胶囊里），必须与整数同大小；
  // 非 Hero 的 RM 前缀仍是小一号的稿面规格
  const heroPrefixSize = hero ? Math.round(fontSize) : Math.round(fontSize * HERO_PREFIX_RATIO);
  const heroDecimalsSize =
    heroDecimalSize != null ? Math.round(heroDecimalSize * (fontSize / heroSize)) : Math.round(fontSize * HERO_DECIMALS_RATIO);
  const heroLetterSpacing = Math.round(fontSize * (heroLetterRatio ?? HERO_LETTER_RATIO) * 10) / 10;
  // 行高按基准档（heroSize）算，不随缩放变：金额缩小后行盒高度不变，
  // 预算行不会被顶下去（用户规格：保持金额所在行高度稳定）
  const heroLineHeight = Math.round(heroSize * HERO_LINE_RATIO);

  /* -------------------------------------------------- 布局 / 文本样式拆分 */

  const flatStyle = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  // 容器只认「盒子」属性；其余（color / 字距 / 变形 …）交给文字本身
  const containerStyle: TextStyle = {
    // Hero：金额要能被同行控件（如「隐藏金额」眼睛）挤窄 —— 由 Flex 布局把 36 + 间距 10
    // 扣掉**一次**（盒宽 = 剩余可用宽）；普通用法保持 0（内容宽即全部，老行为不变）
    flexShrink: flatStyle.flexShrink ?? (hero ? 1 : 0),
    ...(hero ? { minWidth: 0 } : null),
    alignSelf: flatStyle.alignSelf,
    opacity: flatStyle.opacity,
    marginTop: flatStyle.marginTop,
    marginBottom: flatStyle.marginBottom,
    marginLeft: flatStyle.marginLeft,
    marginRight: flatStyle.marginRight,
  };
  const cellTextStyle = useMemo(() => {
    const s: TextStyle = { ...flatStyle };
    // 盒子属性一律归容器：格子里的文字只保留文字属性
    delete s.flexShrink;
    delete s.alignSelf;
    delete s.opacity;
    delete s.margin;
    delete s.marginTop;
    delete s.marginBottom;
    delete s.marginLeft;
    delete s.marginRight;
    delete s.marginHorizontal;
    delete s.marginVertical;
    return Object.keys(s).length > 0 ? s : undefined;
  }, [style]);

  /* ------------------------------------------------------------ 滚动状态 */

  // Hero：把「前缀 / 整数 / 小数 / 后缀」拆开（整数段照常逐位滚动，其余是静态小字）
  const heroParts = useMemo(() => (hero ? splitHeroParts(shownText) : null), [hero, shownText]);
  /** 送进滚动状态机的文本：非 Hero = 整段，Hero = 只滚整数段 */
  const rollText = heroParts ? heroParts.int : shownText;

  const [cells, setCells] = useState<MoneyCell[]>(() => splitCells(rollText, null, false));
  const [hasRolled, setHasRolled] = useState(false);
  const progress = useSharedValue(1);
  // 减弱动态效果：文字变化时的 150ms 淡入（不滚动、不位移）
  const crossfade = useSharedValue(1);
  const crossfadeStyle = useAnimatedStyle(() => ({ opacity: crossfade.value }));
  // 数字位数变化时容器宽度用共享值过渡（不用 layout 动画：Android Fabric 上子视图增删会 addViewAt 崩溃）
  const widthSV = useSharedValue(-1);
  const naturalWRef = useRef(0);
  const rowWidthStyle = useAnimatedStyle(() => (widthSV.value < 0 ? {} : { width: widthSV.value }));
  const onNaturalLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    const prev = naturalWRef.current;
    if (w <= 0 || w === prev) return;
    naturalWRef.current = w;
    if (prev > 0 && !motion.reduceMotion) {
      widthSV.value = prev;
      widthSV.value = withTiming(w, { duration: motion.timing.numberRollTotal * 0.6, easing: motion.easing.out });
    }
  };
  const prevTextRef = useRef<string | null>(null);
  const mountedAtRef = useRef(Date.now());

  const settle = () => {
    setCells((prev) =>
      prev.some((c) => c.from !== null || c.enter || c.exit)
        ? prev.filter((c) => !c.exit).map((c) => ({ ...c, from: null, enter: false }))
        : prev
    );
  };

  useEffect(() => {
    const prevText = prevTextRef.current;
    prevTextRef.current = rollText;
    // 首次渲染（挂载）不滚动；文本没变也不动
    if (prevText === null || prevText === rollText) return;

    // 首屏数据到位（挂载后 600ms 内的首次赋值）不滚动：不算「用户操作引起的变化」
    const isFirstLoad = Date.now() - mountedAtRef.current < FIRST_LOAD_WINDOW_MS;
    const canRoll = rollEnabled && !motion.reduceMotion && !isFirstLoad;
    if (rollEnabled && motion.reduceMotion && !isFirstLoad) {
      crossfade.value = 0;
      crossfade.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
    }
    const next = splitCells(rollText, prevText, canRoll);
    setCells(next);

    if (next.some((c) => c.from !== null || c.enter || c.exit)) {
      setHasRolled(true);
      progress.value = 0;
      progress.value = withTiming(
        1,
        { duration: motion.timing.numberRollTotal, easing: motion.easing.out },
        (finished) => {
          'worklet';
          if (finished) runOnJS(settle)();
        }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollText, rollEnabled, motion]);

  /* ------------------------------------------------------------- 渲染 */

  // 紧凑格式：长按看完整金额（走 AppDialog；不在 Provider 里就没这个手势）。
  // ⚠ 必须包一层 Pressable：react-native-web 的 Text 根本不支持 onLongPress（只支持 onPress），
  //   直接挂在 Text 上在浏览器里毫无反应（真机才有）。Pressable 两端都支持。
  const longPressable = useCompact && dialog;
  // 读屏永远读完整金额（屏上是紧凑格式时也一样）
  const a11yLabel = accessibilityLabel ?? (useCompact ? fullText : shownText);

  const measureLayer = needsMeasure ? (
    <MeasureLayer
      text={fullText}
      variant={variant}
      weight={amountWeight}
      textStyle={[sizeStyle, cellTextStyle]}
      boxWidth={Math.ceil((ladder[0] ?? token.fontSize) * estimatedEm + spacingTotal) * 2 + 24}
      onMeasured={(w) => {
        // 把字距剥掉 → 纯字形 em（与字号无关，之后换档位都能直接换算）
        if (w > 0 && fontSize > 0) setMeasuredEm((w - spacingTotal) / fontSize);
      }}
    />
  ) : null;

  // Hero 隐藏测量层：在**基准档**下把「RM + 整数 + 小数」按各自字号拼出来量真实宽（透明、不参与排版）。
  // ⚠ 量的是完整金额（fullText）而不是屏上文本：紧凑格式切换后基准宽必须保持不变，
  //   否则「放不下 → 紧凑 → 变小 → 又放得下」会来回翻。
  const heroPartsFull = useMemo(() => (hero ? splitHeroParts(fullText) : null), [hero, fullText]);
  // 测量盒宽：按 em 估算放大 1.5 倍 + 余量，保证长金额不先被测量盒自己裁掉（否则量出来是盒宽、不是真宽）
  const heroMeasureBoxWidth = useMemo(() => {
    if (!hero || !heroPartsFull) return 0;
    const em =
      estimateEm(heroPartsFull.prefix) * HERO_PREFIX_RATIO +
      estimateEm(heroPartsFull.int) +
      (estimateEm(heroPartsFull.decimals) + estimateEm(heroPartsFull.suffix)) * HERO_DECIMALS_RATIO;
    return Math.ceil(em * heroSize * 1.5) + 64;
  }, [hero, heroPartsFull, heroSize]);
  const heroMeasureLayer =
    hero && heroPartsFull && availableWidth > 0 ? (
      <View
        pointerEvents="none"
        accessible={false}
        style={[styles.measureBox, { width: heroMeasureBoxWidth }]}
      >
        <View
          style={styles.row}
          onLayout={(e) => {
            const w = Math.round(e.nativeEvent.layout.width);
            if (w > 0 && w !== heroBaseWidth) setHeroBaseWidth(w);
          }}
        >
          {heroPartsFull.prefix ? (
            <AppText
              variant={variant}
              weight={heroDecimalWeight ?? '300'}
              color="transparent"
              numberOfLines={1}
              style={{ fontSize: heroSize, lineHeight: Math.round(heroSize * HERO_LINE_RATIO), letterSpacing: Math.round(heroSize * HERO_LETTER_RATIO * 10) / 10, marginRight: HERO_PREFIX_GAP }}
            >
              {heroPartsFull.prefix}
            </AppText>
          ) : null}
          <AppText
            variant={variant}
            weight={heroIntWeight}
            color="transparent"
            numberOfLines={1}
            style={{
              fontSize: heroSize,
              lineHeight: Math.round(heroSize * HERO_LINE_RATIO),
              letterSpacing: Math.round(heroSize * HERO_LETTER_RATIO * 10) / 10,
            }}
          >
            {heroPartsFull.int}
          </AppText>
          {heroPartsFull.decimals ? (
            <AppText
              variant={variant}
              weight={heroDecimalWeight ?? '300'}
              color="transparent"
              numberOfLines={1}
              style={{ fontSize: Math.round(heroDecimalSize ?? heroSize * HERO_DECIMALS_RATIO), lineHeight: Math.round((heroDecimalSize ?? heroSize * HERO_DECIMALS_RATIO) * 1.15) }}
            >
              {heroPartsFull.decimals}
            </AppText>
          ) : null}
          {heroPartsFull.suffix ? (
            <AppText
              variant={variant}
              weight={heroDecimalWeight ?? '300'}
              color="transparent"
              numberOfLines={1}
              style={{ fontSize: Math.round(heroDecimalSize ?? heroSize * HERO_DECIMALS_RATIO), lineHeight: Math.round((heroDecimalSize ?? heroSize * HERO_DECIMALS_RATIO) * 1.15) }}
            >
              {heroPartsFull.suffix}
            </AppText>
          ) : null}
        </View>
      </View>
    ) : null;

  // Hero 路径（UI V2）：整数段大（500 + 负字距）、RM 与小数为 300 且降透明度；
  // 整数段沿用逐位滚动（cells 里 from=null 时就是静态字符）。整行底部对齐（row 的 flex-end），
  // 长按看全文的手势与普通路径共用。
  if (hero && heroParts) {
    const heroIntStyle: TextStyle = {
      fontSize,
      lineHeight: heroLineHeight,
      letterSpacing: heroLetterSpacing,
    };
    const heroPrefixStyle: TextStyle = {
      fontSize: heroPrefixSize,
      lineHeight: heroLineHeight,
      letterSpacing: heroLetterSpacing,
      opacity: 1,
      marginRight: HERO_PREFIX_GAP,
    };
    // 尾数与整数同大小：行高/字距也取整数的值，否则 baseline 会错位；
    // 不再降透明度（原 0.7 会让尾数看着比前面"小一号"）
    const heroDecimalsStyle: TextStyle = {
      fontSize: heroDecimalsSize,
      lineHeight: heroLineHeight,
      letterSpacing: heroLetterSpacing,
      opacity: 1,
    };

    const heroContent = (
      <Animated.View
        style={[containerStyle, rowWidthStyle]}
        onLayout={measureWidth}
        accessible={!longPressable}
        accessibilityLabel={longPressable ? undefined : a11yLabel}
      >
        <View style={[styles.row, styles.rowNatural]} onLayout={onNaturalLayout}>
        {heroParts.prefix ? (
          <AppText variant={variant} weight={heroIntWeight} color={resolvedColor} style={[heroPrefixStyle, cellTextStyle]} numberOfLines={1}>
            {heroParts.prefix}
          </AppText>
        ) : null}
        {cells.map((cell) => (
          <RollingCell
            key={cell.key}
            char={cell.char}
            from={cell.from}
            progress={progress}
            startFraction={cell.delay / motion.timing.numberRollTotal}
            enter={cell.enter}
            exit={cell.exit}
            variant={variant}
            weight={heroIntWeight}
            textStyle={[heroIntStyle, cellTextStyle]}
            color={resolvedColor}
          />
        ))}
        {heroParts.decimals ? (
          <AppText variant={variant} weight={heroDecimalWeight ?? heroIntWeight} color={heroDecimalColor ?? resolvedColor} style={[heroDecimalsStyle, cellTextStyle]} numberOfLines={1}>
            {heroParts.decimals}
          </AppText>
        ) : null}
        {heroParts.suffix ? (
          <AppText variant={variant} weight={heroDecimalWeight ?? '300'} color={heroDecimalColor ?? resolvedColor} style={[heroDecimalsStyle, cellTextStyle]} numberOfLines={1}>
            {heroParts.suffix}
          </AppText>
        ) : null}
        {heroMeasureLayer}
        </View>
      </Animated.View>
    );

    if (longPressable && dialog) {
      return (
        <Pressable
          style={containerStyle}
          onLongPress={() => dialog.alert({ title: fullText })}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={fullText}
        >
          {heroContent}
        </Pressable>
      );
    }
    return heroContent;
  }

  // 静态路径（挂载时 / roll 关闭 / 减弱动态效果）：整段一个 Text，最省。
  // ⚠ numberOfLines={1} + ellipsizeMode="clip"：金额恒一行、**永不换行也永不出省略号**，
  //   即便估算失灵也只是裁掉尾巴（正常情况下档位/紧凑格式已经保证放得下）。
  if (!hasRolled) {
    const textEl = (
      <AppText
        variant={variant}
        weight={amountWeight}
        color={resolvedColor}
        style={[sizeStyle, longPressable ? cellTextStyle : style]}
        numberOfLines={1}
        ellipsizeMode="clip"
        onLayout={measureWidth}
        // 包了 Pressable 时无障碍归 Pressable（避免同一金额读两遍）
        accessible={!longPressable}
        accessibilityLabel={longPressable ? undefined : a11yLabel}
      >
        {shownText}
      </AppText>
    );
    const fadedTextEl = rollEnabled && motion.reduceMotion ? <Animated.View style={crossfadeStyle}>{textEl}</Animated.View> : textEl;

    if (longPressable && dialog) {
      return (
        <Pressable
          style={containerStyle}
          onLongPress={() => dialog.alert({ title: fullText })}
          delayLongPress={400}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityHint={fullText}
        >
          {fadedTextEl}
          {measureLayer}
        </Pressable>
      );
    }
    return (
      <>
        {fadedTextEl}
        {measureLayer}
      </>
    );
  }

  return (
    <Animated.View
      style={[containerStyle, rowWidthStyle]}
      onLayout={measureWidth}
      accessible
      accessibilityLabel={a11yLabel}
    >
      <View style={[styles.row, styles.rowNatural]} onLayout={onNaturalLayout}>
      {cells.map((cell) => (
        <RollingCell
          key={cell.key}
          char={cell.char}
          from={cell.from}
          progress={progress}
          startFraction={cell.delay / motion.timing.numberRollTotal}
          enter={cell.enter}
          exit={cell.exit}
          variant={variant}
          weight={amountWeight}
          textStyle={[sizeStyle, cellTextStyle]}
          color={resolvedColor}
        />
      ))}
      {measureLayer}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 一行字符格：底部对齐，数字不会因为格子高度差而错位
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  // 单格：高度由内容（一行文字）决定，超出的滚动层被裁掉
  cell: { overflow: 'hidden' },
  // 旧字符层：绝对定位在格子左上，滚出去就被裁掉
  cellStrip: { position: 'absolute', top: 0, left: 0, right: 0 },
  // 数字行的内层：宽度 = 内容宽（测量用，不被外层动画宽度挤压）
  rowNatural: { alignSelf: 'flex-start' },
  cellGhost: { opacity: 0 },
  // 隐藏测量层：绝对定位 + 透明，只用来量真实宽度（不参与排版）
  measureBox: { position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' },
});

export default MoneyText;
