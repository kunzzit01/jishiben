// i18n 实例：i18n-js 单例 + 语言模式。
// 默认跟随系统语言（zh/en 之外的语系回退中文），用户可在设置里手动指定并持久化。
import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';
import { zh } from './zh';
import { en } from './en';

export type LangMode = 'system' | 'zh' | 'en';
export type ResolvedLang = 'zh' | 'en';
export type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

const i18n = new I18n({ zh, en });
i18n.enableFallback = true;
i18n.defaultLocale = 'zh';

// 设备语言（只在旧存档 'system' 的迁移里用）
const deviceLang = Localization.getLocales()[0]?.languageTag ?? 'zh';

/** 无存档时的默认语言：中文（与设置页的默认选中项一致） */
export const DEFAULT_LANG: ResolvedLang = 'zh';

// 初始 locale 必须与默认语言一致：
// 以前这里按设备语言初始化，于是英文手机上「设置里显示中文、界面却是英文」——
// 因为 Provider 在没有任何存档时不会调用 applyLangMode（用户 2026-10-29 报的 bug）。
i18n.locale = DEFAULT_LANG;

/** 切换语言（跟随系统时按设备语言解析） */
export function applyLangMode(mode: LangMode) {
  i18n.locale =
    mode === 'system'
      ? deviceLang.toLowerCase().startsWith('zh')
        ? 'zh'
        : 'en'
      : mode;
}

/** 全局翻译函数：直接用 i18n 实例的 t（界面组件经 useT() 拿到同一实例） */
export const t: TranslateFunction = (key, params) => (params ? i18n.t(key, params) : i18n.t(key));

export { i18n };