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
 * 本地提醒的前置条件：通知权限 + Android 通知渠道。
 *
 * 为什么必须有：原来只有「注册推送 token」那条路会 requestPermissionsAsync / setNotificationChannelAsync，
 * 而本地提醒（记一笔 21:00 / 还款日 / 月末总结）走的是另一条路，于是：
 *   · Android 13+ 没请求过 POST_NOTIFICATIONS → 系统直接丢弃（用户表现：一条都不弹）
 *   · Android 8+ 没有渠道 → 通知没有归属渠道，静默或被丢
 * 这里在排期前兜底做一次（幂等：已授权时只是读状态）。
 */
export async function ensureLocalReminderReady(): Promise<{ granted: boolean; channelId: string }> {
  const channelId = 'reminders';
  if (!NotificationsModule) return { granted: false, channelId };
  try {
    let status = (await NotificationsModule.getPermissionsAsync()).status;
    if (status !== 'granted') {
      status = (await NotificationsModule.requestPermissionsAsync()).status;
    }
    if (Platform.OS === 'android') {
      for (const id of [channelId, 'default']) {
        await NotificationsModule.setNotificationChannelAsync(id, {
          name: id === channelId ? '记账提醒' : 'default',
          importance: NotificationsModule.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
        });
      }
    }
    return { granted: status === 'granted', channelId };
  } catch (e) {
    console.warn('本地提醒前置检查失败', e);
    return { granted: false, channelId };
  }
}

/**
 * 本地通知调度(不依赖推送 token):财务规划的付款提醒等本地提醒用这个。
 * 返回系统分配的 notification id:只有拿到它才能事后取消,所以调用方要留存。
 * Expo Go 里安静跳过;development build 正常。
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerDate: Date
): Promise<string | null> {
  if (!NotificationsModule) return null;
  const ready = await ensureLocalReminderReady();
  if (!ready.granted) {
    console.warn('通知权限未授予，本地提醒无法显示');
    return null;
  }
  try {
    return await NotificationsModule.scheduleNotificationAsync({
      content: { title, body },
      // DateTriggerInput 的 type 是数字枚举,直接用模块内引用保证类型一致
      trigger: {
        type: (require('expo-notifications') as NotificationsModule).SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: ready.channelId,
      } as Parameters<NotificationsModule['scheduleNotificationAsync']>[0]['trigger'],
    });
  } catch (e) {
    console.warn('本地通知调度失败', e);
    return null;
  }
}

/**
 * 按 id 取消一条还没触发的通知。
 * id 可能已经触发过或被系统清理掉,取消失败只记日志:取消是清理动作,
 * 不该因为某条已不存在就让调用方中断后续清理。
 */
export async function cancelScheduledNotification(id: string): Promise<void> {
  if (!NotificationsModule) return;
  try {
    await NotificationsModule.cancelScheduledNotificationAsync(id);
  } catch (e) {
    console.warn('取消本地通知失败', id, e);
  }
}

/**
 * 批量取消。逐条走 cancelScheduledNotification,单条失败不影响其余 id。
 */
export async function cancelScheduledNotifications(ids: string[]): Promise<void> {
  for (const id of ids) {
    await cancelScheduledNotification(id);
  }
}

/**
 * 读出当前所有已排期通知的 id,给清理/去重逻辑用。
 * 模块不可用(Expo Go)时返回空数组,调用方不用自己判断环境。
 */
export async function getScheduledNotificationIds(): Promise<string[]> {
  if (!NotificationsModule) return [];
  try {
    const scheduled = await NotificationsModule.getAllScheduledNotificationsAsync();
    return scheduled.map((request) => request.identifier);
  } catch (e) {
    console.warn('读取已排期通知失败', e);
    return [];
  }
}
