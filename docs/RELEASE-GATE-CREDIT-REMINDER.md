# 上线门禁复核 · 信用卡提醒（2026-11-02 复核版）

> 替代 docs/DEPLOY-CHECKLIST-REMINDER.md 里的过时结论（那份写于 5417998e 时代，
> 当时 9901c9a9 还没提交、VPS 还没 pull）。本文件的事实全部来自本机与 VPS 的只读探测。

---

## 一、已核实（可直接引用，不必重做）

| 项 | 结论 | 证据 |
|---|---|---|
| 本地 HEAD | `1cdfb819` 账单日当天提醒 | `git log -1`，工作树干净 |
| 与远端差距 | 仅差这 1 个提交 | `git log origin/main..HEAD` = 1cdfb819 |
| 远端/VPS | 都在 `9901c9a9`（**已含** 5417998e 的还款提醒 + V10 迁移） | VPS `cd /opt/jishiben && git log -1` |
| 类型检查 | 0 error | `npx tsc --noEmit` → EXIT:0 |
| 提醒逻辑自测 | **55 / 55 pass** | `.tools/_reminder_selftest.cjs`（见第三节） |
| i18n | zh/en 均齐全 | reminderToggle / reminderToggleHint / reminderOn1-3 / reminderOnStatement / reminderHint |
| 日期选择器 | 1–30，与 `isValidMonthDay(1..30)` 一致 | AddAssetScreen:690，31 号不入选项 |
| 改动性质 | 纯 JS/TS，3 文件，无原生/依赖变化 | `git diff --name-only 9901c9a9 HEAD` → hook + zh + en |

---

## 二、线上现状：**API 是旧的，这是当前唯一的真阻塞**

探测结果：

- `jishiben-api` 容器建于 **2026-10-29 14:12**，容器内 `app.jar` 时间 **2026-10-28 03:42**
  → 早于提醒功能（5417998e 是 11-02 14:20）。
- 线上 Flyway 历史只有 **V1–V9**；`jishiben.assets` 列清单里**没有 `reminder_enabled`**。
- `jishiben-web` 容器 **2026-11-02 14:30** 重建，bundle `index-af7612e7…` 里**能 grep 到**
  `asset.reminderToggle` 与 `asset.reminderOn3`；`downloads/jizhang-app-1.1.3-preview.apk` 里也能 grep 到。
- 同一 bundle 里 **grep 不到** `asset.reminderOnStatement`（1cdfb819 还没推，符合预期）。

由此得出两个现网症状：

1. **Web / 已发 APK 上的「还款提醒」开关是个假开关**：开关能点、能存进本地状态，
   但旧 API 的 DTO 没有 `reminderEnabled`，上行时被丢弃，重进页面回弹成关。
2. 账单日当天提醒不在任何线上构建里。

> 注：`GET :8088/api/assets` 返回 401（需登录），没走真实账号验字段；
> Flyway 版本 + jar 时间已足够定性，不必再猜。

---

## 三、自测覆盖了什么（`.tools/_reminder_selftest.cjs`）

做法：用仓库自带的 typescript 把 `src/hooks/useCreditCardReminders.ts` 转成 CJS，
把 react / AsyncStorage / AppContext / LanguageContext / notifications 全部替换成桩，
直接跑纯函数与 reconcile 流程（不动仓库文件、不需要模拟器）。

- 月末裁剪：dueDay 30 撞 2026-02 → 02/25-27；2028 闰年 → 02/26-28；账单日同样裁剪
- 过去节点丢弃；当天 09:00 未到（now 08:00）时保留
- 账单日当天节点；statementDay === dueDay 时键不冲突（|statement| 段）
- 3 个月窗口、跨年（11 月 → 12 月 + 次年 1 月，不含 2 月）
- 筛选 7 种：开关关 / 字段缺省 / 已归档 / dueDay 31 / dueDay 0 / 非信用卡 / statementDay 非法退化
- 幂等：同数据重跑零新增零取消；权限被拒（schedule 返回 null）不写映射、下轮重试
- 关开关 → 全部取消且映射清空；改还款日 → 旧节点撤、账单日节点不动
- 换账号 → 上一账号残留被清场（有意为之）；登出清理只清本账号、另一账号通知不受影响
- 文案：还款日走 reminderOn3/2/1 + body=hint，账单日走 reminderOnStatement + body 空
- 跨月重算：6 月窗口里 5 月节点全清、无重复时刻

---

## 四、剩下三步（第 1 步只能你来，第 2/3 步等你点头）

### 1. 推送（你在自己终端，DSH 无 GitHub 凭据）

    cd C:\Users\mings\OneDrive\Desktop\jishiben\_repo\jishiben
    git push origin main
    git log --oneline -1 origin/main     # 应为 1cdfb819

### 2. 重建 API —— ✅ 已于 2026-11-02 15:39 执行并验证（见第八节）

在 VPS：

    cd /opt/jishiben && git pull
    docker compose -f deploy/docker-compose.yml up -d --build api

验证：

    docker exec jishiben-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "select version from jishiben.flyway_schema_history order by installed_rank desc limit 1"'
    # 期望 10
    docker exec jishiben-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "show columns from jishiben.assets like \"reminder_enabled\""'
    docker compose -f deploy/docker-compose.yml logs api | grep -E "Migrating|Successfully applied|Started"

启动失败先看：`ddl-auto=validate` 对 `reminder_enabled` 的映射
（实体是 Boolean 包装类、未加 JdbcTypeCode，依赖与 `is_default` 相同的 boolean ↔ TINYINT(1)）。

### 3. 前端两条 —— ✅ web 15:55 / OTA 16:02 已执行并验证（见第九节）

    # web（VPS 上，需先完成第 1 步 git push + pull）
    docker compose -f deploy/docker-compose.yml up -d --build web

    # Android OTA（本地）
    npx expo export --platform android --output-dir .tools/ota-dist --clear
    # 打 tar → 传 VPS /opt/jishiben/deploy/updates/incoming
    ./publish.sh -c production -r 1.1.3 -d incoming

验证：web bundle 里能 grep 到 `asset.reminderOnStatement`；OTA 频道 id 变化。

---

## 五、回滚

- 代码：`git revert 1cdfb819`（账单日节点只是多排一类通知，回滚不影响还款提醒）
- 数据库：V10 只加一个可空默认 0 的列，旧代码不读它 → **不必回滚迁移**
- 前端：重新部署上一个构建

---

## 六、残留风险（发布前请知悉）

1. **本机没有 mvn**，服务端编译门禁只能靠 VPS 的 `docker build`；单测在本机也跑不了
   （Mockito 需 self-attach，这台机器禁 Java agent）。
2. **通知只能在开发包上验**：Expo Go 下所有通知函数静默跳过，这是既有降级路径。
3. **真机验收清单**见 DEPLOY-CHECKLIST-REMINDER.md 第 5 节（10 条），其中第 3/5 条现在还应加：
   「账单日那天 09:00 收到『今天是账单日，请核对本期账单』，且不出现还款日的免责文案」。
4. **跨账号**：reconcile 的 desired 集合只装当前账号 → 换账号会把上一账号残留清掉（有意为之，
   已登出的账号不该再弹提醒）；只有 `cancelCreditCardRemindersForUser` 是「只清自己」。

---

## 七、可选清理（不影响发布）

- `src/types/index.ts:142-143` 注释仍写「账单日/还款日 1-28」「若小于等于账单日，视为下个月的这一天」，
  与现在 1–30 且纯记载的口径不符，容易误导下一次改动。
---

## 八、执行记录 · 2026-11-02 15:35–15:40（API 重建）

用户批准后执行，只动了 api 一个服务。

回滚锚点（建前打的标签）：

    jishiben-api:pre-v10-backup = 9ec62dde213c   # 原运行镜像，10-28 构建

执行：

    cd /opt/jishiben && docker compose -f deploy/docker-compose.yml up -d --build api

构建过程（`/tmp/api-build.log`）：go-offline 107s（缓存命中）→ `mvn -DskipTests package` 通过 →
镜像 `jishiben/api:0.1.0` 重建 → 容器 2026-11-02 15:39:05 重建并启动。

结果验证（全部实测）：

| 检查 | 结果 |
|---|---|
| 容器状态 | `jishiben-api  Up`（2026-11-02 15:39） |
| Flyway | `Successfully validated 10 migrations` → `Migrating to version "10 - add reminder enabled"` → `now at version v10` |
| flyway_schema_history | `10 | 10 | add reminder enabled | success=1` |
| assets 列 | `reminder_enabled  tinyint(1)  YES  0` |
| 应用启动 | `Started JishibenApiApplication in 15.44 seconds` |
| 日志错误 | 无 ERROR；仅一条 MySQL 提示 `Integer display width is deprecated`（V10 里 TINYINT(1) 的写法，不影响功能） |
| web | `http://127.0.0.1:8088/` → 200（未重建，仍是 9901c9a9 的构建） |
| /api/assets | 401（需登录，行为与部署前一致） |

部署的源码确实带这个字段（`git show 9901c9a9:server/...`）：
`UpsertRequest / PatchRequest / Response` 三个 record 都有 `Boolean reminderEnabled`，
`Asset.java` 有 `@Column(name = "reminder_enabled")`。

**回滚方式**（若需要）：

    cd /opt/jishiben
    docker tag jishiben-api:pre-v10-backup jishiben/api:0.1.0
    docker compose -f deploy/docker-compose.yml up -d api
    # 数据库不用回滚：V10 只加可空默认 0 的列，旧代码不读它

**注意**：之前被旧 API 丢弃的开关值不会自己回来——那张「模拟信用卡 MYR」的
reminderEnabled 仍是 0，需要在 App 里重新打开一次开关。
---

## 九、执行记录 · 2026-11-02 15:55（web）/ 16:02（OTA）

> 后续修正：开关说明文案改成「账单日当天 + 还款日前 3/2/1 天」（提交 69407e61）后，
> 16:24 重建 web（bundle index-1b82c301…）、16:25 重发 OTA（updateId `20261102082525`，
> manifest id `0190469d-…`，bundle index-e65aeec5…，5,196,577 字节，sha256 已与线上下载比对一致）。

前提：用户已把 `1cdfb819` 推到 main；VPS `git pull` 后 HEAD = 1cdfb819。

### web

    cd /opt/jishiben && docker compose -f deploy/docker-compose.yml up -d --build web

- 容器 2026-11-02 15:55:30 重建，状态 `Up (healthy)`
- 新 bundle：`_expo/static/js/web/index-81699c6f8dd3a2f33c97fa5279881289.js`
- 验证：该 bundle 里同时 grep 得到 `asset.reminderOnStatement` 与 `asset.reminderOn3`（旧 bundle 只有后者）
- `http://127.0.0.1:8088/` → 200

### Android OTA

导出（本机）：

    npx expo export --platform android --output-dir .tools/ota-dist --clear
    # 产物：_expo/static/js/android/index-914a8a2d43305572b4d628c93614a3a9.hbc（5,196,417 字节）+ 44 个资源

**导出时踩到两个坑（下次直接照做）**：

1. `spawn EPERM` / `hermesc ... permission denied`：Hermes 编译器要往系统 `%TEMP%` 写 `.hbc`。
   处置：把 `TMP`/`TEMP`/`TMPDIR` 指到工作区（`.tools/tmp`）再导出。
2. `metadata.json` 的 asset 路径是**反斜杠**（`assets\\778f…`），上一版线上却是正斜杠。
   处置：发布前把 `fileMetadata.*.bundle` 和 `assets[].path` 的反斜杠全换成 `/`，否则客户端资源 URL 会错。

发布：

    scp ota-1cdfb819.tgz → /tmp/          # 注意 Windows OpenSSH 的 scp 不认 MSYS 的 /tmp
    tar xzf … -C /opt/jishiben/deploy/updates/incoming
    cd /opt/jishiben/deploy/updates && ./publish.sh -c production -r 1.1.3 -d "$(pwd)/incoming"

结果：

| 检查 | 结果 |
|---|---|
| 新 updateId | `20261102080213`（上一版 20261102062918） |
| manifest | `GET /updates/manifest`（android/1.1.3/production）→ 200，11,792 字节，id `3884817d-4400-c811-433d-63dba1174bce` |
| launchAsset | `…/20261102080213/_expo/static/js/android/index-914a8a2d….hbc` → 200 |
| 是否被 gzip | 响应头**无** `content-encoding`，`content-length: 5196417` 与本地一致 |
| 实际下载 | 5,196,417 字节，sha256 与本地 `fbb822be…` 完全一致 |
| 包里有没有新功能 | 下载回来的 .hbc 里 grep 得到 `reminderOnStatement` |

### 用户侧验收（还没做，只有真机能做）

App 冷启动两次（或 设置→关于→检查更新 手动触发）后，账单日当天 09:00 应收到
「今天是账单日，请核对本期账单」，且不带「如已还款请忽略」。
---

## 十、后续：提醒中心（2026-11-02 17:33）

首页铃铛原本弹「这个功能还在开发中」，已改成进入「提醒中心」（提交 `6b755f52`）：
用 `buildCreditCardReminderNodes` 现算未来 3 个月的排期并列出，所以列表与系统里真正待发的
闹钟一一对应（模拟器实测：页面 10 行 = `dumpsys alarm` 10 个待发）。

未登录时另给空态——排期按账号算（hook 需要 userId），本机模式下不会有提醒。
不做「已送达历史」：原生监听器只在进程存活时回调，App 关闭期间收到的通知抓不到。

该版本的线上坐标：OTA updateId `20261102093303`（bundle index-af342490…，5,201,042 字节），
web bundle `index-e2eb10626ba994ec0ec617bf1f03cace.js`。
---

## 十一、文案改温柔 + 单条可删（2026-11-02 17:48）

用户反馈：「不要一屏排期，只要一句温馨通知，而且要能删」。改动（提交 `c6231fed`）：

- **通知文案**（zh/en 同步）：改为口语短句，如「明天是 y 的还款日，记得还款哦～」
  「今天是 y 的账单日，顺手看一眼本期账单吧～」，副文案「已经还过的话，忽略这条就好～」。
- **铃铛页**：顶部一张「下次提醒」卡（日期 + 时间 + 那句温柔文案），下面是默认收起的
  「全部排期（N 条）」，展开才逐条列出。
- **单条删除**：每行右侧垃圾桶 → 取消该条系统通知 + 记进 `@jizhang/creditCardReminders.muted`。
  必须记住的原因：排期每轮全量重算，不记住的话删掉的那条下一轮会原样排回来（删除按钮变假）。
  页脚「恢复已删除的提醒」清空记忆并立刻重排；读取时顺手剪掉日期已过的条目。

实测（模拟器，卡片 y：账单日 1、还款日 5）：

| 步骤 | 结果 |
|---|---|
| 展开列表 | 10 条 = 10 个待发闹钟 |
| 删一条 | 页面 9 行，闹钟 10 → 9 |
| 连重启两次 App | 仍 9 条、闹钟仍 9 → **删掉的没回来** |
| 点恢复 | 闹钟 9 → 10，展开后 10 行 |

线上坐标：OTA updateId `20261102094857`（bundle index-82bba223…，5,212,496 字节），
web bundle `index-9dcd36fe955f58382af6845cd0e0f9c7.js`。

顺带记录一个真实细节：**账单日 3 号 与 还款日 6 号的「前 3 天」会落在同一分钟**，
那天早上会同时来两条通知 —— 不是重复排期，是两件事。
