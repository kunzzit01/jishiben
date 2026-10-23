# 内测安装包（APK）存放目录

把构建出来的 APK 放到这个目录，即可通过 web 容器直接对外提供下载：

```
scp jishiben-1.0.0.apk user@vps:/opt/jishiben/deploy/downloads/
```

访问地址：

```
http://<你的IP或域名>:<HTTP_PORT>/downloads/jishiben-1.0.0.apk
```

说明：
- 容器以**只读**方式挂载本目录，容器无法改写宿主机文件。
- 目录内容不进 git（见 .gitignore 的 `deploy/downloads/*.apk`），避免把二进制塞进仓库。
- 用户首次安装需在手机上允许「安装未知来源应用」。
