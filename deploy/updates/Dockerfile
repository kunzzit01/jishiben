# 自建 expo-updates 服务端镜像：零依赖，只有 server.js，不需要 npm install
# 由 deploy/docker-compose.yml 的 updates 服务调用（context: ./updates）
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8081 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json server.js ./

# 更新包目录由 compose 以只读语义挂载进来，服务只读不写
USER node
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
