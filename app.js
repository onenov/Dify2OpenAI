// app.js

import express from "express";
import { log } from './config/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

// 引入各 bot 类型的处理器
import chatHandler from "./botType/chatHandler.js";
import completionHandler from "./botType/completionHandler.js";
import workflowHandler from "./botType/workflowHandler.js";

// 从 utils.js 中导入工具函数
import {
  logRequest,
  generateId,
} from "./botType/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseConfig(authHeader, modelParam) {
  log("debug", "开始解析配置", {
    authHeader: authHeader ? authHeader.substring(0, 20) + "..." : "No Auth Header",
    modelParam,
  });

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log("error", "缺少或无效的 Authorization header");
    throw new Error("Missing or invalid Authorization header");
  }

  const difyApiUrl = authHeader.slice("Bearer ".length).trim();
  if (!difyApiUrl) {
    log("error", "Authorization 中缺少 DIFY_API_URL");
    throw new Error("Missing DIFY_API_URL in Authorization header");
  }

  if (!modelParam) {
    log("error", "缺少 model 参数");
    throw new Error("Missing model parameter");
  }

  const modelParts = modelParam.split("|");
  if (modelParts.length !== 3 || modelParts[0] !== "dify") {
    log("error", "无效的 model 参数格式", { modelParam });
    throw new Error("Invalid model parameter format");
  }

  const [, botType, apiKey] = modelParts;
  const config = {
    DIFY_API_URL: difyApiUrl,
    API_KEY: apiKey?.trim() || "",
    BOT_TYPE: botType?.trim() || "",
  };

  if (!config.DIFY_API_URL || !config.API_KEY || !config.BOT_TYPE) {
    log("error", "缺少必要的配置参数", {
      DIFY_API_URL: !!config.DIFY_API_URL,
      API_KEY: !!config.API_KEY,
      BOT_TYPE: !!config.BOT_TYPE,
      config,
    });
    throw new Error("Missing required configuration parameters");
  }

  log("info", "配置解析成功 - 唯一模式", {
    DIFY_API_URL: config.DIFY_API_URL,
    BOT_TYPE: config.BOT_TYPE,
    API_KEY: config.API_KEY,
  });

  return config;
}

const app = express();

// 配置 CORS 中间件，允许所有跨域请求
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Credentials", true);
  res.header("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// 配置静态文件服务
app.use(express.static('public'));

// 配置请求体解析
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(express.raw({ limit: "100mb" }));

// 添加请求体日志（仅开发环境）
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development' && req.method === "POST") {
    log('debug', 'Raw request body', { body: req.body });
  }
  next();
});

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    log('info', 'Incoming request', {
      method: req.method,
      path: req.path
    });
  }
  next();
});

// 根路径
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 处理 /v1/chat/completions 请求
app.post("/v1/chat/completions", async (req, res) => {
  const requestId = generateId();
  const startTime = Date.now();

  // 记录请求详情
  logRequest(req, requestId);

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    const error = new Error("Missing Authorization header");
    log("error", "缺少 Authorization header", {
      requestId,
      error: error.message,
      stack: error.stack,
    });
    return res.status(401).json({ error: "Missing Authorization header" });
  }

  try {
    // 解析配置
    const config = parseConfig(authHeader, req.body.model);
    const botType = config.BOT_TYPE;

    log("debug", "请求参数处理", {
      requestId,
      botType,
    });

    // 根据 botType 分发请求
    if (botType === "Chat") {
      await chatHandler.handleRequest(req, res, config, requestId, startTime);
    } else if (botType === "Completion") {
      await completionHandler.handleRequest(
        req,
        res,
        config,
        requestId,
        startTime
      );
    } else if (botType === "Workflow") {
      await workflowHandler.handleRequest(
        req,
        res,
        config,
        requestId,
        startTime
      );
    } else {
      log("error", "无效的 bot 类型", { botType });
      throw new Error("Invalid bot type in configuration.");
    }
  } catch (error) {
    // 详细记录错误信息
    log("error", "处理请求时发生错误", {
      requestId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({ error: error.message });
  }
});

const server = http.createServer(app);
const port = Number(process.env.PORT) || 3099;

server.listen(port, () => {
  log('info', '服务器启动成功', {
    port,
    env: process.env.NODE_ENV || 'development',
    local_url: `http://127.0.0.1:${port}`,
  });
});
