import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View, Keyboard } from 'react-native';

/**
 * 玻璃材质（UI V2.1 §2）在 web 上的偏差修正：expo-blur 的 web 实现用「tint 底色」模拟模糊——
 * tint default + intensity 100 → 叠一层 rgba(255,255,255,.30) 的白，夜间玻璃被洗成中紫，
 * 规范里的 text.secondary / income / danger 全部跌破 §4 硬指标（实测 2.7–4.2）。
 * 这里把 web 强度降到 8（白底 2.4%，模糊 1.6px ≈ 不可见），玻璃回到稿里的 rgba(14,10,30,.46) 实色；
 * iOS 仍用 GlassView 默认 100（真材质），Android 本来就没有模糊。
 */
const WEB_GLASS_INTENSITY = Platform.OS === 'web' ? 8 : undefined;
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from '../components/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useT } from '../i18n/LanguageContext';
import { hapticSuccess } from '../utils/haptics';
import { AppText, GlassView, HeroGradient, IconCircle, ScreenHeader } from '../components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

// 图标选择行已移除：账本数据模型必须有 icon 字段，创建时统一用默认图标，
// 顶部的大预览图标就是它的实时预览（以后若恢复选图标，换回这里的值即可）
const DEFAULT_LEDGER_ICON: IconName = 'book-outline';
// 预设 10 个账本颜色，固定 5 列 × 2 行
// 预设 25 个账本颜色，固定 5 列 × 5 行：每行一个色系（蓝 / 橙红粉 / 紫 / 青绿 / 大地色）
const COLOR_OPTIONS = [
  '#4C9AFF', '#2F7BE0', '#1565C0', '#5C6BC0', '#7986CB',
  '#FF7A5C', '#FF9F43', '#F4511E', '#EF5DA8', '#FF6F91',
  '#B983FF', '#9575CD', '#6A1B9A', '#BA68C8', '#CE93D8',
  '#26C6DA', '#66BB6A', '#4DB6AC', '#81C784', '#558B2F',
  '#F9A825', '#8D6E63', '#A1887F', '#FFB300', '#795548',
];

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} />
    </View>
  );
}

export default function LedgerScreen() {
    const { ledgers, addLedger } = useApp();
  const { semantic, gradients, isDark, spacing } = useTheme();
  // 玻璃卡上的次要字色（§4 硬指标）：夜间玻璃在 web 上被 BlurView 的白底洗亮
  // （expo-blur web：tint default + intensity 100 → 叠 rgba(255,255,255,.30)），
  const { pagePadding } = useLayout();
  const navigation = useNavigation();
  const tabClearance = useTabClearance();
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[0]);

  const handleAdd = async (name: string, icon: IconName, color: string) => {
    if (!name.trim()) {
      dialog.alert({ title: t('ledger.enterName') });
      return;
    }
    if (ledgers.some((l) => l.name === name.trim())) {
      dialog.alert({ title: t('ledger.dupName') });
      return;
    }
    await addLedger(name.trim(), icon, color);
    setNewName('');
    setNewColor(COLOR_OPTIONS[0]);
    // 用户定版：创建成功后给明确的交互反馈——主题化成功弹窗，按钮直接回到
    // 选择账本弹层（首页），否则用户不知道账本是否已加上
    hapticSuccess();
    dialog.alert({
      title: t('ledger.createOkTitle'),
      message: t('ledger.createOkMsg', { name: name.trim() }),
      buttons: [
        { text: t('common.confirm'), style: 'default', onPress: () => navigation.goBack() },
      ],
    });
  };

  // 二级页统一版式（UI V2.1 §1/§2）：渐变铺满整页 + 玻璃页头 + 玻璃表单卡 + accent 渐变主按钮；
  // edges 含 top：原生顶栏已关（App.tsx），状态栏高度自己垫
  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: semantic.bg }]}
      edges={['top', 'left', 'right']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <HeroGradient fill />
      {/* 页头直接用 ScreenHeader：返回键是统一的 40 白玻璃圆（GlassBackHeader 会在它下面再垫一枚 44 圆，两层叠着看） */}
      <ScreenHeader variant="compact" title={t('ledger.pageTitle')} onBack={() => navigation.goBack()} />
      {/* 键盘弹出时不遮住名称输入框与底部创建键 */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, paddingHorizontal: pagePadding }}>
          {/* 自定义账本表单：页面锁死不滚动（Scroll 会遮挡输入区），内容直接平铺 */}
          <View style={[styles.flex, styles.formWrap]}>
            {/* 这里原来用 GlassView：它的 backdrop-filter 会把输入框文字糊掉；表单不需要透出背景
                → 改普通白卡（面 + 发丝边 + 20 圆角） */}
            <View
              style={[
                styles.addCard,
                { backgroundColor: semantic.surfaceElevated, borderColor: semantic.hairline },
              ]}
            >
              <View style={styles.previewRow}>
                {/* 中心预览：立体光泽球（§5），创建时用的默认图标 + 当前选中色 */}
                <IconCircle size={72} color={newColor} icon={DEFAULT_LEDGER_ICON} />
              </View>

              <TextInput
                style={[styles.input, { backgroundColor: semantic.surfaceElevated, borderColor: semantic.hairline, color: semantic.textPrimary }]}
                value={newName}
                onChangeText={setNewName}
                placeholder={t('ledger.namePlaceholder')}
                placeholderTextColor={semantic.textSecondary}
              />
              {/* 颜色固定 5×5 网格：25 色按色系分行渲染，每排 5 个 */}
              <AppText variant="caption" color={semantic.textSecondary} style={styles.pickerLabel}>
                {t('ledger.colorLabel')}
              </AppText>
              {[0, 1, 2, 3, 4].map((row) => (
                <View key={row} style={styles.colorRow}>
                  {COLOR_OPTIONS.slice(row * 5, row * 5 + 5).map((color) => (
                    <View key={color} style={styles.colorCell}>
                    <PressableScale
                      style={[
                        styles.colorOption,
                        { backgroundColor: color },
                        // 选中：色环 + 页面底色留缝（稿 .dk/.lt --bg 的 3px 打底 + 5px 外环）
                        newColor === color && {
                          boxShadow: `0px 0px 0px 3px ${semantic.bg}, 0px 0px 0px 5px ${color}`,
                        },
                      ]}
                      activeScale={0.92}
                      onPress={() => setNewColor(color)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: newColor === color }}
                      accessibilityLabel={color}
                    />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>

          {/* 创建账本按钮钉在页面最底部（避开浮空Tab栏），不再随内容滚动 */}
          <PressableScale
            onPress={() => handleAdd(newName, DEFAULT_LEDGER_ICON, newColor)}
            activeScale={0.97}
            style={[styles.saveBtn, { marginBottom: tabClearance + spacing.sm }]}
            accessibilityRole="button"
            accessibilityLabel={t('ledger.create')}
          >
            {/* 主按钮 = accent 渐变胶囊（§3：渐变实心按钮保持白字） */}
            <LinearGradient
              colors={gradients.accent.colors}
              locations={gradients.accent.locations as [number, number, ...number[]]}
              start={gradients.accent.start}
              end={gradients.accent.end}
              style={styles.saveBtnFill}
            >
              <Ionicons name="add" size={20} color={semantic.onAccent} />
              <AppText variant="headline" weight="700" color={semantic.onAccent}>
                {t('ledger.create')}
              </AppText>
            </LinearGradient>
          </PressableScale>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  // 玻璃页头：透明返回键底下那枚 44 玻璃圆钮（与 ScreenHeader 左侧槽位对齐）
  headerGlass: { position: 'absolute', width: 44, height: 44 },
  headerGlassInner: { width: 44, height: 44 },
  formWrap: { paddingTop: 6, paddingHorizontal: 6 },
  sectionTitle: { paddingHorizontal: 6, paddingBottom: 10 },
  addCard: { padding: 20, borderRadius: 20, borderWidth: 1 },
  previewRow: { alignItems: 'center', marginBottom: 12 },
  // 胶囊输入框（稿：高 48 / radius 999 / --chip 底）
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: 'hidden',
    fontSize: 15,
    marginBottom: 16,
  },
  pickerLabel: { paddingHorizontal: 6, marginBottom: 8 },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  colorCell: { flex: 1, alignItems: 'center' },
  // 5×5 色格：圆形色点（稿），撑到行宽 17%，固定网格、整页不滚动
  colorOption: { width: 38, height: 38, borderRadius: 19 },
  // 创建账本按钮：全宽、钉在页面底部
  saveBtn: { alignSelf: 'stretch' },
  saveBtnFill: {
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // 稿：0 14 28 -12 rgba(155,91,214,.9)
    boxShadow: '0px 14px 28px -12px rgba(155,91,214,0.9)',
  },
});
