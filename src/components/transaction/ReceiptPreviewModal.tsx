// ReceiptPreviewModal.tsx
// 凭证大图预览（T13 / 计划 A8 抽取）：点键盘条上的收据缩略图放大查看整体。
// 提取自 AddTransactionScreen 里重复两份的 Modal（转账/兑换分支与支出/收入分支），视觉与行为零变化。

import React, { useEffect, useState } from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useBottomSystemInset } from '../../hooks/useBottomSystemInset';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { receiptImageSource } from '../../utils/receiptStore';

interface Props {
  visible: boolean;
  /** 凭证图片 uri；为空时只渲染关闭键 */
  uri: string | null;
  /** 扫票时 AI 指出的总金额位置（0~1 归一化，近似）：有就在大图上画高亮框，方便核对 */
  box?: { x: number; y: number; w: number; h: number } | null;
  onClose: () => void;
}

export function ReceiptPreviewModal({ visible, uri, box, onClose }: Props) {
  const { colors } = useTheme();
  // 响应式：窗口/旋转/分屏变化时重算（原来的 Dimensions.get 只在启动时取一次，
  // 旋转后大图仍按旧宽高画，宽屏上会只剩中间一条、小屏上会顶到状态栏后面）
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSystemInset();
  // 大图区 = 视口高 − 顶部安全区 − 底部安全区 − 关闭键占位（40），最矮也留 160；
  // 宽度收进安全区内（左右各 16），图片仍是 resizeMode="contain"，不会拉伸变形。
  const imageMaxHeight = Math.max(160, windowHeight - insets.top - bottomInset - 40);
  const imageWidth = Math.max(160, windowWidth - 32);
  // 同步回来的凭证是服务端相对路径（receipts/x.jpg），本地是 file://…：都走 receiptImageSource 解析
  const src = receiptImageSource(uri);

  // 要把高亮框准确盖在图上，必须知道图片实际画出来的矩形：先取原图宽高，按 contain 自己算出适配后的尺寸
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setNat(null);
    if (!src || !box) return;
    Image.getSize(
      src,
      (w, h) => setNat({ w, h }),
      () => setNat(null),
    );
  }, [src, box]);
  const maxH = Math.min(imageMaxHeight, windowHeight * 0.8);
  const fit = nat ? Math.min(imageWidth / nat.w, maxH / nat.h) : 0;
  const fitW = nat ? nat.w * fit : 0;
  const fitH = nat ? nat.h * fit : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.receiptViewerOverlay} activeOpacity={1} onPress={onClose}>
        {src && box && nat ? (
          <View style={{ width: fitW, height: fitH }}>
            <Image source={{ uri: src }} style={{ width: fitW, height: fitH }} resizeMode="contain" />
            <View
              pointerEvents="none"
              style={[
                styles.amountBox,
                {
                  left: Math.max(0, box.x * fitW - 6),
                  top: Math.max(0, box.y * fitH - 5),
                  width: box.w * fitW + 12,
                  height: box.h * fitH + 10,
                },
              ]}
            />
            <Text style={styles.amountBoxHint}>黄框 = AI 认为的总金额位置（大致）</Text>
          </View>
        ) : (
          src && (
            <Image
              source={{ uri: src }}
              style={[styles.receiptViewerImage, { width: imageWidth, maxHeight: imageMaxHeight }]}
              resizeMode="contain"
            />
          )
        )}
        <TouchableOpacity
          style={[styles.receiptViewerCloseBtn, { top: insets.top + 8 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color={colors.bg} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  receiptViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 宽 / 高在渲染期内联给（来自 useWindowDimensions + 安全区），这里只留不变的部分
  receiptViewerImage: {
    height: '80%',
  },
  amountBox: {
    position: 'absolute',
    borderWidth: 2.5,
    borderColor: '#FFD54A',
    borderRadius: 6,
    backgroundColor: 'rgba(255,213,74,0.18)',
  },
  amountBoxHint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -26,
    textAlign: 'center',
    color: '#FFD54A',
    fontSize: 12,
  },
  // 关闭键贴着顶部安全区下沿（原来的 top: 50 是按刘海机型写死的，矮状态栏机型会压到卡片上）
  receiptViewerCloseBtn: {
    position: 'absolute',
    right: 20,
  },
});

export default ReceiptPreviewModal;
