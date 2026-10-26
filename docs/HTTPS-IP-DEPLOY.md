# 公网 IP 的 HTTPS 部署（无域名）

> 状态：**已上线并验证**（2026-10-26）
> 访问地址：`https://187.127.125.136`

## 一、最终架构

```
Android App / 浏览器
      │ HTTPS :443
      ▼
   Traefik 3.7.6（边缘，host 网络）
      │        ├── Host(kunzzgroup.com) ──► 你原有站点（未改动）
      │        └── Host(187.127.125.136) ─► 127.0.0.1:8088
      ▼
  jishiben-web（nginx + Expo 静态站 + /api 反代）
      ▼
  jishiben-api（:8080，仅内网）
      ▼
  jishiben-mysql（:3306，仅内网）
```

- TLS 由 **Traefik** 终结，证书由 **certbot（snap，5.8.0）** 签发
- 证书类型：Let's Encrypt **IP 证书**，短周期 profile，**有效期 160 小时**
- SAN 实测：`IP Address:187.127.125.136`，issuer `Let's Encrypt CN=YE2`

## 二、为什么不用 Traefik 自己的 ACME

实测结论（可复现）：

```
GET http://187.127.125.136/.well-known/acme-challenge/test → 404
Traefik 日志：ERR Cannot retrieve the ACME challenge for 187.127.125.136 (token "test")
```

即 **Traefik 3.7.6 的 ACME 只认域名标识符，不认 IP**（上游 issue #11894 仍未合并）。
曾尝试让用户路由接管挑战路径（`priority` 逐步提到 2147483647），**重启后仍 404** —
说明 Traefik 内置 ACME 处理器的优先级无法被用户路由覆盖。

**因此 HTTP-01 只能由 certbot standalone 在 :80 完成，验证期间需短暂停 Traefik（约 15 秒）。**

## 三、文件清单（都在仓库里）

```
deploy/scripts/issue-ip-cert.sh            一次性签发（--staging / --production --reset）
deploy/scripts/renew-ip-cert.sh            续期（仅剩 ≤60h 才动手，平时不碰 Traefik）
deploy/scripts/jishiben-cert-renew.service systemd oneshot 单元
deploy/scripts/jishiben-cert-renew.timer   每 6 小时检查
deploy/traefik-dynamic/jishiben-tls.yml    Traefik TLS 路由（拷到 /docker/traefik/dynamic/）
```

证书经 Traefik 已挂载的 volume 交付，**不需要改 Traefik 的挂载**：

```
/var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/jishiben/{fullchain,privkey}.pem
   ↕ 容器内可见于 /letsencrypt/jishiben/
```

续期后 `touch /docker/traefik/dynamic/jishiben-tls.yml` 触发 file provider 重载，**不重启 Traefik**。

## 四、首次签发步骤

```bash
cd /opt/jishiben && git pull

# 1) 先 staging 验证流程（避免撞生产限额）
./deploy/scripts/issue-ip-cert.sh --staging

# 2) 转正式证书（--reset 必须：清掉 staging lineage）
./deploy/scripts/issue-ip-cert.sh --production --reset

# 3) 交付给 Traefik（证书必须先存在，否则 Traefik 读不到会报错）
VOL=/var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/jishiben
sudo cp -f /etc/letsencrypt/live/187.127.125.136/fullchain.pem "$VOL/"
sudo cp -f /etc/letsencrypt/live/187.127.125.136/privkey.pem   "$VOL/"
sudo chmod 644 "$VOL/fullchain.pem"; sudo chmod 600 "$VOL/privkey.pem"
sudo cp /opt/jishiben/deploy/traefik-dynamic/jishiben-tls.yml /docker/traefik/dynamic/
```

## 五、自动续期

```bash
sudo cp /opt/jishiben/deploy/scripts/jishiben-cert-renew.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jishiben-cert-renew.timer
systemctl list-timers jishiben-cert-renew.timer
```

设计要点：**先看剩余有效期再决定是否动手**

| 剩余有效期 | 行为 |
|---|---|
| > 60 小时 | 直接退出，**完全不碰 Traefik**（日志 `SKIP: remaining > 60h`） |
| ≤ 60 小时 | 停 Traefik → certbot renew → 起 Traefik → 部署新证书（约 15 秒） |

> 早期版本每次运行都停 Traefik，而 timer 每 6 小时一次 → 业务站点每天无故中断约 4 次，已修正。

## 六、验收结果（2026-10-26 实测）

```
https://187.127.125.136/                     → 200
https://187.127.125.136/api/health           → 200 {"status":"ok","app":"jishiben-api"}
POST https://187.127.125.136/api/auth/login  → 200 + JWT
证书 SAN                                      → IP Address:187.127.125.136
issuer                                        → Let's Encrypt (YE2)，非 staging
https://kunzzgroup.com/                       → 302（原有站点全程未受影响）
```

## 七、风险与监控

**IP 证书只有 160 小时。** 若续期连续失败且无人处理，**6 天后 App 会全线无法登录**。

```bash
# 剩余有效期
openssl x509 -enddate -noout \
  -in /var/lib/docker/volumes/traefik_traefik-letsencrypt/_data/jishiben/fullchain.pem

# 失败标记（每次失败都会追加）
cat /var/log/jishiben-cert-failed.log 2>/dev/null

# 续期日志
tail -20 /var/log/jishiben-cert-renew.log
```

建议把「剩余 < 72 小时」接入外部告警；否则这个 6 天周期是整套系统最脆的一环。

## 八、回滚

```bash
# 撤掉 IP 的 HTTPS（立即生效，不影响其它站点）
sudo rm /docker/traefik/dynamic/jishiben-tls.yml

# 停掉自动续期
sudo systemctl disable --now jishiben-cert-renew.timer

# 撤掉 ACME 转发路由（本方案未使用，若曾加入则一并删）
sudo rm -f /docker/traefik/dynamic/jishiben-acme.yml
```

App 侧回滚：把 `eas.json` 的 `EXPO_PUBLIC_API_BASE_URL` 改回旧值重新打包即可，服务端无需改动。
