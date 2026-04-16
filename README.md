![banner](https://io.onenov.cn/file/202412240230660.webp)

# Dify2OpenAI Gateway

[![爱发电](https://afdian.moeci.com/13/badge.svg)](https://afdian.com/@orence)
<a href="./README.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
<a href="./README_EN.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>

**Dify2OpenAI** 是一个将 Dify 应用程序转换为 OpenAI API 接口的网关服务，使您可以使用 OpenAI API 兼容的方式访问 Dify 的 LLM、知识库、工具和工作流程。

---

## 特征

- 将 Dify API 转换为 OpenAI API
- 支持流式传输和阻止
- 在 dify 上支持 Chat、Completion、Agent 和 Workflow bots API

## 支持

- 图像支持
- 变量支持
- 持续对话
- Workflow Bot
- Streaming & Blocking
- Agent & Chat bots

---

## 安装与启动

### 安装依赖

```bash
git clone https://github.com/onenov/Dify2OpenAI.git
cd Dify2OpenAI
npm install
```

### 启动服务

使用 PM2 启动（推荐）：

```bash
# 直接使用PM2命令
pm2 start ecosystem.config.cjs

# 或使用npm脚本
npm run pm2:start
```

或者使用普通方式启动：

```bash
npm run start
```

默认服务会在 `http://localhost:3099` 运行。

### PM2 常用命令

使用PM2直接管理：

```bash
# 查看应用状态
pm2 list

# 查看日志
pm2 logs

# 重启应用
pm2 restart dify2openai

# 停止应用
pm2 stop dify2openai

# 删除应用
pm2 delete dify2openai

# 监控应用
pm2 monit
```

使用npm脚本管理：

```bash
# 启动应用
npm run pm2:start

# 查看日志
npm run pm2:logs

# 重启应用
npm run pm2:restart

# 停止应用
npm run pm2:stop

# 删除应用
npm run pm2:delete

# 监控应用
npm run pm2:monit
```

---

## 一键部署

### Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fonenov%2FDify2OpenAI)

1. 点击上方按钮跳转至 Vercel
2. 创建并导入项目
3. 直接部署即可，无需配置环境变量
4. 部署完成后，可以通过以下三种方式访问：
   - 在 Authorization Header 中传递所有配置
   - 在 Authorization Header 中传递 API_KEY，其他配置通过 model 参数传递
   - 在 Authorization Header 中传递 DIFY_API_URL，其他配置通过 model 参数传递

注意：Vercel 的无服务器函数有 10 秒的超时限制。

---

## 接入方式

当前版本仅保留一种统一接入方式：

- `Authorization` 只传 `DIFY_API_URL`
- `model` 必须传 `dify|BOT_TYPE|API_KEY`

### 统一鉴权格式

**Authorization Header 格式：**

```
Authorization: Bearer <DIFY_API_URL>
```

**`model` 参数格式：**

```json
"model": "dify|BOT_TYPE|API_KEY"
```

### BOT_TYPE 可选值

- `Completion`：文本生成型应用，最终路由到 `/completion-messages`
- `Chat`：对话型应用，最终路由到 `/chat-messages`
- `Workflow`：Workflow 应用，最终路由到 `/workflows/run`

说明：工作流编排对话型应用同样通过 `BOT_TYPE=Chat` 接入，但会保留更完整的 Dify 原始事件流，并通过 `x_dify` 透传。

### 统一示例

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer https://api.dify.ai/v1" \
  -X POST \
  -d '{
    "model": "dify|Chat|app-xxxx",
    "stream": true,
    "response_mode": "streaming",
    "user": "demo-user",
    "messages": [
      {
        "role": "user",
        "content": "你好"
      }
    ]
  }'
```

---

## 开发指南

### 目录结构

```
.
├── app.js              # 应用入口文件
├── botType/           # 机器人类型处理器
│   ├── chatHandler.js     # 聊天处理器
│   ├── completionHandler.js # 补全处理器
│   ├── utils.js           # 工具函数
│   └── workflowHandler.js  # 工作流处理器
├── config/            # 配置文件目录
│   └── logger.js         # 日志配置
├── public/            # 静态文件目录
│   └── index.html        # API 文档页面
├── ecosystem.config.cjs # PM2 配置文件
├── nodemon.json       # Nodemon 配置文件
└── package.json       # 项目配置文件
```

### 开发模式配置

项目使用 nodemon 进行开发模式的热重载，配置如下：

```json
{
  "watch": ["*.js", "botType/*.js", "config/*.js"],
  "ext": "js,json,env",
  "ignore": [
    "node_modules/",
    "*.test.js",
    "logs/*",
    ".git",
    "public/*"
  ],
  "delay": "500",
  "verbose": true
}
```

- `watch`: 监控的文件和目录
- `ext`: 监控的文件扩展名
- `ignore`: 忽略的文件和目录
- `delay`: 延迟重启时间（毫秒）
- `verbose`: 显示详细日志

### 开发流程

1. 克隆项目

```bash
git clone https://github.com/onenov/Dify2OpenAI.git
cd Dify2OpenAI
```

2. 安装依赖

```bash
npm install
```

3. 启动开发服务器

```bash
npm run dev
```

4. 生产环境部署

```bash
npm start
# 或使用 PM2
pm2 start ecosystem.config.cjs
```

### 代码风格

- 使用 ES Modules 导入导出
- 异步操作使用 async/await
- 错误处理使用 try/catch
- 使用 winston 进行日志记录

---

## 日志系统

### 日志配置

默认情况下：

- 生产环境（`npm start`）：只记录错误级别日志，仅在控制台显示
- 开发环境（`npm run dev`）：记录所有级别日志，同时输出到控制台和文件

日志文件存储在 `logs` 目录下：

- `combined-%DATE%.log`: 所有级别的日志
- `error-%DATE%.log`: 仅错误级别的日志

### 日志级别

支持以下日志级别（按严重程度排序）：

- `error`: 错误信息
- `warn`: 警告信息
- `info`: 一般信息
- `debug`: 调试信息

### 日志格式

每条日志包含以下信息：

- 时间戳
- 日志级别
- 详细信息
- 元数据（如果有）

示例：

```json
{
  "level": "info",
  "message": "服务器启动成功",
  "timestamp": "2024-12-24T01:51:10+08:00",
  "port": 3099
}
```

### 日志轮转

日志文件按以下规则自动轮转：

- 按日期轮转（每天一个新文件）
- 单个文件最大 20MB
- 保留最近 14 天的日志
- 超出限制的日志文件会被自动删除

### 性能优化

为了优化性能，日志系统采用以下策略：

- 使用缓冲写入，减少 I/O 操作
- 异步写入，不阻塞主线程
- 自动清理过期日志，控制磁盘占用

---

## 示例

### 基础对话

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer https://api.dify.ai/v1" \
  -X POST \
  -d '{
    "model": "dify|Chat|app-xxxx",
    "stream": true,
    "response_mode": "streaming",
    "user": "demo-user",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "你好"
      }
    ]
  }'
```

### 固定 variable 包裹对象

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer https://api.dify.ai/v1" \
  -X POST \
  -d '{
    "model": "dify|Workflow|app-xxxx",
    "stream": true,
    "response_mode": "streaming",
    "user": "demo-user",
    "query": "请执行这个任务",
    "variable": {
      "task_type": "generic",
      "priority": "normal"
    }
  }'
```

### 顶层 files 字符串数组

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer https://api.dify.ai/v1" \
  -X POST \
  -d '{
    "model": "dify|Chat|app-xxxx",
    "stream": true,
    "response_mode": "streaming",
    "user": "abc-123",
    "query": "What are the specs of the iPhone 13 Pro Max?",
    "conversation_id": "",
    "variable": {},
    "files": [
      "https://example.com/a.png",
      "https://example.com/b.txt",
      "https://example.com/c.mp4"
    ]
  }'
```

### 兼容 messages[].content[].image_url

```bash
curl http://localhost:3099/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer https://api.dify.ai/v1" \
  -X POST \
  -d '{
    "model": "dify|Chat|app-xxxx",
    "stream": true,
    "response_mode": "streaming",
    "user": "abc-123",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "What are the specs of the iPhone 13 Pro Max?"
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://cloud.dify.ai/logo/logo-site.png"
            }
          }
        ]
      }
    ]
  }'
```

---

## 注意事项

- **参数替换**：请将示例中的 `https://api.dify.ai/v1`、`app-xxxx`、`BOT_TYPE` 等参数替换为您实际的值。
- **`model` 格式固定**：必须使用 `dify|BOT_TYPE|API_KEY`。
- **`Authorization` 格式固定**：必须使用 `Bearer <DIFY_API_URL>`。
- **`BOT_TYPE`**：可选值为 `Chat`、`Completion` 或 `Workflow`。
- **`variable`**：支持传递自定义变量，内容会原样进入 Dify `inputs`。可使用 `input_*`、`output_*`、`custom_*`、`system_*`、`user_*` 等变量名；注意需要先在 Dify 开始节点中新增对应的段落类型输入字段。
- **`files`**：支持顶层 `files` 传入字符串数组，自动根据 URL 后缀或 Data URL MIME 推断类型，也兼容 `messages[].content[].image_url`。
- **`stream` 参数**：如果需要流式返回，请将 `stream` 设置为 `true`，否则可以省略或设置为 `false`。
- **`x_dify` 扩展字段**：流式与非流式返回都会尽量保留 Dify 原始事件与元数据，便于调试与工作流事件消费。
- **安全性**：请妥善保管您的 `API_KEY`，不要泄露给无关人员。

---

## 联系

WeChat：**`AOKIEO`** ｜ Mail: **`dev@orence.ai`**

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 更新日志

### 2026-04-16 更新

#### 接口与路由

1. **统一鉴权方式收敛**
   - 移除了旧的三种混合配置方案。
   - 当前只保留 `Authorization: Bearer <DIFY_API_URL>` + `model=dify|BOT_TYPE|API_KEY`。
   - 这样可以让网关的配置解析更稳定，也避免旧格式带来的文档与实现不一致。

2. **统一 OpenAI 兼容入口增强**
   - 继续以 `POST /v1/chat/completions` 作为唯一入口。
   - 覆盖文本生成型应用、对话型应用、工作流编排对话型应用与 Workflow 应用。
   - 根据 `BOT_TYPE` 自动路由到 `/completion-messages`、`/chat-messages` 或 `/workflows/run`。

#### 请求体兼容能力

3. **固定 variable 包裹对象**
   - 当前版本固定使用顶层 `variable` 对象透传为 Dify `inputs`。
   - `variable` 支持传递自定义变量，如 `input_*`、`output_*`、`custom_*`、`system_*`、`user_*` 等，并会原样进入 Dify `inputs`。
   - 使用前需要先在 Dify 开始节点中新增对应的段落类型输入字段。

4. **顶层 files 字符串数组支持**
   - 新增对顶层 `files` 的统一处理。
   - 支持直接传入 URL、base64 Data URL，或 Dify 原生文件对象。
   - 会根据扩展名或 MIME 自动推断为 `image`、`document`、`audio`、`video` 或 `custom`。

5. **兼容 messages.image_url 文件输入**
   - 继续兼容 `messages[].content[].image_url`。
   - 现在会与顶层 `files` 一起统一收集并转换，便于多模态请求复用同一套处理逻辑。

#### 事件与响应

6. **Dify 原始事件透传增强**
   - 在流式与非流式模式下补强 `x_dify` 扩展字段。
   - 尽量保留 Dify 原始事件、工作流节点事件与元数据，方便调试、追踪和上层消费。

7. **工作流编排对话型应用兼容增强**
   - 将工作流编排对话型应用按更通用的 `Chat` 路径兼容，而不是绑定到单一业务场景。
   - 对 `workflow_started`、`node_started`、`node_finished`、`node_retry`、`workflow_finished` 等事件做了更清晰的保留与映射。

#### 文档与页面

8. **静态文档页重构**
   - 新文档补充了统一鉴权、四类应用请求 Schema、严格事件对象结构、SSE 映射规则与响应结构。

---

**感谢您使用 Dify2OpenAI！如果您在使用过程中遇到任何问题，欢迎提问，我们将尽快协助您解决。**
