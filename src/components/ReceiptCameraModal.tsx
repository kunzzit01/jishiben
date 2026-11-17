import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
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

/** 成片比例：相机传感器的原生比例。预览框与拍后确认图都按它画，所见即所得 */
const PHOTO_RATIO = 3 / 4; // 宽 / 高（竖拍）
/** 拍照质量：识别要看清手写与小字，比之前的 0.6 高一档（上传前服务端会再缩放） */
const CAPTURE_QUALITY = 0.9;
const TOP_BAR_H = 56;
const BOTTOM_BAR_H = 150;
const CORNER = 26;

interface Shot {
  uri: string;
  base64?: string;
  width: number;
  height: number;
}

/**
 * 自绘拍小票的相机页面，替代 expo-image-picker 的 launchCameraAsync（那个调起来是
 * 系统相机 App，没有任何样式接口）。
 *
 * 设计要点：
 * 1) **预览框 = 成片**：之前预览铺满全屏（约 20:9），而 takePictureAsync 出的是传感器 4:3 整幅，
 *    所以拍完打开照片，范围和拍的时候看到的对不上。现在预览固定成 4:3 的框（Android 另设 ratio="4:3"），
 *    框里看到什么，成片就是什么。
 * 2) 拍完先进「确认页」：用与成片同一比例显示整张照片，看清了再「使用」，糊了就「重拍」，
 *    不会把一张看不清手写金额的照片直接送去识别。
 * 3) 点一下画面重新对焦（带对焦圈）；暗处可开补光灯；框角 + 提示语告诉用户怎么拍最准。
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
  const { width: winW, height: winH } = useWindowDimensions();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [autofocus, setAutofocus] = useState<'on' | 'off'>('on');
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);

  // 每次打开都回到取景状态（不残留上一张）
  useEffect(() => {
    if (visible) {
      setShot(null);
      setReady(false);
      setTorch(false);
    }
  }, [visible]);

  // 预览框尺寸：宽度尽量占满，高度按 4:3 算；屏幕矮就按可用高度反推宽度
  const topH = insets.top + TOP_BAR_H;
  const bottomH = bottomInset + BOTTOM_BAR_H;
  const availH = Math.max(200, winH - topH - bottomH);
  const boxW = Math.min(winW, availH * PHOTO_RATIO);
  const boxH = boxW / PHOTO_RATIO;

  // 快门反馈
  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  // 对焦圈
  const ringScale = useSharedValue(1.5);
  const ringOpacity = useSharedValue(0);
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value, transform: [{ scale: ringScale.value }] }));

  const handleTapFocus = useCallback(
    (x: number, y: number) => {
      setFocusPoint({ x, y });
      ringScale.value = 1.5;
      ringOpacity.value = 1;
      ringScale.value = withSpring(1, { damping: 14, stiffness: 220 });
      ringOpacity.value = withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 250 }));
      // expo-camera 没有「对某个点对焦」的接口：把自动对焦关掉再打开，会让相机重新对一次焦
      setAutofocus('off');
      setTimeout(() => setAutofocus('on'), 60);
    },
    [ringOpacity, ringScale],
  );

  const handleCapture = async () => {
    if (!cameraRef.current || capturing || !ready) return;
    setCapturing(true);
    shutterScale.value = withSequence(withTiming(0.88, { duration: 70 }), withSpring(1, { damping: 12 }));
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: CAPTURE_QUALITY, base64: withBase64 });
      if (photo) {
        setShot({ uri: photo.uri, base64: photo.base64, width: photo.width, height: photo.height });
      }
    } catch {
      // 拍照失败就留在相机页让用户再试一次，不额外弹提示打断操作
    } finally {
      setCapturing(false);
    }
  };

  const granted = !!permission?.granted;
  // 确认页用成片自己的宽高比（不假设一定是 4:3），再塞进同一个框里，所以和拍的时候一样大
  const shotRatio = shot && shot.width > 0 && shot.height > 0 ? shot.width / shot.height : PHOTO_RATIO;
  const reviewW = Math.min(boxW, boxH * shotRatio);
  const reviewH = reviewW / shotRatio;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        {/* 没给权限时的引导页，不是黑屏也不是系统弹窗 */}
        {visible && !granted && (
          <View style={[styles.permissionWrap, { paddingTop: insets.top + 80 }]}>
            <Ionicons name="camera-outline" size={40} color={colors.textTertiary} />
            <Text style={[styles.permissionText, { color: colors.textPrimary }]}>需要相机权限才能拍小票</Text>
            <Pressable style={[styles.permissionBtn, { backgroundColor: colors.fabBg }]} onPress={requestPermission}>
              <Text style={[styles.permissionBtnText, { color: colors.fabIcon }]}>去授权</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 16 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 13 }}>取消</Text>
            </Pressable>
          </View>
        )}

        {/* 顶部：关闭 + 标题 + 补光灯 */}
        <View style={[styles.topBar, { paddingTop: insets.top, height: topH }]}>
          <Pressable style={styles.topBtn} onPress={onClose} hitSlop={10} accessibilityLabel="关闭">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.title}>{shot ? '确认照片' : '拍小票'}</Text>
          {granted && !shot ? (
            <Pressable
              style={[styles.topBtn, torch && styles.topBtnOn]}
              onPress={() => setTorch((v) => !v)}
              hitSlop={10}
              accessibilityLabel="补光灯"
            >
              <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={19} color={torch ? '#111' : '#fff'} />
            </Pressable>
          ) : (
            <View style={styles.topBtn} />
          )}
        </View>

        {/* 取景 / 确认：同一个框 */}
        {granted && (
          <View style={[styles.stage, { top: topH, bottom: bottomH }]}>
            {!shot ? (
              <View style={[styles.box, { width: boxW, height: boxH }]}>
                {visible && (
                  <CameraView
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    enableTorch={torch}
                    autofocus={autofocus}
                    // Android 的预览/成片比例要显式指定；iOS 默认就是 4:3
                    {...(Platform.OS === 'android' ? { ratio: '4:3' as const } : null)}
                    onCameraReady={() => setReady(true)}
                  />
                )}
                {/* 点按对焦层 */}
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={(e) => handleTapFocus(e.nativeEvent.locationX, e.nativeEvent.locationY)}
                  accessibilityLabel="点按对焦"
                />
                {focusPoint && (
                  <Animated.View
                    pointerEvents="none"
                    style={[styles.focusRing, { left: focusPoint.x - 30, top: focusPoint.y - 30 }, ringStyle]}
                  />
                )}
                {/* 对齐框：四个角 + 提示语（不挡画面） */}
                <View pointerEvents="none" style={styles.guide}>
                  <View style={[styles.corner, styles.cTL]} />
                  <View style={[styles.corner, styles.cTR]} />
                  <View style={[styles.corner, styles.cBL]} />
                  <View style={[styles.corner, styles.cBR]} />
                </View>
                <View pointerEvents="none" style={styles.hintWrap}>
                  <Text style={styles.hint}>把整张小票放进框内 · 手写金额也要拍清楚</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.box, { width: boxW, height: boxH, alignItems: 'center', justifyContent: 'center' }]}>
                <Image source={{ uri: shot.uri }} style={{ width: reviewW, height: reviewH }} resizeMode="contain" />
              </View>
            )}
          </View>
        )}

        {/* 底部 */}
        {granted && !shot && (
          <View style={[styles.bottomBar, { height: bottomH, paddingBottom: bottomInset + 20 }]}>
            <Pressable style={styles.sideBtn} onPress={onPickFromLibrary} hitSlop={10}>
              <Ionicons name="images-outline" size={24} color="#fff" />
              <Text style={styles.sideBtnText}>相册</Text>
            </Pressable>

            <Pressable onPress={handleCapture} disabled={capturing || !ready} accessibilityLabel="拍照">
              <Animated.View style={[styles.shutterOuter, (!ready || capturing) && { opacity: 0.5 }, shutterStyle]}>
                <View style={[styles.shutterInner, { backgroundColor: colors.fabBg }]} />
              </Animated.View>
            </Pressable>

            {/* 右边留一个等宽的占位，保证快门按钮视觉居中 */}
            <View style={styles.sideBtn} />
          </View>
        )}

        {granted && shot && (
          <View style={[styles.bottomBar, { height: bottomH, paddingBottom: bottomInset + 20 }]}>
            <Pressable style={styles.reviewGhost} onPress={() => setShot(null)} hitSlop={8}>
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.reviewGhostText}>重拍</Text>
            </Pressable>
            <Pressable
              style={[styles.reviewPrimary, { backgroundColor: colors.fabBg }]}
              onPress={() => onCapture({ uri: shot.uri, base64: shot.base64 })}
              hitSlop={8}
            >
              <Ionicons name="checkmark" size={20} color={colors.fabIcon} />
              <Text style={[styles.reviewPrimaryText, { color: colors.fabIcon }]}>使用照片</Text>
            </Pressable>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  topBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBtnOn: { backgroundColor: '#FFD54A' },
  stage: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  box: { overflow: 'hidden', borderRadius: 14, backgroundColor: '#000' },
  guide: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, margin: 14 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: 'rgba(255,255,255,0.92)' },
  cTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  cTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  hintWrap: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  hint: {
    color: '#fff',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  focusRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#FFD54A',
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
  shutterInner: { width: 58, height: 58, borderRadius: 29 },
  reviewGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 22,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  reviewGhostText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  reviewPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 28,
    height: 48,
    borderRadius: 24,
  },
  reviewPrimaryText: { fontSize: 15, fontWeight: '700' },
  permissionWrap: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#111',
  },
  permissionText: { marginTop: 14, fontSize: 14 },
  permissionBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12 },
  permissionBtnText: { fontSize: 14, fontWeight: '700' },
});
