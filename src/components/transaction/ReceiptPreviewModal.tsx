// ReceiptPreviewModal.tsx
// 凭证大图预览（T13 / 计划 A8 抽取）：点键盘条上的收据缩略图放大查看整体。
// 提取自 AddTransactionScreen 里重复两份的 Modal（转账/兑换分支与支出/收入分支），视觉与行为零变化。

import React from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';

interface Props {
  visible: boolean;
  /** 凭证图片 uri；为空时只渲染关闭键 */
  uri: string | null;
  onClose: () => void;
}

export function ReceiptPreviewModal({ visible, uri, onClose }: Props) {
  const { colors } = useTheme();
  // 响应式：窗口/旋转/分屏变化时重算（原来的 Dimensions.get 只在启动时取一次，
  // 旋转后大图仍按旧宽高画，宽屏上会只剩中间一条、小屏上会顶到状态栏后面）
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // 大图区 = 视口高 − 顶部安全区 − 底部安全区 − 关闭键占位（40），最矮也留 160；
  // 宽度收进安全区内（左右各 16），图片仍是 resizeMode="contain"，不会拉伸变形。
  const imageMaxHeight = Math.max(160, windowHeight - insets.top - insets.bottom - 40);
  const imageWidth = Math.max(160, windowWidth - 32);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.receiptViewerOverlay} activeOpacity={1} onPress={onClose}>
        {uri && (
          <Image
            source={{ uri }}
            style={[styles.receiptViewerImage, { width: imageWidth, maxHeight: imageMaxHeight }]}
            resizeMode="contain"
          />
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
  // 关闭键贴着顶部安全区下沿（原来的 top: 50 是按刘海机型写死的，矮状态栏机型会压到卡片上）
  receiptViewerCloseBtn: {
    position: 'absolute',
    right: 20,
  },
});

export default ReceiptPreviewModal;
