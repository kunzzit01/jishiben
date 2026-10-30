// CategoryManagementScreen.tsx
// 「类别分类」独立路由的薄壳：只做 route 参数适配 + 渲染共享页，导航与返回栈保持原样。
// 页面的全部逻辑 / 样式 / 文案在 ../components/category/CategoryPage（与记一笔的选择类别步骤共用一份）。

import React from 'react';
import CategoryPage from '../components/category/CategoryPage';

export default function CategoryManagementScreen({ navigation, route }: any) {
  const params = route?.params ?? {};
  return (
    <CategoryPage
      selectMode={!!params.selectMode}
      initialType={params.initialType === 'income' ? 'income' : 'expense'}
      onBack={() => navigation?.goBack()}
      onPickCategory={typeof params.onPickCategory === 'function' ? params.onPickCategory : undefined}
    />
  );
}
