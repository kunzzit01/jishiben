import { useEffect } from 'react';
import {
  registerForPushNotificationsAsync,
  sendTokenToBackend,
  addNotificationListeners,
} from '../utils/notifications';

/**
 * 注册推送通知：
 * - token 的用户归属由后端从登录会话验签得出（见 notifications.ts 的 sendTokenToBackend），
 *   未登录（没有访问令牌）时自动跳过
 * - registerForPushNotificationsAsync 在 Expo Go 里拿不到有效 token，会安静跳过；
 *   要在 development build / 正式包里才会真正生效
 * - 同时挂载通知监听器（收到通知 / 用户点击通知），组件卸载时自动清理
 */
export function useNotificationSetup() {
  useEffect(() => {
    (async () => {
      try {
        const token = await registerForPushNotificationsAsync();
        if (token) {
          await sendTokenToBackend(token);
        }
      } catch (e) {
        console.warn('推送通知注册失败', e);
      }
    })();

    const cleanup = addNotificationListeners(
      (notification) => console.log('收到通知', notification),
      (response) => console.log('用户点击了通知', response)
    );
    return cleanup;
  }, []);
}
