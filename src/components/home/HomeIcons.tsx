// HomeIcons.tsx
// 首页顶部工具区 + 四个快捷入口共用的矢量图标集。
//
// 为什么不用 Ionicons：参考图里「钱包 + 上下箭头」「双向转移」「四角取景框」没有对应字形，
// 而且这四个入口是双色图标（主笔深 / 副笔浅蓝）。整套自绘才能保证
// 同一网格（24）、同一线宽（1.75）、同一端点风格（round），视觉重量一致。
//
// 规则
// - 只描边不填色；主笔用 color，副笔（箭头、内侧小件）用 secondary；
// - 尺寸只通过 size 缩放，几何永远按 24×24 网格写；
// - 文件内不得出现裸 hex（颜色全部由调用方从 useHomePalette() 传入）。

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { lightSemantic } from '../../theme/theme';

/** 夜间模式：月亮（缺角月牙） */
export function IconMoon(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M20.4 14.6A8.6 8.6 0 1 1 9.4 3.6a6.9 6.9 0 0 0 11 11Z" />
    </IconBase>
  );
}

/** 日间模式：太阳（圆心 + 8 道短射线） */
export function IconSun(p: IconProps) {
  return (
    <IconBase {...p}>
      <Circle cx={12} cy={12} r={4.1} />
      <Path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </IconBase>
  );
}

export type IconProps = {
  size?: number;
  color?: string;
  /** 副笔色，双色图标用 */
  secondary?: string;
  strokeWidth?: number;
};

/** 统一线宽：24 网格下 1.75 = 24dp 图标上的视觉重量与参考图一致 */
const STROKE = 1.75;

/** 兜底主笔色：调用方一律显式传 color，这里只保证不写裸 hex 且默认在浅底上可见 */
const FALLBACK_COLOR = lightSemantic.textPrimary;

type BaseProps = IconProps & { children: React.ReactNode };

/**
 * 所有图标的公共壳：stroke / 线宽 / 端点写在 Svg 上由子元素继承
 * （react-native-svg 会把父级描边属性透传给子元素）。
 */
function IconBase({ size = 24, color, strokeWidth = STROKE, children }: BaseProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? FALLBACK_COLOR}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** 副笔色：显式 secondary > 主笔色（只传单色时也不会糊成一片） */
function secondaryOf(p: IconProps): string {
  return p.secondary ?? p.color ?? FALLBACK_COLOR;
}

/** 钱包「短兜」（支出 / 收入共用）：左壁 + 上下两条边向右伸出、右侧敞开，
 *  箭头就从这条敞开的上沿穿出去（参考图：短兜高约 13/24，右侧缺口是给箭头的）。
 *  Q 画圆角而不是 A：半径方向不依赖 sweep 标志，24 网格上任何缩放都不会翻边。 */
const WALLET_POCKET =
  'M9.2 6.6H6.4C4.5 6.6 3.4 7.9 3.4 9.6V16.6C3.4 18.4 4.6 19.6 6.4 19.6H17.6C19.4 19.6 20.6 18.4 20.6 16.6V9.6C20.6 7.9 19.5 6.6 17.6 6.6H14.8';
/** 短兜左侧的铆钉（参考图里那个很小的实心点） */
const WALLET_RIVET = { cx: 17.4, cy: 13.2, r: 0.9 };
/** 箭头几何：箭杆 x=13.4、长 11.2（4.2→15.4），人字形头部宽 7（9.9→16.9）、高 3.4 */
const ARROW_X = 12;
/** 箭尾（落在兜内） */
const ARROW_TAIL = 15.6;
/** 箭尖（穿出兜口之上） */
const ARROW_TIP = 4.2;
const ARROW_HEAD_HALF = 3.1;
const ARROW_HEAD_RISE = 3.1;

/** 支出：短兜 + 向上箭头（箭头从短兜上沿穿出，箭尖在兜口之上） */
export function IconWalletUp(p: IconProps) {
  const sec = secondaryOf(p);
  return (
    <IconBase {...p}>
      <Path d={WALLET_POCKET} />
      <Circle {...WALLET_RIVET} fill={p.color ?? FALLBACK_COLOR} stroke="none" />
      <Path d={`M${ARROW_X} ${ARROW_TAIL}V${ARROW_TIP}`} stroke={sec} />
      <Path
        d={`M${ARROW_X - ARROW_HEAD_HALF} ${ARROW_TIP + ARROW_HEAD_RISE} ${ARROW_X} ${ARROW_TIP} ${ARROW_X + ARROW_HEAD_HALF} ${ARROW_TIP + ARROW_HEAD_RISE}`}
        stroke={sec}
      />
    </IconBase>
  );
}

/** 收入：同一个短兜 + 向下箭头（箭杆从兜口穿进来，箭尖落在兜里） */
export function IconWalletDown(p: IconProps) {
  const sec = secondaryOf(p);
  return (
    <IconBase {...p}>
      <Path d={WALLET_POCKET} />
      <Circle {...WALLET_RIVET} fill={p.color ?? FALLBACK_COLOR} stroke="none" />
      <Path d={`M${ARROW_X} ${ARROW_TIP}V${ARROW_TAIL}`} stroke={sec} />
      <Path
        d={`M${ARROW_X - ARROW_HEAD_HALF} ${ARROW_TAIL - ARROW_HEAD_RISE} ${ARROW_X} ${ARROW_TAIL} ${ARROW_X + ARROW_HEAD_HALF} ${ARROW_TAIL - ARROW_HEAD_RISE}`}
        stroke={sec}
      />
    </IconBase>
  );
}

/** 转账：两条反向水平箭头（上行向右 = 副笔，下行向左 = 主笔） */
export function IconTransfer(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M3.4 9.2H20.4M17.6 6.4 20.4 9.2 17.6 12" stroke={secondaryOf(p)} />
      <Path d="M20.6 14.8H3.8M6.6 12.2 3.8 14.8 6.6 17.4" />
    </IconBase>
  );
}

/** 扫描：四角取景框（四段 L 形，圆角 2.2） */
export function IconScan(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M3.2 9.6V5.4A2.2 2.2 0 0 1 5.4 3.2H9.6" />
      <Path d="M14.4 3.2H18.6A2.2 2.2 0 0 1 20.8 5.4V9.6" />
      <Path d="M20.8 14.4V18.6A2.2 2.2 0 0 1 18.6 20.8H14.4" />
      <Path d="M9.6 20.8H5.4A2.2 2.2 0 0 1 3.2 18.6V14.4" />
    </IconBase>
  );
}

/** 搜索：圆 + 45° 短柄 */
export function IconSearch(p: IconProps) {
  return (
    <IconBase {...p}>
      <Circle cx={10.9} cy={10.9} r={6.3} />
      <Path d="M15.5 15.5 20.4 20.4" />
    </IconBase>
  );
}

/** 铃铛：钟体（顶弧 + 两侧收窄的裙摆）与下方钟舌 */
export function IconBell(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M6.4 16.9C7.4 15.8 7.8 14.4 7.8 12.9V9.9A4.2 4.2 0 0 1 16.2 9.9V12.9C16.2 14.4 16.6 15.8 17.6 16.9Z" />
      <Path d="M9.9 16.9A2.1 2.1 0 0 0 14.1 16.9" />
    </IconBase>
  );
}

/** 下箭头（账户名药丸用） */
export function IconChevronDown(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M6.8 9.8 12 15 17.2 9.8" />
    </IconBase>
  );
}

/** 右箭头（列表「查看全部」等用） */
export function IconChevronRight(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M9.6 5.8 15.8 12 9.6 18.2" />
    </IconBase>
  );
}

/** 眼睛：显示金额 */
export function IconEye(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M2.8 12C4.9 8.1 8.3 6.1 12 6.1C15.7 6.1 19.1 8.1 21.2 12C19.1 15.9 15.7 17.9 12 17.9C8.3 17.9 4.9 15.9 2.8 12Z" />
      <Circle cx={12} cy={12} r={3.1} />
    </IconBase>
  );
}

/** 眼睛划线：隐藏金额 */
export function IconEyeOff(p: IconProps) {
  return (
    <IconBase {...p}>
      <Path d="M2.8 12C4.9 8.1 8.3 6.1 12 6.1C15.7 6.1 19.1 8.1 21.2 12C19.1 15.9 15.7 17.9 12 17.9C8.3 17.9 4.9 15.9 2.8 12Z" />
      <Circle cx={12} cy={12} r={3.1} />
      <Path d="M4.4 19.6 19.6 4.4" />
    </IconBase>
  );
}
