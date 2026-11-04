import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 「上一次用的钱包」：记一笔时自动带出的账户。
 *
 * 为什么是模块级 store 而不是组件里的 useState：
 * 同一个值有两个读者——页面初始化 / resetAll 复位（需要**同步**读）与保存成功后的写入。
 * AsyncStorage 是异步的，只靠它在 resetAll 里读会读到旧值（保存完再进来又变回未选择）。
 *
 * 存储单独一个键：它属于本机使用习惯，不跟账本数据一起同步或清空。
 */
const STORAGE_KEY = '@jizhang/recentAssets.v1';

export interface RecentAssets {
  /** 支出最近用过的账户 id */
  expense?: string;
  /** 收入最近用过的账户 id */
  income?: string;
  /** 转账最近用过的「转出」账户 id（转入不记：资金去向让用户自己点一次） */
  transferFrom?: string;
}

export const DEFAULT_RECENT_ASSETS: RecentAssets = {};

let snapshot: RecentAssets = DEFAULT_RECENT_ASSETS;
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function sanitize(raw: unknown): RecentAssets {
  if (!raw || typeof raw !== 'object') return DEFAULT_RECENT_ASSETS;
  const obj = raw as Record<string, unknown>;
  const next: RecentAssets = {};
  if (typeof obj.expense === 'string' && obj.expense) next.expense = obj.expense;
  if (typeof obj.income === 'string' && obj.income) next.income = obj.income;
  if (typeof obj.transferFrom === 'string' && obj.transferFrom) next.transferFrom = obj.transferFrom;
  return next;
}

/** 从磁盘恢复一次（幂等；多处同时触发也只读一次） */
export function hydrateRecentAssets(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      snapshot = raw ? sanitize(JSON.parse(raw)) : DEFAULT_RECENT_ASSETS;
    } catch (e) {
      console.warn('读取最近账户失败', e);
      snapshot = DEFAULT_RECENT_ASSETS;
    } finally {
      hydrated = true;
      emit();
    }
  })();
  return hydration;
}

export function getRecentAssetsSnapshot(): RecentAssets {
  return snapshot;
}

export function subscribeRecentAssets(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 记一笔保存成功后调用：先更新内存快照并通知（resetAll 立刻能同步读到），再落盘。
 * 落盘失败只降级——这只是个便利偏好，不该影响记账本身。
 */
export function rememberRecentAsset(slot: keyof RecentAssets, id: string | null | undefined): void {
  if (!id || snapshot[slot] === id) return;
  const next: RecentAssets = { ...snapshot, [slot]: id };
  snapshot = next;
  hydrated = true;
  emit();
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((e) => console.warn('保存最近账户失败', e));
}

/** 订阅式读取（顺带 hydrate 一次） */
export function useRecentAssets(): RecentAssets {
  const [value, setValue] = useState<RecentAssets>(() => getRecentAssetsSnapshot());
  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (alive) setValue(getRecentAssetsSnapshot());
    };
    const unsubscribe = subscribeRecentAssets(sync);
    void hydrateRecentAssets().then(sync);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return value;
}
