#!/bin/bash
# 构建并上传到服务器
set -e

npm run build
rsync -av dist/ shop@example.com:/srv/tea-shop/
echo "done"
