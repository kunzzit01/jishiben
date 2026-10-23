/**
 * 自研后端（Spring Boot）接入配置。
 *
 * 唯一来源是 `EXPO_PUBLIC_API_BASE_URL`（Expo 会把 EXPO_PUBLIC_ 前缀的变量内联进包）。
 * 这里**没有任何密钥**：访问令牌只存在内存 + AsyncStorage，服务端密钥只在服务器 .env 里。
 *
 * 本地联调注意：
 * - iOS 模拟器 / Web：http://localhost:8080
 * - Android 模拟器：http://10.0.2.2:8080（模拟器里的 localhost 指向模拟器自己）
 * - 真机：http://<你电脑的局域网 IP>:8080
 */
const DEFAULT_API_BASE_URL = 'http://localhost:8080';

function readBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL;
  const value = typeof raw === 'string' ? raw.trim() : '';
  // 同源部署：容器里前端静态文件与 /api 由同一个 nginx 提供，base 取空串即可
  // （请求会变成 /api/xxx，由 nginx 反代到 api:8080；既没有 CORS，也不依赖具体域名）
  if (value === '/' || value === 'same-origin') return '';
  const base = value || DEFAULT_API_BASE_URL;
  // 去掉结尾斜杠，拼路径时统一由调用方加 /api/...
  return base.replace(/\/+$/, '');
}

export const API_BASE_URL: string = readBaseUrl();

/** 登录有效期：连续多少天没有打开过 App，就需要重新登录（安全要求：14 天） */
export const INACTIVITY_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

/** 单个请求的超时（毫秒）。避免弱网时 fetch 挂住整个同步流程。 */
export const API_TIMEOUT_MS = 20_000;

/** 访问令牌提前多少毫秒视为"即将过期"，主动刷新（避免每个请求都先吃一个 401）。 */
export const TOKEN_REFRESH_MARGIN_MS = 60_000;
