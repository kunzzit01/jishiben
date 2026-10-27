// CrashGuard.tsx
// 线上闪退定位装置：release 包里未捕获的 JS 异常会把 App 直接关掉、屏幕上什么都看不到。
// 这里做两件事：
//   1) installCrashLogger()：全局 ErrorUtils 兜底，把致命异常（含 stack）写进 AsyncStorage；
//   2) <CrashGuard>：React 渲染期异常显示成一张可读的错误屏，而不是白屏/闪退。
// 目的只有一个 —— 下次再崩，屏幕上就能直接看到是哪一行，不再靠猜。

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CRASH_KEY = '@jizhang/lastCrash';

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name + ': ' + error.message + '\n' + (error.stack ?? '');
  }
  try {
    return String(error);
  } catch {
    return 'unknown error';
  }
}

export async function saveCrash(error: unknown, kind = 'error'): Promise<void> {
  try {
    const text = (new Date().toISOString() + ' [' + kind + ']\n' + describe(error)).slice(0, 4000);
    await AsyncStorage.setItem(CRASH_KEY, text);
  } catch {
    /* 记录本身绝不抛错 */
  }
}

export async function loadCrash(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(CRASH_KEY);
  } catch {
    return null;
  }
}

export async function clearCrash(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CRASH_KEY);
  } catch {
    /* ignore */
  }
}

/** 全局未捕获异常兜底（幂等：多次调用只装一次） */
export function installCrashLogger(): void {
  try {
    const g = globalThis as unknown as {
      __jzCrashInstalled?: boolean;
      ErrorUtils?: {
        getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
        setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
      };
    };
    if (g.__jzCrashInstalled) return;
    const utils = g.ErrorUtils;
    if (!utils?.setGlobalHandler) return;
    const prev = utils.getGlobalHandler?.();
    utils.setGlobalHandler((error, isFatal) => {
      void saveCrash(error, isFatal ? 'fatal' : 'error');
      if (prev) prev(error, isFatal);
    });
    g.__jzCrashInstalled = true;
  } catch {
    /* 兜底装置本身绝不抛错 */
  }
}

type Props = { children: React.ReactNode };
type State = { error: string | null; stored: string | null };

export default class CrashGuard extends React.Component<Props, State> {
  state: State = { error: null, stored: null };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: describe(error) };
  }

  componentDidCatch(error: unknown): void {
    void saveCrash(error, 'render');
  }

  componentDidMount(): void {
    void loadCrash().then((text) => {
      if (text) this.setState({ stored: text });
    });
  }

  private dismiss = (): void => {
    void clearCrash();
    this.setState({ stored: null, error: null });
  };

  render(): React.ReactNode {
    const text = this.state.error ?? this.state.stored;
    if (!text) return this.props.children;
    const isError = !!this.state.error;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>
          {isError ? '应用出错了（现场已记录）' : '上次运行崩溃了（现场已记录）'}
        </Text>
        <ScrollView style={styles.box} contentContainerStyle={styles.boxInner}>
          <Text style={styles.mono} selectable>
            {text}
          </Text>
        </ScrollView>
        <TouchableOpacity style={styles.btn} onPress={this.dismiss} accessibilityRole="button">
          <Text style={styles.btnText}>{isError ? '清除并重试' : '我知道了，清除'}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF', padding: 20, paddingTop: 72 },
  title: { fontSize: 17, fontWeight: '700', color: '#B42318', marginBottom: 12 },
  box: { flex: 1, backgroundColor: '#F5F5F7', borderRadius: 12 },
  boxInner: { padding: 12 },
  mono: { fontSize: 12, lineHeight: 17, color: '#1B1B1F' },
  btn: { marginTop: 16, height: 48, borderRadius: 24, backgroundColor: '#1677FF', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
