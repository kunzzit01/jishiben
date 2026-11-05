// avatarStore.ts —— 自定义头像的唯一来源。
// 为什么要有它：个人中心与设置页是两个页面，各自 useAsyncStorage 读取会出现
// 「里面换了、外面还是旧的」。这里用一个模块级快照 + 订阅，任一处修改，两处同时更新。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const AVATAR_KEY = '@jizhang/avatar';
const CUSTOM_KEY = '@jizhang/avatarCustom';

let customUri: string | null = null;
let custom = false;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export async function hydrateAvatar(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const [uri, flag] = await Promise.all([
      AsyncStorage.getItem(AVATAR_KEY),
      AsyncStorage.getItem(CUSTOM_KEY),
    ]);
    customUri = uri;
    custom = flag === '1';
  } catch {
    customUri = null;
    custom = false;
  }
  emit();
}

/** 用户自己选了一张照片（立即持久化并广播，两处界面同时换） */
export async function setCustomAvatar(uri: string): Promise<void> {
  customUri = uri;
  custom = true;
  emit();
  try {
    await AsyncStorage.setItem(AVATAR_KEY, uri);
    await AsyncStorage.setItem(CUSTOM_KEY, '1');
  } catch {
    /* 存储失败不影响本次显示 */
  }
}

/** 恢复使用 Google 头像 */
export async function clearCustomAvatar(): Promise<void> {
  customUri = null;
  custom = false;
  emit();
  try {
    await AsyncStorage.removeItem(AVATAR_KEY);
    await AsyncStorage.removeItem(CUSTOM_KEY);
  } catch {
    /* 忽略 */
  }
}

export function getCustomAvatar(): { uri: string | null; custom: boolean } {
  return { uri: customUri, custom };
}

export function useCustomAvatar(): { uri: string | null; custom: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    void hydrateAvatar();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { uri: customUri, custom };
}
