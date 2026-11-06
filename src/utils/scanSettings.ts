// scanSettings.ts —— 「扫票识别 → 服务端 OCR 兜底」的唯一设置来源。
//
// 为什么单独一个 store：开关和密钥在设置页改，上传发生在扫票时（记一笔页），
// 两处必须看到同一份快照，否则「刚打开开关却还要等下一次冷启动才生效」。
// 写法与 avatarStore / amountCategory 一致：模块级快照 + 订阅。
//
// 隐私优先的三条硬约束（改代码前先读）：
// 1) 默认关闭、密钥默认空 —— 也就是默认永不上传；
// 2) 开关打开但**没有密钥**同样不上传（isServerOcrUsable 是唯一判据）；
// 3) 只有本地识别拿不准时才可能用到它（判定在 scanReceipt 里，不在这里）。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/** 持久化键（v1：结构变化换版本号，不做跨版本迁移 —— 默认值就是「不上传」） */
export const SERVER_OCR_STORAGE_KEY = '@jizhang/scan.serverOcr.v1';

export interface ServerOcrSettings {
  /** 是否允许「本地识别不准时上传原图」——默认关闭 */
  enabled: boolean;
  /** 服务端共享密钥（请求头 X-OCR-Key）；空串 = 永不上传 */
  key: string;
}

/** 默认值：关闭 + 空密钥（= 不上传）。不要改成 true。 */
const DEFAULTS: ServerOcrSettings = { enabled: false, key: '' };

let snapshot: ServerOcrSettings = DEFAULTS;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

/** 把存储里的任意值收敛成合法设置（脏数据 / 缺字段都回落到「不上传」） */
function normalize(raw: unknown): ServerOcrSettings {
  if (!raw || typeof raw !== 'object') return DEFAULTS;
  const o = raw as { enabled?: unknown; key?: unknown };
  return {
    enabled: o.enabled === true,
    key: typeof o.key === 'string' ? o.key.trim() : '',
  };
}

async function readFromStorage(): Promise<void> {
  try {
    const text = await AsyncStorage.getItem(SERVER_OCR_STORAGE_KEY);
    snapshot = text ? normalize(JSON.parse(text)) : DEFAULTS;
  } catch {
    snapshot = DEFAULTS;
  }
  emit();
}

let hydrateInFlight: Promise<void> | null = null;

/** 读一次持久化值。并发调用共享同一个 Promise（水合完成前 getServerOcrSettings 给的是默认值）。 */
export function hydrateServerOcrSettings(): Promise<void> {
  if (!hydrateInFlight) hydrateInFlight = readFromStorage();
  return hydrateInFlight;
}

/** 同步快照（未水合前＝默认值＝关闭且无密钥，即「不上传」）。 */
export function getServerOcrSettings(): ServerOcrSettings {
  return snapshot;
}

/** 改一部分：先更新快照并广播（界面立刻变），再落盘（存储失败不回滚，下次启动回默认值）。 */
export async function setServerOcrSettings(patch: Partial<ServerOcrSettings>): Promise<void> {
  snapshot = normalize({ ...snapshot, ...patch });
  emit();
  try {
    await AsyncStorage.setItem(SERVER_OCR_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* 存储失败不影响本次会话内的开关状态 */
  }
}

/** 是否具备上传条件：开关打开 **且** 有密钥。只有它为 true 时才允许上传图片。 */
export function isServerOcrUsable(settings: ServerOcrSettings = snapshot): boolean {
  return settings.enabled === true && settings.key.trim().length > 0;
}

/** 订阅式读取（设置页用）：快照变化时自动重渲染；首次挂载触发水合。 */
export function useServerOcrSettings(): ServerOcrSettings {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    void hydrateServerOcrSettings();
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return snapshot;
}
