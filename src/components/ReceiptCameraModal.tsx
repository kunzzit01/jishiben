import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

interface ReceiptCameraModalProps {
  visible: boolean;
  /** 扫描小票（OCR）流程需要 base64 去调识别接口；单纯留档的"附凭证"流程不需要 */
  withBase64?: boolean;
  onClose: () => void;
  onCapture: (photo: { uri: string; base64?: string }) => void;
  /** 底部"相册"按钮：直接交给调用方处理（复用它已有的 pickFromLibrary 逻辑），这个组件不管相册选择 */
  onPickFromLibrary: () => void;
}

/**
 * 自绘拍小票的相机页面，替代 expo-image-picker 的 launchCameraAsync（那个调起来是
 * 系统相机App，没有任何样式接口）。用 expo-camera 的 CameraView 自己画：
 * 顶部关闭+闪光灯，中间小票对齐框，底部相册+快门。
 *
 * 依赖：项目需要先跑 `npx expo install expo-camera`，
 * 并在 app.json 的 plugins 里加上 "expo-camera"（用于自动生成相机权限描述）。
 */
export function ReceiptCameraModal({
  visible,
  withBase64,
  onClose,
  onCapture,
  onPickFromLibrary,
}: ReceiptCameraModalProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSystemInset();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.6, base64: withBase64 });
      if (photo) onCapture({ uri: photo.uri, base64: photo.base64 });
    } catch {
      // 拍照失败就留在相机页让用户再试一次，不额外弹提示打断操作
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {visible && permission?.granted && (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" flash={flash} />
        )}

        {/* 没给权限时的引导页，不是黑屏也不是系统弹窗 */}
        {visible && !permission?.granted && (
          <View style={[styles.permissionWrap, { paddingTop: insets.top + 40 }]}>
            <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.permissionText, { color: colors.textPrimary }]}>需要相机权限才能拍小票</Text>
            <Pressable
              style={[styles.permissionBtn, { backgroundColor: colors.fabBg }]}
              onPress={requestPermission}
            >
              <Text style={[styles.permissionBtnText, { color: colors.fabIcon }]}>去授权</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 16 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 13 }}>取消</Text>
            </Pressable>
          </View>
        )}

        {/* 顶部：关闭 + 闪光灯 */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable style={styles.topBtn} onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          {permission?.granted && (
            <Pressable style={styles.topBtn} onPress={() => setFlash((f) => (f === 'off' ? 'on' : 'off'))} hitSlop={10}>
              <Ionicons name={flash === 'on' ? 'flash' : 'flash-off'} size={20} color="#fff" />
            </Pressable>
          )}
        </View>

        {/* 底部：相册 + 快门 */}
        {permission?.granted && (
          <View style={[styles.bottomBar, { paddingBottom: bottomInset + 20 }]}>
            <Pressable style={styles.sideBtn} onPress={onPickFromLibrary} hitSlop={10}>
              <Ionicons name="images-outline" size={24} color="#fff" />
              <Text style={styles.sideBtnText}>相册</Text>
            </Pressable>

            <Pressable
              style={[styles.shutterOuter, capturing && { opacity: 0.6 }]}
              onPress={handleCapture}
              disabled={capturing}
            >
              <View style={[styles.shutterInner, { backgroundColor: colors.fabBg }]} />
            </Pressable>

            {/* 右边留一个等宽的占位，保证快门按钮视觉居中 */}
            <View style={styles.sideBtn} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
  },
  sideBtn: { width: 56, alignItems: 'center' },
  sideBtnText: { color: '#fff', fontSize: 11, marginTop: 4 },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#111',
  },
  permissionText: { marginTop: 14, fontSize: 14 },
  permissionBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
  permissionBtnText: { fontSize: 14, fontWeight: '700' },
});
