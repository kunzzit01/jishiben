import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../services/apiClient';
import { getAccessToken } from '../services/sessionStore';

// 是否在 Expo Go 里跑（不是 development build / 正式安装包）。
// 注意：Expo Go（Android, SDK 53+）在 import expo-notifications 的模块加载阶段
// 就会直接抛 "Android Push notifications (remote) ... removed from Expo Go"，
// 这个错误发生在 require 期，try/catch 拦不住。所以整个模块延迟加载：
// Expo Go 里永远不执行 require，所有通知函数安静跳过；development build 正常。
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type NotificationsModule = typeof import('expo-notifications');

function loadNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  return require('expo-notifications') as NotificationsModule;
}

const NotificationsModule = loadNotifications();

if (NotificationsModule) {
  // 前台收到通知时的展示方式
  NotificationsModule.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * 请求权限并拿到 Expo Push Token。
 * 必须在真机上运行，模拟器拿不到有效token。
 * 在 Expo Go 里会直接跳过并返回 null，要用 development build 才会真正执行。
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isExpoGo) {
    console.warn('当前是Expo Go环境，推送token功能不可用，需要development build才能测试');
    return null;
  }
  if (!NotificationsModule) {
    console.warn('通知模块未加载');
    return null;
  }

  if (!Device.isDevice) {
    console.warn('推送通知必须在真机上测试');
    return null;
  }

  const { status: existingStatus } = await NotificationsModule.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await NotificationsModule.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('用户拒绝了推送通知权限');
    return null;
  }

  // projectId 来自 app.json / eas.json 里的 EAS 项目配置
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('找不到 EAS projectId,请确认已经跑过 eas build:configure');
    return null;
  }

  const tokenData = await NotificationsModule.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  if (Platform.OS === 'android') {
    await NotificationsModule.setNotificationChannelAsync('default', {
      name: 'default',
      importance: NotificationsModule.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return token;
}

/**
 * 把拿到的 token 发给自研后端保存起来（POST /api/push-tokens），后端之后就能用这个 token 推消息。
 * 身份用当前会话的访问令牌证明：服务端按令牌解析账户，不信任客户端自报的 userId。
 * 未登录时整体跳过（推送是可选能力，不影响记账）。
 */
export async function sendTokenToBackend(token: string) {
  if (!getAccessToken()) {
    console.warn('未登录，跳过推送token注册');
    return;
  }
  try {
    await api.registerPushToken(token, Platform.OS);
  } catch (err) {
    console.warn('推送token注册失败', err);
  }
}

/**
 * 监听收到的通知(前台)和用户点击通知(不管前台/后台)。
 * 返回一个清理函数,记得在组件卸载时调用。
 */
type ExpoNotification = import('expo-notifications').Notification;
type ExpoNotificationResponse = import('expo-notifications').NotificationResponse;

export function addNotificationListeners(
  onReceive: (notification: ExpoNotification) => void,
  onTap: (response: ExpoNotificationResponse) => void
) {
  // Expo Go 里通知模块未加载，直接返回空清理函数
  if (!NotificationsModule) {
    console.warn('Expo Go 环境跳过通知监听');
    return () => {};
  }
  const receivedSub = NotificationsModule.addNotificationReceivedListener(onReceive);
  const responseSub = NotificationsModule.addNotificationResponseReceivedListener(onTap);

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

/**
 * 使用示例(比如放在 App.tsx 里,用户登录成功之后):
 *
 * useEffect(() => {
 *   (async () => {
 *     const token = await registerForPushNotificationsAsync();
 *     if (token) {
 *       await sendTokenToBackend(token, currentUserId);
 *     }
 *   })();
 *
 *   const cleanup = addNotificationListeners(
 *     (notification) => console.log('收到通知', notification),
 *     (response) => console.log('用户点击了通知', response)
 *   );
 *
 *   return cleanup;
 * }, []);
 */

/**
 * 本地通知调度(不依赖推送 token):财务规划的付款提醒等本地提醒用这个。
 * Expo Go 里安静跳过;development build 正常。
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerDate: Date
): Promise<void> {
  if (!NotificationsModule) return;
  try {
    await NotificationsModule.scheduleNotificationAsync({
      content: { title, body },
      // DateTriggerInput 的 type 是数字枚举,直接用模块内引用保证类型一致
      trigger: {
        type: (require('expo-notifications') as NotificationsModule).SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
      } as Parameters<NotificationsModule['scheduleNotificationAsync']>[0]['trigger'],
    });
  } catch (e) {
    console.warn('本地通知调度失败', e);
  }
}
