# Multi-stage so the image is reproducible without a host JDK:
#   docker compose -f deploy/docker-compose.yml build
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
# Dependency layer: re-resolves only when pom.xml changes.
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine AS runtime
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /workspace/target/jishiben-api.jar /app/app.jar
# 凭证图片目录：不挂卷直接跑时 app 用户也要能写（挂载宿主机目录时以宿主机权限为准）
RUN mkdir -p /data/receipts && chown -R app:app /data
USER app
EXPOSE 8080
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Duser.timezone=UTC -Dfile.encoding=UTF-8"
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
