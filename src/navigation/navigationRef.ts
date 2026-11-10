// 全局导航句柄：给挂在 NavigationContainer 之外的界面（如会员页 Modal）跳转用。
import { createNavigationContainerRef } from '@react-navigation/native';
import { ROUTES } from './routes';

export const navigationRef = createNavigationContainerRef();

/** 打开「设置 → 登录注册」页。导航尚未就绪时返回 false。 */
export function openSignIn(): boolean {
  if (!navigationRef.isReady()) return false;
  // 登录注册页注册在「设置项」Tab 的 ProfileStack 里
  (navigationRef.navigate as (name: string, params?: object) => void)(ROUTES.TAB_SETTINGS, { screen: ROUTES.AUTH });
  return true;
}
