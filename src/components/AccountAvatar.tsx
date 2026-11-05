// AccountAvatar.tsx —— 账号头像（个人中心与设置页共用同一取图顺序）。
// 顺序：Google picture（user.avatarUrl）→ App 内自选头像（AsyncStorage）→ 默认人形图标。
// 远程图加载失败会回退，避免出现空白圆圈。
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/useTheme';

const AVATAR_STORAGE_KEY = '@jizhang/avatar';

export default function AccountAvatar({ size = 48 }: { size?: number }) {
  const { user } = useAuth();
  const { semantic } = useTheme();
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // 每次 Google 头像变化都重置失败标记，并重读本地自选头像（可能刚在个人中心换过）
  useEffect(() => {
    setFailed(false);
    let alive = true;
    AsyncStorage.getItem(AVATAR_STORAGE_KEY)
      .then((v) => {
        if (alive) setLocalUri(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user?.avatarUrl]);

  const uri = !failed && user?.avatarUrl ? user.avatarUrl : localUri;

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: semantic.accentSoft },
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.52)} color={semantic.textPrimary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
