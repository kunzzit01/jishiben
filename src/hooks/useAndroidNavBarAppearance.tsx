// useAndroidNavBarAppearance.ts
// Android 系统导航栏外观（导航按钮明暗）跟随应用主题。
//
// 为什么不用 app.json 里的静态配置：expo-navigation-bar 的 style 是构建期定死的，
// 应用内切换 Light/Dark 后系统导航按钮会与背景撞色（白底白键 / 黑底黑键），按钮看不清。
//
// SDK 57 的 API 已经改成声明式（旧的 setButtonStyleAsync / setBackgroundColorAsync 已移除）：
//   <NavigationBar style="light" />  → 浅色按钮（用于深色背景）
//   <NavigationBar style="dark"  />  → 深色按钮（用于浅色背景）
// 约束（对齐需求）：不隐藏系统导航按钮（不传 hidden）、不使用沉浸模式。
import React from 'react';
import { Platform } from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { useTheme } from '../theme/useTheme';

export function AndroidNavBarAppearance(): React.ReactElement | null {
  const { isDark } = useTheme();
  if (Platform.OS !== 'android') return null;
  // 'light' = 浅色按钮（暗背景）；'dark' = 深色按钮（亮背景）
  return <NavigationBar style={isDark ? 'light' : 'dark'} />;
}
