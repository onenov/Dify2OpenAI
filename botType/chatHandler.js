import fetch from "node-fetch";
import { PassThrough } from "stream";

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

function resolveChatUser(data) {
  if (typeof data.user === "string" && data.user.trim()) {
    return data.user.trim();
  }

  return "apiuser";
}

function resolveChatQuery(data) {
  if (typeof data.query === "string" && data.query.trim()) {
    return data.query.trim();
  }

  if (typeof data.prompt === "string" && data.prompt.trim()) {
    return data.prompt.trim();
  }

  const messages = Array.isArray(data.messages) ? data.messages : [];
  const lastMessage = messages[messages.length - 1];
  return extractTextFromContent(lastMessage?.content);
}

function resolveChatInputs(data) {
  return normalizeAdaptiveInputs(data);
}

function resolveResponseMode(data) {
  if (data.response_mode === "streaming" || data.response_mode === "blocking") {
    return data.response_mode;
  }

  return data.stream ? "streaming" : "blocking";
}

function resolveConversationId(data) {
  if (typeof data.conversation_id === "string") {
    return data.conversation_id;
  }

  return "";
}

function resolveAutoGenerateName(data) {
  if (typeof data.auto_generate_name === "boolean") {
    return data.auto_generate_name;
  }

  return true;
}

function resolveTraceId(req, data) {
  const headerTraceId = req.headers["x-trace-id"];
  if (typeof headerTraceId === "string" && headerTraceId.trim()) {
    return headerTraceId.trim();
  }

  const queryTraceId = req.query?.trace_id;
  if (typeof queryTraceId === "string" && queryTraceId.trim()) {
    return queryTraceId.trim();
  }

  if (typeof data.trace_id === "string" && data.trace_id.trim()) {
    return data.trace_id.trim();
  }

  return null;
}

function buildChatRequestBody(req, data, files, userId) {
  const body = {
    inputs: resolveChatInputs(data),
    query: resolveChatQuery(data),
    response_mode: resolveResponseMode(data),
    conversation_id: resolveConversationId(data),
    user: userId,
    files,
    auto_generate_name: resolveAutoGenerateName(data),
  };

  if (typeof data.workflow_id === "string" && data.workflow_id.trim()) {
    body.workflow_id = data.workflow_id.trim();
  }

  const traceId = resolveTraceId(req, data);
  if (traceId) {
    body.trace_id = traceId;
  }

  return body;
}

function resolveOpenAiModel(req) {
  if (typeof req.body?.model === "string" && req.body.model.trim()) {
    return req.body.model.trim();
  }

  return "dify";
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

const TEXT_OUTPUT_EVENTS = new Set(["message", "agent_message", "message_replace"]);
const TERMINAL_EVENTS = new Set(["message_end", "workflow_finished"]);

function resolveTextContentFromEvent(event) {
  if (event.event === "text_chunk") {
    return event?.data?.text || "";
  }

  if (TEXT_OUTPUT_EVENTS.has(event.event)) {
    return event.answer || "";
  }

  return "";
}

async function handleStreamingResponse({ req, res, resp, requestId }) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const model = resolveOpenAiModel(req);
  let responseEnded = false;
  let pendingTerminalEvent = null;
  let lastExtensionEvent = null;
  const responseStream = resp.body.pipe(new PassThrough());

  const emitExtensionOnlyChunk = (event) => {
    lastExtensionEvent = event;
    writeOpenAiChunk(res, model, null, null, buildDifyChunkExtension(event));
  };

  const finalizeStreamingResponse = (event) => {
    if (responseEnded) {
      return;
    }

    writeOpenAiChunk(
      res,
      model,
      null,
      "stop",
      event ? buildDifyChunkExtension(event) : null,
    );
    res.write("data: [DONE]\n\n");
    res.end();
    responseEnded = true;
  };

  const parseChunk = createDifySseParser((event) => {
    log("debug", "处理 Chat SSE 事件", {
      requestId,
      event: sanitizeLog(event),
    });

    if (responseEnded) {
      return;
    }

    const textContent = resolveTextContentFromEvent(event);
    if (textContent) {
      lastExtensionEvent = event;
      writeOpenAiChunk(res, model, textContent, null, buildDifyChunkExtension(event));
      return;
    }

    if (TERMINAL_EVENTS.has(event.event)) {
      pendingTerminalEvent = event;
      emitExtensionOnlyChunk(event);

      if (event.event === "workflow_finished") {
        finalizeStreamingResponse(event);
      }
      return;
    }

    if (event.event === "error") {
      emitExtensionOnlyChunk(event);
      res.write(`data: ${JSON.stringify({ error: event.message || "Dify streaming error" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      responseEnded = true;
      return;
    }

    emitExtensionOnlyChunk(event);
  });

  responseStream.on("data", parseChunk);
  responseStream.on("end", () => {
    if (!responseEnded) {
      finalizeStreamingResponse(pendingTerminalEvent || lastExtensionEvent);
    }

    log("info", "Chat 流式响应结束", {
      requestId,
      pendingTerminalEvent: pendingTerminalEvent?.event ?? null,
      lastExtensionEvent: lastExtensionEvent?.event ?? null,
    });
  });
}

async function handleBlockingResponse({ req, res, resp, requestId }) {
  const difyResponse = await resp.json();
  const answer = difyResponse.answer ?? difyResponse.data?.answer ?? "";

  const formattedResponse = {
    id: `chatcmpl-${difyResponse.message_id || difyResponse.id || generateId()}`,
    object: "chat.completion",
    created: difyResponse.created_at || Math.floor(Date.now() / 1000),
    model: resolveOpenAiModel(req),
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
    const userId = resolveChatUser(data);

    log("info", "收到 Chat 请求", {
      requestId,
      headers: sanitizeLog(req.headers),
      body: sanitizeLog(data),
      messageCount: messages.length,
      conversationId: resolveConversationId(data),
      responseMode: resolveResponseMode(data),
      hasWorkflowId: typeof data.workflow_id === "string" && Boolean(data.workflow_id.trim()),
    });

    const files = await collectDifyFiles(data, config, userId, requestId);
    const requestBody = buildChatRequestBody(req, data, files, userId);
    const apiPath = "/chat-messages";
    const requestUrl = `${config.DIFY_API_URL}${apiPath}`;

    log("info", "发送 Chat 请求到 Dify", {
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

    const apiCallDuration = Date.now() - startTime;
    logApiCall(requestId, config, apiPath, apiCallDuration);

    log("info", "收到 Chat Dify 响应", {
      requestId,
      status: resp.status,
      statusText: resp.statusText,
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      log("error", "Chat Dify API 请求失败", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        errorBody,
      });
      res.status(resp.status).send(errorBody);
      return;
    }

    if (requestBody.response_mode === "streaming") {
      await handleStreamingResponse({ req, res, resp, requestId });
      return;
    }

    await handleBlockingResponse({ req, res, resp, requestId });
  } catch (error) {
    log("error", "处理 Chat 请求时发生错误", {
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
