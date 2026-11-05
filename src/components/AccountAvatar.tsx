// AccountAvatar.tsx —— 账号头像（个人中心与设置页共用同一取图顺序）。
// 顺序：App 内自选照片（avatarStore.custom）→ Google picture（user.avatarUrl）→ 默认图标。
// 用共享 store 而不是各自读存储，保证「里面换了、外面立刻也换」。
import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/useTheme';
import { useCustomAvatar } from '../utils/avatarStore';

export default function AccountAvatar({ size = 48 }: { size?: number }) {
  const { user } = useAuth();
  const { semantic } = useTheme();
  const { uri: customUri, custom } = useCustomAvatar();
  const [failed, setFailed] = useState(false);

  const uri = custom ? customUri : !failed && user?.avatarUrl ? user.avatarUrl : customUri;

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: semantic.accentSoft },
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailed(true)} />
      ) : (
        <Ionicons name="person" size={Math.round(size * 0.52)} color={semantic.textPrimary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
