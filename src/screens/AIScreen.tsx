import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';

import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import BackButton from '../components/ui/BackButton';
import HeroGradient from '../components/ui/HeroGradient';
import PressableScale from '../components/PressableScale';
import { useTheme } from '../theme/useTheme';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';
import { ROUTES } from '../navigation/routes';
import { findCategoryIdByChineseName } from '../i18n/categories';
import { useT } from '../i18n/LanguageContext';
import {
  voiceToAccounting,
  transcribeAudioFile,
  VoiceAccountingResult,
} from '../utils/voiceAccounting';
import { isAiConfigured } from '../config/aiConfig';

export default function AIScreen({ navigation }: any) {
  const { colors } = useTheme();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const t = useT();
  // 主题化弹窗（替代系统 Alert）
  const dialog = useDialog();

  const {
    categories,
    activeAssets,
    addTransaction,
  } = useApp();

  // ---------------------------------------------------------
  // Audio
  // ---------------------------------------------------------

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // ---------------------------------------------------------
  // Voice accounting state
  // ---------------------------------------------------------

  const [processing, setProcessing] = useState(false);

  // 语音记账诊断阶段：用于定位 1~2 分钟到底卡在哪一步
  const [processingStage, setProcessingStage] = useState('');

  const [result, setResult] =
    useState<VoiceAccountingResult | null>(null);

  const [modalOpen, setModalOpen] = useState(false);

  // 确认弹层的键盘避让：Modal 是独立窗口，Android edge-to-edge 下不会随 adjustResize 上推，
  // 所以监听键盘高度，把遮罩底部垫起同样的高度，让输入框始终露在键盘上方
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showWill = Keyboard.addListener('keyboardWillShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height)
    );
    const showDid = Keyboard.addListener('keyboardDidShow', (e) =>
      setKeyboardHeight(e.endCoordinates.height)
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showWill.remove();
      showDid.remove();
      hide.remove();
    };
  }, []);

  // ---------------------------------------------------------
  // Editable result
  // ---------------------------------------------------------

  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const [editType, setEditType] =
    useState<'expense' | 'income'>('expense');

  const [editCategoryId, setEditCategoryId] =
    useState<string | null>(null);

  // ---------------------------------------------------------
  // Default asset
  // ---------------------------------------------------------

  // 只从未归档账户里取默认账户（归档账户不能再被记一笔自动带出）
  const defaultAsset =
    activeAssets.find((a: any) => a.isDefault) ??
    activeAssets[0];

  // ---------------------------------------------------------
  // Request microphone permission
  // ---------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    const prepareAudio = async () => {
      try {
        const permission =
          await AudioModule.requestRecordingPermissionsAsync();

        if (!mounted || !permission.granted) {
          return;
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });
      } catch (error) {
        console.warn(
          '[VoiceAccounting] audio setup failed:',
          error
        );
      }
    };

    prepareAudio();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------------------------------------------------
  // Open scanner
  // ---------------------------------------------------------

  const goScan = () => {
    // 双注册后直接 push 当前栈的"记一笔"：从设置项进 AI专区时 push ProfileStack 的实例,
    // 从首页侧进时 push HomeStack 的实例——记一笔的 goBack 天然回 AI专区,不再跨 Tab
    navigation.navigate(ROUTES.ADD_TX, {
      initialType: 'expense',
      autoScan: true,
    });
  };

  // ---------------------------------------------------------
  // AICore 模型预取：挂载后台触发下载/检查（一次下载系统级持久化），
  // 不阻塞录音流程；真正录音时用 checkStatus 快速判断
  // ---------------------------------------------------------

  // ---------------------------------------------------------
  // Start recording
  // ---------------------------------------------------------

  const startRecording = async () => {
    // 未配置 AI 密钥（环境变量缺失）→ 优雅降级：不录音、不请求，只提示不可用
    if (!isAiConfigured) {
      dialog.alert({ title: t('ai.voiceUnavailableTitle'), message: t('ai.voiceUnavailableMsg') });
      return;
    }
    const startedAt = Date.now();

    const debug = (message: string) => {
      if (!__DEV__) return; // 语音流程打点只在开发构建里输出
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(`[VOICE DEBUG][START ${elapsed}s] ${message}`);
    };

    debug('准备开始录音');

    try {
      const permission =
        await AudioModule.requestRecordingPermissionsAsync();

      debug(
        `麦克风权限返回: ${permission.granted ? 'granted' : 'denied'}`
      );

      if (!permission.granted) {
        dialog.alert({
          title: t('ai.micPermissionTitle'),
          message: t('ai.micPermissionMsg'),
        });
        return;
      }

      debug('设置 Audio Mode');

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      debug('准备 Recorder');

      await recorder.prepareToRecordAsync();

      debug('开始 recorder.record()');

      recorder.record();

      debug('录音已经开始');
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] start recording error:',
        error
      );

      dialog.alert({
        title: t('ai.startRecordFailed'),
        message:
          error?.message ??
          t('ai.startRecordMsg'),
      });
    }
  };

  // ---------------------------------------------------------
  // Stop recording → AI
  // ---------------------------------------------------------

  const stopRecording = async () => {
    const startedAt = Date.now();

    const debug = (message: string) => {
      if (!__DEV__) return; // 语音流程计时只在开发构建里输出
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(`[VOICE DEBUG][TOTAL ${elapsed}s] ${message}`);
    };

    debug('========== 语音记账流程开始 ==========');

    try {
      debug('开始停止录音');

      await recorder.stop();

      debug('recorder.stop() 完成');

      const uri = recorder.uri;

      debug(`录音 URI: ${uri ? uri : 'NULL'}`);

      if (!uri) {
        dialog.alert({
          title: t('ai.recordFailedTitle'),
          message: t('ai.recordFailedMsg'),
        });
        return;
      }

      debug('录音文件已取得');

      setProcessing(true);
      setProcessingStage(t('ai.preparing'));

      debug('setProcessing(true)');

      // -----------------------------------------
      // 语音 → Transcript → AI Accounting
      // 本地AI可用走设备端解析（不消耗云端配额），否则走原有云端逻辑；
      // ensureReady 不阻塞主流程：返回 downloading 时本次直接走云端，下次可能已就绪。
      // -----------------------------------------

      const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();

      // 纯云端模式：一次上传完成 STT + 记账解析（内部顺序两步，各带 8s 超时熔断）
      setProcessingStage(t('ai.recognizing'));

      const parsed = await voiceToAccounting(uri);
      debug('voiceToAccounting() 已完成');

      console.log(
        '[VoiceAccounting] result:',
        parsed,
      );

      // -----------------------------------------
      // Fill editable fields
      // -----------------------------------------

      setProcessingStage(t('ai.organizing'));

      debug('开始填充账单字段');

      setResult(parsed);

      setEditAmount(
        parsed.amount != null
          ? String(parsed.amount)
          : '',
      );

      setEditDate(
        parsed.date ?? todayStr(),
      );

      setEditNote(
        parsed.note ??
          parsed.merchant ??
          '',
      );

      setEditType(parsed.type);

      // -----------------------------------------
      // AI category matching
      // -----------------------------------------

      // AI 提示词固定中文，返回中文分类名 → 先映射成内置分类 id 再按 id 匹配，
      // 与界面语言（中文/英文）无关
      const suggestedId = parsed.suggestedCategory
        ? findCategoryIdByChineseName(parsed.suggestedCategory)
        : undefined;
      const matchedCategory = suggestedId
        ? categories.find(
            (category: any) =>
              category.type === parsed.type &&
              category.id === suggestedId,
          )
        : undefined;

      setEditCategoryId(
        matchedCategory?.id ?? null,
      );

      // -----------------------------------------
      // Show confirmation sheet
      // -----------------------------------------

      setModalOpen(true);

      debug('确认账单 Modal 已打开');
      debug('========== 语音记账流程完成 ==========');
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] processing error:',
        error,
      );

      console.error(
        '[VOICE DEBUG] 语音记账流程失败:',
        error?.message ?? error,
      );

      dialog.alert({
        title: t('ai.voiceFailedTitle'),
        message:
          error?.message ??
          t('ai.voiceFailedMsg'),
      });
    } finally {
      setProcessing(false);
      setProcessingStage('');
    }
  };

  // ---------------------------------------------------------
  // Record button
  // ---------------------------------------------------------

  const handleRecordPress = () => {
    if (processing) {
      return;
    }

    if (recorderState.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // ---------------------------------------------------------
  // Change income / expense
  // ---------------------------------------------------------

  const changeType = (
    type: 'expense' | 'income',
  ) => {
    setEditType(type);

    // 重新寻找对应类型的分类
    setEditCategoryId(null);

    const firstCategory =
      categories.find(
        (category: any) =>
          category.type === type,
      );

    if (firstCategory) {
      setEditCategoryId(
        firstCategory.id,
      );
    }
  };

  // ---------------------------------------------------------
  // Save transaction
  // ---------------------------------------------------------

  const saveVoiceTransaction = async () => {
    const amount =
      parseFloat(editAmount);

    if (!amount || amount <= 0) {
      dialog.alert({
        title: t('ai.amountWrong'),
        message: t('ai.amountWrongMsg'),
      });
      return;
    }

    if (!editCategoryId) {
      dialog.alert({
        title: t('ai.selectCategoryTitle'),
        message: t('ai.selectCategoryMsg'),
      });
      return;
    }

    if (!defaultAsset?.id) {
      dialog.alert({
        title: t('ai.noAssetTitle'),
        message: t('ai.noAssetMsg'),
      });
      return;
    }

    try {
      // -----------------------------------------------------
      // 使用现有 AppContext 的 addTransaction
      // -----------------------------------------------------

      await addTransaction({
        amount,
        categoryId: editCategoryId,
        type: editType,
        date:
          editDate ||
          todayStr(),
        note: editNote.trim(),
        assetId: defaultAsset.id,
      });

      // -----------------------------------------------------
      // Reset
      // -----------------------------------------------------

      setModalOpen(false);

      setResult(null);

      setEditAmount('');
      setEditDate('');
      setEditNote('');
      setEditCategoryId(null);

      // -----------------------------------------------------
      // Success
      // -----------------------------------------------------

      dialog.alert({
        title: t('ai.saveOkTitle'),
        message: t('ai.saveOkMsg'),
        buttons: [
          {
            text: t('ai.saveOkBtn'),
            onPress: () => {
              navigation?.navigate(ROUTES.TAB_HOME);
            },
          },
        ],
      });
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] save error:',
        error,
      );

      dialog.alert({
        title: t('ai.saveFailedTitle'),
        message:
          error?.message ??
          t('ai.saveFailedMsg'),
      });
    }
  };

  // ---------------------------------------------------------
  // Cancel confirmation
  // ---------------------------------------------------------

  const cancelResult = () => {
    setModalOpen(false);
    setResult(null);

    setEditAmount('');
    setEditDate('');
    setEditNote('');
    setEditCategoryId(null);
  };

  // ---------------------------------------------------------
  // Categories for current type
  // ---------------------------------------------------------

  const visibleCategories =
    categories.filter(
      (category: any) =>
        category.type === editType,
    );

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* 头部:与其他二级页同款——圆框返回键(40×40、1.5px link 描边) + 标题居中 */}
      <View style={styles.headerRow}>
        <BackButton onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')} />
        <Text style={styles.headerTitle}>{t('ai.title')}</Text>
        {/* 与返回键同宽（44）保持标题真居中 */}
        <View style={{ width: 44 }} />
      </View>
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        // 自适应滚动:内容一屏放得下时整页不滚动(无滚动条),内容超出屏高才可滚动
        contentContainerStyle={[styles.content, { flexGrow: 1, paddingBottom: tabClearance }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ===================================================
            Header
        =================================================== */}

        <Text style={styles.pageSub}>
          {t('ai.pageSub')}
        </Text>

        {/* ===================================================
            Scanner
        =================================================== */}

        <PressableScale
          style={styles.primaryCard}
          activeScale={0.97}
          onPress={goScan}
        >
          <View
            style={
              styles.primaryCardIcon
            }
          >
            <Text style={{ fontSize: 26 }}>
              📷
            </Text>
          </View>

          <View
            style={
              styles.primaryCardText
            }
          >
            <Text
              style={
                styles.primaryCardTitle
              }
            >
              {t('ai.scanCardTitle')}
            </Text>

            <Text
              style={
                styles.primaryCardDesc
              }
            >
              {t('ai.scanCardDesc')}
            </Text>
          </View>

          <Text style={styles.chevron}>
            ›
          </Text>
        </PressableScale>

        {/* ===================================================
            Voice Accounting
        =================================================== */}

        <Text
          style={
            styles.sectionTitle
          }
        >
          {t('ai.sectionTitle')}
        </Text>

        <View
          style={
            styles.voiceCard
          }
        >
          <View
            style={
              styles.voiceIconWrap
            }
          >
            <Ionicons
              name={
                recorderState.isRecording
                  ? 'stop'
                  : 'mic'
              }
              size={34}
              color={colors.bg}
            />
          </View>

          <Text
            style={
              styles.voiceTitle
            }
          >
            {processing
              ? processingStage || t('ai.aiWorking')
              : recorderState.isRecording
                ? t('ai.listening')
                : t('ai.voiceTitle')}
          </Text>

          <Text
            style={
              styles.voiceDesc
            }
          >
            {processing
              ? t('ai.processingHint')
              : recorderState.isRecording
                ? t('ai.tapToStop')
                : t('ai.tapToStart')}
          </Text>

          {/* Record Button */}

          <PressableScale
            style={[
              styles.recordButton,

              recorderState.isRecording &&
                styles.recordButtonActive,

              processing &&
                styles.recordButtonDisabled,
            ]}
            activeScale={0.94}
            onPress={
              handleRecordPress
            }
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator
                color={colors.bg}
              />
            ) : (
              <Ionicons
                name={
                  recorderState.isRecording
                    ? 'stop'
                    : 'mic'
                }
                size={22}
                color={colors.bg}
              />
            )}

            <Text
              style={
                styles.recordButtonText
              }
            >
              {processing
                ? t('ai.statusRecognizing')
                : recorderState.isRecording
                  ? t('ai.stopRecording')
                  : t('ai.startRecording')}
            </Text>
          </PressableScale>

          {/* Examples */}

          <View
            style={
              styles.examples
            }
          >
            <Text
              style={
                styles.exampleTitle
              }
            >
              {t('ai.youCanSay')}
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              {t('ai.example1')}
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              {t('ai.example2')}
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              {t('ai.example3')}
            </Text>
          </View>
        </View>

        {/* ===================================================
            Other AI
        =================================================== */}
        {/* 两个占位功能（消费习惯分析/对话式记账）未开发，入口已移除 */}
      </ScrollView>

      {/* =====================================================
          Voice Result Confirmation Modal
      ===================================================== */}

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={
          cancelResult
        }
      >
        <View
          style={[
            styles.modalOverlay,
            { paddingBottom: keyboardHeight },
          ]}
        >
          <ScrollView
            style={
              styles.modalCard
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}

            <View
              style={
                styles.modalHeader
              }
            >
              <Text
                style={
                  styles.modalTitle
                }
              >
                确认语音账单
              </Text>

              <PressableScale
                activeScale={0.90}
                onPress={
                  cancelResult
                }
                hitSlop={{
                  top: 10,
                  bottom: 10,
                  left: 10,
                  right: 10,
                }}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={
                    colors.textSecondary
                  }
                />
              </PressableScale>
            </View>

            {result && (
              <>
                {/* Transcript */}

                <Text
                  style={
                    styles.transcriptLabel
                  }
                >
                  AI 听到的是
                </Text>

                <Text
                  style={
                    styles.transcript
                  }
                >
                  {result.transcript}
                </Text>

                {/* Type */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  类型
                </Text>

                <View
                  style={
                    styles.typeSwitch
                  }
                >
                  <PressableScale
                    style={[
                      styles.typeBtn,

                      editType ===
                        'expense' &&
                        styles.typeBtnActive,
                    ]}
                    activeScale={0.95}
                    onPress={() =>
                      changeType(
                        'expense',
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.typeText,

                        editType ===
                          'expense' &&
                          styles.typeTextActive,
                      ]}
                    >
                      支出
                    </Text>
                  </PressableScale>

                  <PressableScale
                    style={[
                      styles.typeBtn,

                      editType ===
                        'income' &&
                        styles.typeBtnActive,
                    ]}
                    activeScale={0.95}
                    onPress={() =>
                      changeType(
                        'income',
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.typeText,

                        editType ===
                          'income' &&
                          styles.typeTextActive,
                      ]}
                    >
                      收入
                    </Text>
                  </PressableScale>
                </View>

                {/* Amount */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  金额
                </Text>

                <View
                  style={
                    styles.inputRow
                  }
                >
                  <Text
                    style={
                      styles.currencySymbol
                    }
                  >
                    RM
                  </Text>

                  <TextInput
                    style={
                      styles.amountInput
                    }
                    value={
                      editAmount
                    }
                    onChangeText={
                      setEditAmount
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={
                      colors.textTertiary
                    }
                  />
                </View>

                {/* Date */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  日期
                </Text>

                <TextInput
                  style={
                    styles.input
                  }
                  value={
                    editDate
                  }
                  onChangeText={
                    setEditDate
                  }
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={
                    colors.textTertiary
                  }
                />

                {/* Category */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  分类
                </Text>

                {visibleCategories.length >
                0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    contentContainerStyle={
                      styles.categoryRow
                    }
                  >
                    {visibleCategories.map(
                      (category: any) => (
                        <PressableScale
                          key={
                            category.id
                          }
                          style={[
                            styles.categoryChip,

                            editCategoryId ===
                              category.id &&
                              styles.categoryChipActive,
                          ]}
                          activeScale={0.94}
                          onPress={() =>
                            setEditCategoryId(
                              category.id,
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.categoryChipText,

                              editCategoryId ===
                                category.id &&
                                styles.categoryChipTextActive,
                            ]}
                          >
                            {
                              category.name
                            }
                          </Text>
                        </PressableScale>
                      ),
                    )}
                  </ScrollView>
                ) : (
                  <Text
                    style={
                      styles.noCategoryText
                    }
                  >
                    没有可用的
                    {editType ===
                    'expense'
                      ? t('ai.expenseLabel')
                      : t('ai.incomeLabel')}
                    分类
                  </Text>
                )}

                {/* Note */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  内容
                </Text>

                <TextInput
                  style={[
                    styles.input,
                    styles.noteInput,
                  ]}
                  value={
                    editNote
                  }
                  onChangeText={
                    setEditNote
                  }
                  placeholder={t('ai.notePlaceholder')}
                  placeholderTextColor={
                    colors.textTertiary
                  }
                  multiline
                />

                {/* Asset */}

                <View
                  style={
                    styles.assetInfo
                  }
                >
                  <Ionicons
                    name="wallet-outline"
                    size={15}
                    color={
                      colors.textTertiary
                    }
                  />

                  <Text
                    style={
                      styles.assetInfoText
                    }
                  >
                    入账资产：
                    {defaultAsset?.name ??
                      t('ai.noDefaultAsset')}
                  </Text>
                </View>

                {/* Buttons */}

                <View
                  style={
                    styles.modalActions
                  }
                >
                  <PressableScale
                    style={
                      styles.cancelButton
                    }
                    activeScale={0.95}
                    onPress={
                      cancelResult
                    }
                  >
                    <Text
                      style={
                        styles.cancelButtonText
                      }
                    >
                      取消
                    </Text>
                  </PressableScale>

                  <PressableScale
                    style={
                      styles.confirmButton
                    }
                    activeScale={0.95}
                    onPress={
                      saveVoiceTransaction
                    }
                  >
                    <Text
                      style={
                        styles.confirmButtonText
                      }
                    >
                      确认记账
                    </Text>
                  </PressableScale>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================
// Helpers
// =============================================================

function todayStr() {
  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// =============================================================
// Styles
// =============================================================

function makeStyles(
  colors: ThemeColors,
) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },

    // 头部:与其他二级页同款(圆框返回键 + 标题居中)
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 10,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    content: {
      padding: 20,
      paddingBottom: 40,
    },

    pageSub: {
      fontSize: 13,
      color: colors.textTertiary,
      marginBottom: 20,
    },

    // ---------------------------------------------------------
    // Scanner Card
    // ---------------------------------------------------------

    primaryCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.textPrimary,
      borderRadius: 16,
      padding: 16,
      marginBottom: 26,
    },

    primaryCardIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor:
        'rgba(128,128,128,0.24)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    primaryCardText: {
      flex: 1,
      marginLeft: 14,
    },

    primaryCardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.bg,
    },

    primaryCardDesc: {
      fontSize: 12,
      color: colors.bg,
      opacity: 0.7,
      marginTop: 4,
    },

    chevron: {
      fontSize: 24,
      color: colors.bg,
      opacity: 0.6,
      marginLeft: 8,
    },

    // ---------------------------------------------------------
    // Section
    // ---------------------------------------------------------

    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 12,
      marginTop: 2,
    },

    // ---------------------------------------------------------
    // Voice Card
    // ---------------------------------------------------------

    voiceCard: {
      backgroundColor:
        colors.card,
      borderRadius: 18,
      padding: 22,
      alignItems: 'center',
      marginBottom: 28,
    },

    voiceIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor:
        colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },

    voiceTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    voiceDesc: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 6,
      textAlign: 'center',
    },

    recordButton: {
      marginTop: 18,
      minWidth: 150,
      borderRadius: 14,
      paddingVertical: 13,
      paddingHorizontal: 20,
      backgroundColor:
        colors.textPrimary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },

    recordButtonActive: {
      opacity: 0.85,
    },

    recordButtonDisabled: {
      opacity: 0.55,
    },

    recordButtonText: {
      color: colors.bg,
      fontSize: 14,
      fontWeight: '700',
    },

    examples: {
      width: '100%',
      marginTop: 20,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor:
        colors.dividerHair,
    },

    exampleTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 7,
    },

    exampleText: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 20,
    },

    // ---------------------------------------------------------
    // Other AI
    // ---------------------------------------------------------

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },

    comingCard: {
      width: '48%',
      backgroundColor:
        colors.card,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },

    comingTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
      marginTop: 8,
    },

    comingDesc: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 4,
      lineHeight: 16,
    },

    // ---------------------------------------------------------
    // Modal
    // ---------------------------------------------------------

    modalOverlay: {
      flex: 1,
      backgroundColor:
        colors.overlay,
      justifyContent: 'flex-end',
    },

    modalCard: {
      backgroundColor:
        colors.card,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 20,
      maxHeight: '92%',
    },

    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      marginBottom: 14,
    },

    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    // ---------------------------------------------------------
    // Transcript
    // ---------------------------------------------------------

    transcriptLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      marginBottom: 5,
    },

    transcript: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textPrimary,
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      padding: 10,
      marginBottom: 12,
    },

    // ---------------------------------------------------------
    // Type
    // ---------------------------------------------------------

    typeSwitch: {
      flexDirection: 'row',
      backgroundColor:
        colors.bg,
      borderRadius: 12,
      padding: 4,
      marginBottom: 8,
    },

    typeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 9,
      alignItems: 'center',
    },

    typeBtnActive: {
      backgroundColor:
        colors.textPrimary,
    },

    typeText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
    },

    typeTextActive: {
      color: colors.bg,
    },

    // ---------------------------------------------------------
    // Fields
    // ---------------------------------------------------------

    fieldLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 6,
    },

    input: {
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: 14,
    },

    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      paddingHorizontal: 12,
    },

    currencySymbol: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
      marginRight: 4,
    },

    amountInput: {
      flex: 1,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },

    noteInput: {
      minHeight: 48,
      textAlignVertical: 'top',
    },

    // ---------------------------------------------------------
    // Categories
    // ---------------------------------------------------------

    categoryRow: {
      gap: 8,
      paddingBottom: 4,
    },

    categoryChip: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        colors.dividerHair,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor:
        colors.bg,
    },

    categoryChipActive: {
      backgroundColor:
        colors.textPrimary,
      borderColor:
        colors.textPrimary,
    },

    categoryChipText: {
      fontSize: 12,
      color: colors.textSecondary,
    },

    categoryChipTextActive: {
      color: colors.bg,
      fontWeight: '700',
    },

    noCategoryText: {
      fontSize: 12,
      color: colors.textTertiary,
      paddingVertical: 8,
    },

    // ---------------------------------------------------------
    // Asset
    // ---------------------------------------------------------

    assetInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
    },

    assetInfoText: {
      fontSize: 11,
      color: colors.textTertiary,
      marginLeft: 6,
    },

    // ---------------------------------------------------------
    // Buttons
    // ---------------------------------------------------------

    modalActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 18,
    },

    cancelButton: {
      flex: 1,
      borderRadius: 13,
      borderWidth: 1,
      borderColor:
        colors.dividerHair,
      paddingVertical: 14,
      alignItems: 'center',
    },

    cancelButtonText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },

    confirmButton: {
      flex: 1,
      borderRadius: 13,
      backgroundColor:
        colors.textPrimary,
      paddingVertical: 14,
      alignItems: 'center',
    },

    confirmButtonText: {
      color: colors.bg,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}