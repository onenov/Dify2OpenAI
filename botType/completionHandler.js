import { PassThrough } from "stream";
import fetch from "node-fetch";

import { log } from "../config/logger.js";
import { logApiCall, logResponse, generateId, sanitizeLog } from "./utils.js";
import {
  collectDifyFiles,
  createDifySseParser,
  extractTextFromContent,
  normalizeAdaptiveInputs,
  mapDifyUsage,
  buildDifyChunkExtension,
  buildDifyResponseExtension,
} from "./shared.js";

function resolveCompletionUser(data) {
  if (typeof data.user === "string" && data.user.trim()) {
    return data.user.trim();
  }

  return "apiuser";
}

function resolveCompletionPrompt(data) {
  if (typeof data.prompt === "string" && data.prompt.trim()) {
    return data.prompt.trim();
  }

  const messages = Array.isArray(data.messages) ? data.messages : [];
  const lastMessage = messages[messages.length - 1];
  return extractTextFromContent(lastMessage?.content);
}

function normalizeCompletionInputs(data, prompt) {
  const rawInputs = normalizeAdaptiveInputs(data);

  if (!rawInputs.query && prompt) {
    rawInputs.query = prompt;
  }

  return rawInputs;
}

function buildCompletionRequestBody(data, config, files, userId) {
  const prompt = resolveCompletionPrompt(data);
  const inputs = normalizeCompletionInputs(data, prompt);

  return {
    inputs,
    response_mode: data.stream ? "streaming" : "blocking",
    user: userId,
    files,
  };
}

function writeOpenAiChunk(res, model, content, finishReason = null, extension = null) {
  const payload = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: finishReason,
      },
    ],
  };

  if (extension) {
    payload.x_dify = extension;
  }

  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleStreamingResponse({ req, res, resp, requestId }) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  let responseEnded = false;

  const responseStream = resp.body.pipe(new PassThrough());
  const parseChunk = createDifySseParser((event) => {
    log("debug", "处理 Completion SSE 事件", {
      requestId,
      event: sanitizeLog(event),
    });

    if (responseEnded) {
      return;
    }

    if (["message", "agent_message"].includes(event.event)) {
      if (event.answer) {
        writeOpenAiChunk(
          res,
          req.body.model,
          event.answer,
          null,
          buildDifyChunkExtension(event),
        );
      }
      return;
    }

    if (event.event === "text_chunk") {
      const text = event?.data?.text || "";
      if (text) {
        writeOpenAiChunk(
          res,
          req.body.model,
          text,
          null,
          buildDifyChunkExtension(event),
        );
      }
      return;
    }

    if (event.event === "message_replace") {
      if (event.answer) {
        writeOpenAiChunk(
          res,
          req.body.model,
          event.answer,
          null,
          buildDifyChunkExtension(event),
        );
      }
      return;
    }

    if (event.event === "message_end") {
      writeOpenAiChunk(
        res,
        req.body.model,
        null,
        "stop",
        buildDifyChunkExtension(event),
      );
      res.write("data: [DONE]\n\n");
      res.end();
      responseEnded = true;
      return;
    }

    if (event.event === "error") {
      res.write(`data: ${JSON.stringify({ error: event.message || "Dify streaming error" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      responseEnded = true;
    }
  });

  responseStream.on("data", parseChunk);
  responseStream.on("end", () => {
    if (!responseEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }

    log("info", "Completion 流式响应结束", { requestId });
  });
}

async function handleBlockingResponse({ req, res, resp, requestId }) {
  const difyResponse = await resp.json();
  const answer = difyResponse.answer ?? difyResponse.data?.text ?? "";

  const formattedResponse = {
    id: `chatcmpl-${difyResponse.message_id || difyResponse.id || generateId()}`,
    object: "chat.completion",
    created: difyResponse.created_at || Math.floor(Date.now() / 1000),
    model: req.body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: String(answer).trim(),
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: mapDifyUsage(difyResponse.metadata),
    system_fingerprint: "fp_2f57f81c11",
    x_dify: buildDifyResponseExtension(difyResponse),
  };

  logResponse(requestId, 200, formattedResponse);
  res.set("Content-Type", "application/json");
  res.send(JSON.stringify(formattedResponse, null, 2));
}

async function handleRequest(req, res, config, requestId, startTime) {
  try {
    const data = req.body || {};
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const userId = resolveCompletionUser(data);

    log("info", "收到 Completion 请求", {
      requestId,
      headers: sanitizeLog(req.headers),
      body: sanitizeLog(data),
      messageCount: messages.length,
      hasPrompt: Boolean(resolveCompletionPrompt(data)),
    });

    const files = await collectDifyFiles(data, config, userId, requestId);
    const requestBody = buildCompletionRequestBody(data, config, files, userId);
    const apiPath = "/completion-messages";
    const requestUrl = `${config.DIFY_API_URL}${apiPath}`;

    log("info", "发送 Completion 请求到 Dify", {
      requestId,
      url: requestUrl,
      method: "POST",
      headers: sanitizeLog({
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.API_KEY}`,
      }),
      body: sanitizeLog(requestBody),
    });

    const resp = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    logApiCall(requestId, config, apiPath, Date.now() - startTime);

    if (!resp.ok) {
      const errorBody = await resp.text();
      log("error", "Completion Dify 请求失败", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        errorBody,
      });
      res.status(resp.status).send(errorBody);
      return;
    }

    if (data.stream) {
      await handleStreamingResponse({ req, res, resp, requestId });
      return;
    }

    await handleBlockingResponse({ req, res, resp, requestId });
  } catch (error) {
    log("error", "处理 Completion 请求时发生错误", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({ error: error.message });
  }
}

export default {
  handleRequest,
};
