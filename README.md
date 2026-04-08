# DCU_diag v2

这是一个基于静态前端页面（`dcu_diag.html`）和简易 Node.js 静态后端（`server.js`）的 DCU 诊断工具演示。

## 目录结构

- `dcu_diag.html`：主页面
- `styles.css`：样式文件（拆分自原始 HTML）
- `app.js`：前端业务逻辑（拆分自原始 HTML）
- `server.js`：简易后端静态服务器 + API 探活
- `README.md`：本说明文档

---

## 运行环境（Linux）

- Node.js 16+（或更高）
- 推荐：`npm` 已安装（不是必须）

### 1. 克隆 / 进入项目目录

```bash
cd /path/to/dcu_diag
```

### 2. 安装依赖

本项目使用 `sqlite3` 来持久化日志数据，需执行：

```bash
npm install
```

### 3. 启动服务

```bash
node server.js
```

默认监听 `0.0.0.0:3000`（支持远程访问）。

### 3.1 停止服务

```bash
# 在 Linux/macOS
pkill -f "node server.js"

# 在 Windows PowerShell
taskkill /F /IM node.exe
```

### 4. 访问页面

- 本地访问：`http://localhost:3000/`
- 远程访问：`http://<your-server-ip>:3000/`

### 5. 环境变量配置（可选）

```bash
# 自定义端口
PORT=8080 node server.js

# 自定义主机（默认 0.0.0.0）
HOST=127.0.0.1 node server.js
```

### 6. 验证后端接口

```bash
curl http://localhost:3000/api/status
curl "http://localhost:3000/api/logs?limit=10&offset=0&sort=timestamp&order=DESC"
curl "http://localhost:3000/api/knowledge?limit=10&offset=0&sort=created_at&order=DESC"
```

`/api/logs` 支持参数：

- `limit` (默认 20)
- `offset` (默认 0)
- `sort` (timestamp/id/type/category/severity)
- `order` (ASC/DESC)

`/api/knowledge` 支持参数：

- `module` (XID/DRV/HW/GENERAL)
- `source` (ANALYSIS/MANUAL)
- `limit` (默认 20)
- `offset` (默认 0)
- `sort` (created_at/id)
- `order` (ASC/DESC)

### 7. 知识库接口（新增）

支持两种来源：

1. **导入现有日志分析结果**（`source=ANALYSIS`）
2. **人工手动输入经验知识**（`source=MANUAL`）

新增知识分类（`kbCategory`）：

- 硬件驱动
- DTK
- DAS
- 服务器
- 大模型
- 通用模型

#### 7.1 手动新增知识

```bash
curl -X POST http://localhost:3000/api/knowledge \
  -H "Content-Type: application/json" \
  -d '{
    "source": "MANUAL",
    "module": "HW",
    "kbCategory": "硬件驱动",
    "title": "高温告警排查流程",
    "summary": "优先排查风扇与机房温度",
    "details": "先检查 hy-smi 温度与风扇，再检查风道和机房环境温度。",
    "severity": "WARNING",
    "tags": ["thermal","ops"],
    "confidence": 0.9
  }'
```

#### 7.2 从分析结果批量导入

```bash
curl -X POST http://localhost:3000/api/knowledge/import-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "module": "DRV",
    "kbCategory": "硬件驱动",
    "items": [
      {
        "key": "DRV002",
        "title": "GPU 环形缓冲区超时",
        "summary": "驱动命令执行超时",
        "details": "观察到 ring gfx timeout，建议结合 XID 76/77 一并排查。",
        "severity": "ERROR",
        "tags": ["timeout","driver"],
        "confidence": 0.85
      }
    ]
  }'
```

#### 7.3 删除知识

```bash
# 删除单条
curl -X DELETE "http://localhost:3000/api/knowledge?id=1"

# 删除全部
curl -X DELETE "http://localhost:3000/api/knowledge"
```

#### 7.4 日志上传与自动分析（知识库优先，低匹配度走大模型）

```bash
# 上传日志
curl -X POST http://localhost:3000/api/log-upload \
  -H "Content-Type: application/json" \
  -d '{"logText":"driver firmware timeout error on server","source":"WEB_UI"}'

# 自动分析：优先知识库匹配；若匹配度低则返回 LLM_FALLBACK
curl -X POST http://localhost:3000/api/analyze-log \
  -H "Content-Type: application/json" \
  -d '{"logText":"firmware timeout error"}'
```

预期输出：

```json
{
  "status": "ok",
  "message": "DCU diag backend available"
}
```

---

## 功能说明

- XID/SXID 日志解析
- 驱动日志规则匹配（`DRV_KB`）
- 硬件日志规则匹配（`HW_KB`）
- 事件列表、详情面板、导出报告

---

## 本地调试

- 编辑 `dcu_diag.html`、`app.js`、`styles.css`
- 刷新浏览器页面查看效果

---

## 安全注意

- 默认配置 `HOST=0.0.0.0` 允许远程访问，请确保防火墙和网络安全。
- 生产环境建议使用反向代理（如 Nginx）并配置 HTTPS。
- 数据库文件 `dcu_diag.db` 存储敏感数据，定期备份。

## 防火墙配置（Linux）

```bash
# 开放 3000 端口
sudo ufw allow 3000/tcp

# 或使用 iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```
