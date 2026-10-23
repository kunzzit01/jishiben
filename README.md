# jishiben 记账本

一个「前端（Expo / React Native Web）+ 后端（Spring Boot）+ MySQL」的自托管记账应用，
目标形态：**在 VPS 上一条 docker compose 命令跑起来**。

---

## 目录结构

```
jishiben/
├── _repo/jishiben/        前端源码（Expo SDK 57，独立 git 仓库）
│   ├── src/               屏幕 / 组件 / 服务 / 主题
│   ├── App.tsx            导航与 Provider 装配
│   └── .dockerignore      web 镜像构建时排除 node_modules 等
├── server/                后端源码（Spring Boot 3.3 / Java 21）
│   ├── src/main/java/com/jishiben/api/    auth / ledger / asset / category / transaction /
│   │                                      budget / paymentplan / profile / reports / rates /
│   │                                      push / premium / ai / health
│   ├── src/main/resources/db/migration/   Flyway V1–V9（空库自动建表）
│   └── Dockerfile                         多阶段构建（maven → jre-alpine）
├── deploy/                部署编排（VPS 用）
│   ├── docker-compose.yml api + mysql + web 三服务
│   ├── web.Dockerfile     前端静态导出 + nginx 反代（同源 /api，无 CORS）
│   ├── nginx/web.conf     静态站点 + /api → api:8080
│   ├── mysql/conf.d/      字符集配置
│   ├── backup.sh / restore.sh
│   └── .env.example       全部必填变量（DB 口令 / JWT_SECRET / 端口 / AI 可选）
├── design/                设计体系（tokens.json / COMPONENTS.md）与 .op 设计稿
├── docs/                  API.md（54 端点契约）/ DB-SCHEMA.md / DEPLOY.md / FEATURES.md
└── scripts/               本地开发工具（启停服务 / 灌数据 / 冒烟 / 数据库浏览）
```

> `.tools/` 是本地开发用的 MySQL 二进制与数据目录，**不要上传到 VPS**。

---

## 本地开发

```bash
bash scripts/mysql-start.sh     # 本地 MySQL @127.0.0.1:3307
bash scripts/api-start.sh       # 后端 @8080
cd _repo/jishiben && npx expo start --web --port 8082
```

登录演示账号：`mingsoon249@gmail.com` / `12345678`（数据可用 `scripts/seed-demo.mjs` 重灌）

---

## 部署到 VPS（一条命令）

```bash
# 1) 把代码送上去（或在服务器上 git clone 前端仓库 + 拷 server/ deploy/）
bash scripts/pack-for-vps.sh          # 生成 dist/jishiben-vps-<时间>.tar.gz
scp dist/jishiben-vps-*.tar.gz user@vps:/opt/ && ssh user@vps

# 2) 在服务器上
tar -xzf jishiben-vps-*.tar.gz && cd jishiben
cp deploy/.env.example deploy/.env
vi deploy/.env                        # 改 DB_PASSWORD / MYSQL_ROOT_PASSWORD / JWT_SECRET
docker compose -f deploy/docker-compose.yml up -d --build

# 3) 验收
curl -s localhost/api/health          # {"status":"ok",...}
```

**Flyway 会在 api 启动时自动把 schema 建到最新版**，不需要手工导入 SQL。

详见 [docs/DEPLOY.md](docs/DEPLOY.md)（含本机 Docker 实跑记录与注意事项）。

---

## 三个服务

| 服务 | 镜像 | 端口 | 说明 |
|---|---|---|---|
| `web` | jishiben/web | 对外 `HTTP_PORT`(80) | 前端静态站点 + `/api` 反代（同源，无 CORS） |
| `api` | jishiben/api | 仅内网 8080 | Spring Boot，JWT 鉴权 |
| `mysql` | mysql:8.0 | 仅内网 3306 | 数据卷 `jishiben-mysql-data` |

只有 `web` 对外发布端口；数据库与 API 在宿主机上不可直连。

---

## 安全基线

- 前端**不含任何第三方密钥**（`grep -r "sk-or-v1\|openrouter.ai" _repo/jishiben/src` = 0）；
  小票识别与语音记账都经 `/api/ai/*` 中转，密钥只在服务端环境变量里。
- 访问令牌只存内存 + 设备本地存储，不落日志、不进 URL。
- `JWT_SECRET` 与数据库口令必须换成随机长串；`deploy/.env` 不提交。
