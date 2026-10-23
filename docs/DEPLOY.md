# 部署与实跑记录（VPS 用）

> 本文记录的每一步都在本机 Docker Desktop 上真实执行过一次（2026-10-23），
> 不是"照文档应该可以"。执行环境：Docker 29.9.2 / Compose v5.6.1。

## 一、一次性准备

```bash
# 1) 部署变量（deploy/.env 不进版本库）
cp deploy/.env.example deploy/.env
vi deploy/.env      # 至少改这三个：
                    #   DB_PASSWORD / MYSQL_ROOT_PASSWORD / JWT_SECRET（>=32 随机字符）

# 2) 可选：AI 能力（小票识别 / 语音记账）
#    不填则相关接口返回 503 AI_NOT_CONFIGURED，App 自动降级为手动记账
OPENROUTER_API_KEY=sk-or-v1-...
```

## 二、启动

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

实测结果：构建约数分钟（首次拉 maven/temurin/mysql/nginx 基础镜像），随后

```
jishiben-mysql   Up (healthy)
jishiben-api     Up
jishiben-nginx   Up  0.0.0.0:${HTTP_PORT}->80/tcp
```

## 三、验收（三条，缺一不可）

```bash
# 1) 经 nginx 探活（不是直连 api 容器）
curl -s localhost:${HTTP_PORT}/api/health
# 实测：{"status":"ok","app":"jishiben-api",...}  HTTP 200

# 2) 空库自动建表
docker logs jishiben-api | grep -i flyway | tail -3
# 实测：Successfully applied 9 migrations to schema `jishiben`, now at version v9

# 3) 写库 + 鉴权链路
curl -s -X POST localhost:${HTTP_PORT}/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"12345678","displayName":"Smoke"}'
# 实测：HTTP 201 + accessToken/refreshToken
```

## 四、三个服务与端口

| 服务 | 镜像 | 端口 | 作用 |
|---|---|---|---|
| `web` | jishiben/web:0.1.0 | 对外 `HTTP_PORT`（默认 80） | 前端静态站点（Expo Web 导出）+ `/api` 反代 |
| `api` | jishiben/api:0.1.0 | 仅内网 8080 | Spring Boot |
| `mysql` | mysql:8.0 | 仅内网 3306 | 数据卷 `jishiben-mysql-data` |

- **只有 web 发布端口**；mysql 与 api 在宿主机上不可直连。
- 前端构建期把 API 基址设为同源（`EXPO_PUBLIC_API_BASE_URL=/`），页面请求就是 `/api/...`，
  由 web 容器的 nginx 转给 `api:8080` —— **不需要 CORS，也不硬编码域名**。

### 本次实测（2026-10-23，本机 Docker）

```
jishiben-web     Up  0.0.0.0:8088->80/tcp
jishiben-mysql   Up  (healthy)
jishiben-api     Up  8080/tcp

GET  :8088/                     → 200（<title>jizhang-app</title>）
GET  :8088/some/deep/route      → 200（SPA 回退）
GET  :8088/api/health           → 200 {"status":"ok","app":"jishiben-api"}
POST :8088/api/auth/register    → 201
POST :8088/api/auth/login       → 200（token 256 字符）
GET  :8088/api/profile (Bearer) → 200
GET  :8088/api/ledgers (Bearer) → 200 []
```

> 同一 token 直连本地开发 API(:8080) 会返回 401 —— 两套环境 JWT_SECRET 不同，
> 这正说明容器栈与本地开发完全隔离。
- 想临时看数据库：`docker exec -it jishiben-mysql mysql -ujishiben -p`。

## 五、备份与恢复

```bash
bash deploy/backup.sh      # 产出带时间戳的 mysqldump
bash deploy/restore.sh <备份文件>
```

## 六、升级

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build   # 只重建变了的镜像
```

Flyway 会在 api 启动时自动把 schema 升到最新，**不需要手工跑 SQL**。

## 七、已知注意事项

1. **JWT_SECRET 必须换**：泄露等于所有人的登录态可伪造；长度 ≥32。
2. **MySQL root 口令必须换**：本地开发用的是空口令，绝不能带到 VPS。
3. `deploy/.env` 已在 .gitignore 里；不要提交真实口令。
4. 本机实跑用的临时端口是 8088（避免与本地开发 8080 冲突），VPS 上一般用 80 或 443。
5. HTTPS 未在本次验证范围内：nginx 目前只监听 80，上生产建议加证书（certbot 或云负载均衡终止 TLS）。
