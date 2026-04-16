![banner](https://io.onenov.cn/file/202412240230660.webp)

# Dify2OpenAI Gateway

[![爱发电](https://afdian.moeci.com/13/badge.svg)](https://afdian.com/@orence)
<a href="./README.md"><img alt="简体中文版自述文件" src="https://img.shields.io/badge/简体中文-d9d9d9"></a>
<a href="./README_EN.md"><img alt="README in English" src="https://img.shields.io/badge/English-d9d9d9"></a>

**Dify2OpenAI** is a gateway service that transforms Dify applications into OpenAI API-compatible interfaces, allowing you to access Dify's LLM, Knowledge Base, Tools, and Workflows using OpenAI API-compatible methods.

---

## Features

- Convert Dify API to OpenAI API
- Support streaming and blocking
- Support Chat, Completion, Agent, and Workflow bots API on Dify

## Support

- Image Support
- Variable Support
- Continuous Conversation
- Workflow Bot
- Streaming & Blocking
- Agent & Chat bots

---

## Quick Start

### Installation & Startup

```bash
git clone https://github.com/onenov/Dify2OpenAI.git
cd Dify2OpenAI
npm install
```

### Start Service

Using PM2 (Recommended):

```bash
# Directly using PM2 command
pm2 start ecosystem.config.cjs

# Or using npm scripts
npm run pm2:start
```

Or start normally:

```bash
npm run start
```

The service will run on `http://localhost:3099` by default.

### PM2 Common Commands

Manage directly with PM2:

```bash
# View application status
pm2 list

# View logs
pm2 logs

# Restart application
pm2 restart dify2openai

# Stop application
pm2 stop dify2openai

# Delete application
pm2 delete dify2openai

# Monitor application
pm2 monit
```

Manage using npm scripts:

```bash
# Start application
npm run pm2:start

# View logs
npm run pm2:logs

# Restart application
npm run pm2:restart

# Stop application
npm run pm2:stop

# Delete application
npm run pm2:delete

# Monitor application
npm run pm2:monit
```

---

## One-Click Deploy

### Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fonenov%2FDify2OpenAI)

1. Click the button above to go to Vercel
2. Create and import the project
3. Deploy directly, no environment variables needed
4. After deployment, you can access it in three ways:
   - Pass all configurations in the Authorization Header
   - Pass API_KEY in the Authorization Header, other configurations through the model parameter
   - Pass DIFY_API_URL in the Authorization Header, other configurations through the model parameter

Note: Vercel serverless functions have a 10-second timeout limit.

---

## Access Method

The current version only keeps one unified access mode:

- `Authorization` only carries `DIFY_API_URL`
- `model` must be `dify|BOT_TYPE|API_KEY`

### Unified Authentication Format

**Authorization Header Format:**

```
Authorization: Bearer <DIFY_API_URL>
```

**Model Parameter Format:**

```json
"model": "dify|BOT_TYPE|API_KEY"
```

### Available BOT_TYPE Values

- `Completion`: text generation app, routed to `/completion-messages`
- `Chat`: chat app, routed to `/chat-messages`
- `Workflow`: workflow app, routed to `/workflows/run`

Note: workflow-orchestrated chat apps also use `BOT_TYPE=Chat`, while preserving richer raw Dify events through `x_dify`.

## Examples

### Basic Chat

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
        "content": "Hello"
      }
    ]
  }'
```

### Fixed `variable` Wrapper Object

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
    "query": "Please execute this task.",
    "variable": {
      "task_type": "generic",
      "priority": "normal"
    }
  }'
```

### Top-Level `files` String Array

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

### Compatible with `messages[].content[].image_url`

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

## Notes

- **Parameter Replacement**: Replace `https://api.dify.ai/v1`, `app-xxxx`, and `BOT_TYPE` with your actual values.
- **Fixed `model` Format**: You must use `dify|BOT_TYPE|API_KEY`.
- **Fixed `Authorization` Format**: You must use `Bearer <DIFY_API_URL>`.
- **`BOT_TYPE`**: Available values are `Chat`, `Completion`, or `Workflow`.
- **`variable`**: Supports custom variables and passes them through to Dify `inputs` as-is. You can use variable names such as `input_*`, `output_*`, `custom_*`, `system_*`, and `user_*`; make sure to create the corresponding paragraph-type input fields in the Dify Start node first.
- **`files`**: Supports top-level `files` as a string array, with automatic type inference by URL suffix or Data URL MIME. `messages[].content[].image_url` is also supported.
- **`stream`**: Set `stream` to `true` for streaming responses, otherwise omit it or set it to `false`.
- **`x_dify` Extension Field**: Both streaming and blocking modes preserve Dify raw events and metadata as much as possible for debugging and workflow event consumption.
- **Security**: Keep your `API_KEY` secure and do not share it with unauthorized parties.

---

## Development Guide

### Directory Structure

```
.
├── app.js              # Application entry file
├── botType/           # Bot type handlers
│   ├── chatHandler.js     # Chat handler
│   ├── completionHandler.js # Completion handler
│   ├── utils.js           # Utility functions
│   └── workflowHandler.js  # Workflow handler
├── config/            # Configuration files
│   └── logger.js         # Logger configuration
├── public/            # Static files directory
│   └── index.html        # API documentation page
├── ecosystem.config.cjs # PM2 configuration file
├── nodemon.json       # Nodemon configuration file
└── package.json       # Project configuration file
```

### Development Mode Configuration

The project uses nodemon for hot reloading in development mode:

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

- `watch`: Files and directories to monitor
- `ext`: File extensions to monitor
- `ignore`: Files and directories to ignore
- `delay`: Restart delay in milliseconds
- `verbose`: Show detailed logs

### Development Process

1. Clone the project

```bash
git clone https://github.com/onenov/Dify2OpenAI.git
cd Dify2OpenAI
```

2. Install dependencies

```bash
npm install
```

3. Start development server

```bash
npm run dev
```

4. Production deployment

```bash
npm start
# or using PM2
pm2 start ecosystem.config.cjs
```

### Code Style

- Use ES Modules for imports/exports
- Use async/await for asynchronous operations
- Use try/catch for error handling
- Use winston for logging

---

## Logging System

### Log Configuration

By default:

- Production environment (`npm start`): Only logs error level, console output only
- Development environment (`npm run dev`): Logs all levels, outputs to both console and file

Log files are stored in the `logs` directory:

- `combined-%DATE%.log`: Logs of all levels
- `error-%DATE%.log`: Error level logs only

### Log Levels

Supports the following log levels (in order of severity):

- `error`: Error messages
- `warn`: Warning messages
- `info`: General information
- `debug`: Debug information

### Log Format

Each log entry contains:

- Timestamp
- Log level
- Detailed message
- Metadata (if any)

Example:

```json
{
  "level": "info",
  "message": "Server started successfully",
  "timestamp": "2024-12-24T01:51:10+08:00",
  "port": 3099
}
```

### Log Rotation

Log files are automatically rotated according to:

- Daily rotation (new file each day)
- Maximum file size of 20MB
- Keep logs for the last 14 days
- Automatically delete logs exceeding limits

### Performance Optimization

For performance, the logging system:

- Uses buffered writing to reduce I/O operations
- Writes asynchronously to avoid blocking the main thread
- Automatically cleans up expired logs to control disk usage

---

## Support

WeChat：**`AOKIEO`** ｜ Mail: **`dev@orence.ai`**

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Changelog

### 2026-04-16

#### API and Routing

1. **Unified authentication format simplified**
   - Removed the previous mixed configuration modes.
   - The gateway now only supports `Authorization: Bearer <DIFY_API_URL>` plus `model=dify|BOT_TYPE|API_KEY`.
   - This keeps runtime behavior and documentation aligned.

2. **Unified OpenAI-compatible entry improved**
   - `POST /v1/chat/completions` remains the only public entry.
   - It now clearly covers text generation apps, chat apps, workflow-orchestrated chat apps, and workflow apps.
   - Requests are routed automatically to `/completion-messages`, `/chat-messages`, or `/workflows/run` based on `BOT_TYPE`.

#### Request Compatibility

3. **Fixed `variable` wrapper object**
   - The current version uses the top-level `variable` object as the documented way to pass Dify `inputs`.
   - `variable` supports custom variables such as `input_*`, `output_*`, `custom_*`, `system_*`, and `user_*`, and passes them through to Dify `inputs` as-is.
   - Make sure the corresponding paragraph-type input fields are created in the Dify Start node first.

4. **Top-level `files` string array support**
   - Added unified handling for top-level `files`.
   - Supports URL strings, base64 Data URLs, and native Dify file objects.
   - File type is inferred automatically as `image`, `document`, `audio`, `video`, or `custom`.

5. **`messages.image_url` compatibility retained**
   - `messages[].content[].image_url` is still supported.
   - It is now collected and normalized together with top-level `files` for a more consistent multimodal pipeline.

#### Events and Responses

6. **Raw Dify event passthrough enhanced**
   - The `x_dify` extension field has been strengthened in both streaming and blocking modes.
   - Raw Dify events, workflow node events, and metadata are preserved as much as possible for debugging and upper-layer consumers.

7. **Workflow-orchestrated chat compatibility improved**
   - Workflow-orchestrated chat is handled through the more general `Chat` path instead of a single narrow scenario.
   - Workflow events such as `workflow_started`, `node_started`, `node_finished`, `node_retry`, and `workflow_finished` are preserved more clearly.

#### Documentation and UI

8. **Static documentation page rebuilt**
   - Removed the OpenAPI / Scalar runtime documentation dependency from the main page.
   - `public/index.html` now serves as the single static documentation page.

9. **Documentation interaction improved**
   - The page now supports dynamic `DIFY_API_URL`, `API_KEY`, and `BOT_TYPE` inputs for generating request schemas and cURL examples.
   - Request schema tabs are split into `Completion`, `Chat`, `Advanced Chat`, and `Workflow`.
   - Code blocks support copy buttons, the header includes mail and GitHub icons, and the footer uses an auto-updated year.

---

**Thank you for using Dify2OpenAI! If you encounter any problems during use, please feel free to ask and we will assist you as soon as possible.**