// app.js

import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import FormData from "form-data";
import { PassThrough } from "stream";
import { log } from './config/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { Tail } from 'tail';
import http from 'http';

// 引入各 bot 类型的处理器
import chatHandler from "./botType/chatHandler.js";
import completionHandler from "./botType/completionHandler.js";
import workflowHandler from "./botType/workflowHandler.js";

// 从 utils.js 中导入工具函数
import {
  sanitizeLog,
  logRequest,
  logResponse,
  logApiCall,
  generateId,
} from "./botType/utils.js";

// 定义 parseConfig 函数
function parseConfig(authHeader, modelParam) {
  log("debug", "开始解析配置", {
    authHeader: authHeader ? authHeader.substring(0, 20) + "..." : "No Auth Header",
    modelParam,
  });

  let config = {};

  // 从 Authorization header 获取信息
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log("error", "缺少或无效的 Authorization header");
    throw new Error("Missing or invalid Authorization header");
  }

  const [_, token] = authHeader.split("Bearer ");
  const tokenParts = token.split("|");

  // 方式一：所有信息都在 Authorization header 中
  if (tokenParts.length >= 3) {
    const [difyApiUrl, apiKey, botType, inputVariable, outputVariable, apiUser] = tokenParts;
    config = {
      DIFY_API_URL: difyApiUrl,
      API_KEY: apiKey,
      BOT_TYPE: botType,
      INPUT_VARIABLE: inputVariable || "query",
      OUTPUT_VARIABLE: outputVariable || "text",
      API_USER: apiUser || "apiuser",
    };
    log("info", "配置解析成功 - 方式一", config);
    return config;
  }

  // 方式二和方式三的处理
  if (tokenParts.length === 1) {
    const singleValue = tokenParts[0].trim();

    // 解析 model 参数
    if (!modelParam) {
      log("error", "缺少 model 参数");
      throw new Error("Missing model parameter");
    }

    const modelParts = modelParam.split("|");
    if (modelParts[0] !== "dify" || modelParts.length < 3) {
      log("error", "无效的 model 参数格式");
      throw new Error("Invalid model parameter format");
    }

    // 方式二：Authorization 是 API_KEY
    if (singleValue.length > 0 && !singleValue.includes("http")) {
      config.API_KEY = singleValue;
      const [_, botType, difyApiUrl, inputVariable, outputVariable, apiUser] = modelParts;
      config.DIFY_API_URL = difyApiUrl;
      config.BOT_TYPE = botType;
      config.INPUT_VARIABLE = inputVariable || "query";
      config.OUTPUT_VARIABLE = outputVariable || "text";
      config.API_USER = apiUser || "apiuser";
      log("info", "配置解析成功 - 方式二", config);
    }
    // 方式三：Authorization 是 DIFY_API_URL
    else {
      config.DIFY_API_URL = singleValue;
      const [_, apiKey, botType, inputVariable, outputVariable, apiUser] = modelParts;
      config.API_KEY = apiKey;
      config.BOT_TYPE = botType;
      config.INPUT_VARIABLE = inputVariable || "query";
      config.OUTPUT_VARIABLE = outputVariable || "text";
      config.API_USER = apiUser || "apiuser";
      log("info", "配置解析成功 - 方式三", config);
    }
  }

  // 验证必要的配置参数
  if (!config.DIFY_API_URL || !config.API_KEY || !config.BOT_TYPE) {
    log("error", "缺少必要的配置参数", {
      DIFY_API_URL: !!config.DIFY_API_URL,
      API_KEY: !!config.API_KEY,
      BOT_TYPE: !!config.BOT_TYPE,
      config
    });
    throw new Error("Missing required configuration parameters");
  }

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

// 获取模型列表
app.get("/v1/models", (req, res) => {
  const models = {
    object: "list",
    data: [
      {
        id: "dify",
        object: "model",
        owned_by: "dify",
        permission: null,
        capabilities: {
          vision: true,
          file_processing: true,
        },
      },
    ],
  };
  res.json(models);
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

server.listen(process.env.PORT || 3099, () => {
  log('info', '服务器启动成功', {
    port: process.env.PORT || 3099,
    env: process.env.NODE_ENV || 'development'
  });
});
