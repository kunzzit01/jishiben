# 同步报错：A transfer requires fromAssetUid and toAssetUid

## 现象

App 同步时弹窗：

```
部分历史数据格式与云端不兼容，其余数据已同步成功。
transactions/1788685915459-jzeu939:
[VALIDATION_FAILED] PUT /api/transactions
→ A transfer requires fromAssetUid and toAssetUid
```

## 根因

Supabase 导出里有 1 条转账（500 MYR，2026-09-06）的**转出账户已被删除**，
导入后 `from_asset_id` 为 NULL，而 `to_asset_id` 仍有值：

```
client_uid: 1788685915459-jzeu939
type: transfer   amount: 500   from_asset_id: NULL   to_asset_id: 43
```

后端校验只对 `transfer` 要求 from/to 同时存在
（`TransactionService` 的 validate 分支；注释明确指出 expense/income 允许无账户，
因为转账手续费就是作为无账户支出记录的），所以只有这一类会卡住同步。

> 该 client_uid 在库里出现两行，因为两个账号（mingsoon249 与 kkyylim663）
> 各自导入了同一份 Supabase 数据 —— 唯一键是 `(user_id, client_uid)`，属正常。

## 修复

```sql
-- 删除 from/to 缺失的转账（源账户已不存在，无法还原）
DELETE FROM transactions
WHERE type = 'transfer' AND (from_asset_id IS NULL OR to_asset_id IS NULL);
```

VPS 上执行：

```bash
docker exec -it jishiben-mysql sh -c 'mysql --default-character-set=utf8mb4 \
  -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
DELETE FROM transactions
WHERE type = \"transfer\" AND (from_asset_id IS NULL OR to_asset_id IS NULL);
SELECT ROW_COUNT() AS deleted;"'
```

## 影响面

- **净资产不变**：转账不改变净资产，只影响两个账户之间的余额
- 源账户本身已不存在，这条转账原本就是断链状态
- 本地已执行：删除 2 行（两个账号各 1 行），坏记录降为 0

## 为什么不是改后端的校验

放宽校验只会把坏数据写进库，让「转账」变成没有出处的数字；
真正的修法是数据侧纠正。若将来需要保留金额，可改为
`UPDATE ... SET from_asset_id = to_asset_id`（变成 0 净额的转账），但那属于伪造语义，不推荐。
