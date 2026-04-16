import fetch from "node-fetch";
import { PassThrough } from "stream";

import { log } from "../config/logger.js";
import { logApiCall, logResponse, generateId, sanitizeLog } from "./utils.js";
import {
  collectDifyFiles,
  createDifySseParser,
  extractTextFromContent,
  normalizeAdaptiveInputs,
  buildDifyChunkExtension,
  buildDifyResponseExtension,
} from "./shared.js";

function resolveWorkflowUser(data) {
  if (typeof data.user === "string" && data.user.trim()) {
    return data.user.trim();
  }

  return "apiuser";
}

function resolveWorkflowResponseMode(data) {
  if (data.response_mode === "streaming" || data.response_mode === "blocking") {
    return data.response_mode;
  }

  return data.stream ? "streaming" : "blocking";
}

function resolveWorkflowTextInput(data) {
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

function resolveWorkflowInputs(data) {
  const rawInputs = normalizeAdaptiveInputs(data);

  const inputText = resolveWorkflowTextInput(data);

  if (inputText && rawInputs.query == null) {
    rawInputs.query = inputText;
  }

  return rawInputs;
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

function resolveWorkflowPath(data) {
  if (typeof data.workflow_id === "string" && data.workflow_id.trim()) {
    return `/workflows/${encodeURIComponent(data.workflow_id.trim())}/run`;
  }

  return "/workflows/run";
}

function buildWorkflowRequestBody(req, data, files, userId) {
  const body = {
    inputs: resolveWorkflowInputs(data),
    response_mode: resolveWorkflowResponseMode(data),
    user: userId,
    files,
  };

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

function resolveWorkflowTextFromEvent(event) {
  if (event.event === "text_chunk") {
    return event?.data?.text || "";
  }

  if (event.event === "workflow_finished") {
    const outputs = event?.data?.outputs;
    if (!outputs || typeof outputs !== "object") {
      return "";
    }

    const preferredOutput = outputs.text ?? outputs.output ?? outputs.result ?? null;

    if (typeof preferredOutput === "string") {
      return preferredOutput;
    }

    if (preferredOutput != null) {
      return JSON.stringify(preferredOutput);
    }
  }

  return "";
}

function resolveWorkflowBlockingContent(difyResponse) {
  const outputs = difyResponse?.data?.outputs;
  if (!outputs || typeof outputs !== "object") {
    return "";
  }

  const preferredOutput = outputs.text ?? outputs.output ?? outputs.result ?? null;

  if (typeof preferredOutput === "string") {
    return preferredOutput.trim();
  }

  if (preferredOutput != null) {
    return JSON.stringify(preferredOutput);
  }

  return JSON.stringify(outputs);
}

function resolveWorkflowUsage(difyResponse) {
  const totalTokens = Number(difyResponse?.data?.total_tokens ?? 0) || 0;

  return {
    prompt_tokens: 0,
    completion_tokens: totalTokens,
    total_tokens: totalTokens,
  };
}

async function handleStreamingResponse({ req, res, resp, requestId, config }) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const model = resolveOpenAiModel(req);
  let responseEnded = false;
  let workflowFinishedEvent = null;
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
    log("debug", "处理 Workflow SSE 事件", {
      requestId,
      event: sanitizeLog(event),
    });

    if (responseEnded) {
      return;
    }

    if (event.event === "error") {
      emitExtensionOnlyChunk(event);
      res.write(`data: ${JSON.stringify({ error: event.message || "Dify workflow streaming error" })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      responseEnded = true;
      return;
    }

    const textContent = resolveWorkflowTextFromEvent(event);
    if (event.event === "text_chunk" && textContent) {
      lastExtensionEvent = event;
      writeOpenAiChunk(res, model, textContent, null, buildDifyChunkExtension(event));
      return;
    }

    if (event.event === "workflow_finished") {
      workflowFinishedEvent = event;
      emitExtensionOnlyChunk(event);

      const finalContent = resolveWorkflowTextFromEvent(event);
      if (finalContent) {
        writeOpenAiChunk(res, model, finalContent, null, buildDifyChunkExtension(event));
      }

      finalizeStreamingResponse(event);
      return;
    }

    emitExtensionOnlyChunk(event);
  });

  responseStream.on("data", parseChunk);
  responseStream.on("end", () => {
    if (!responseEnded) {
      finalizeStreamingResponse(workflowFinishedEvent || lastExtensionEvent);
    }

    log("info", "Workflow 流式响应结束", {
      requestId,
      workflowFinished: Boolean(workflowFinishedEvent),
      lastExtensionEvent: lastExtensionEvent?.event ?? null,
    });
  });
}

async function handleBlockingResponse({ req, res, resp, requestId }) {
  const difyResponse = await resp.json();
  const content = resolveWorkflowBlockingContent(difyResponse);

  const formattedResponse = {
    id: `chatcmpl-${difyResponse.workflow_run_id || difyResponse.id || generateId()}`,
    object: "chat.completion",
    created: difyResponse.created_at || difyResponse.data?.created_at || Math.floor(Date.now() / 1000),
    model: resolveOpenAiModel(req),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: resolveWorkflowUsage(difyResponse),
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
    const userId = resolveWorkflowUser(data);
    const files = await collectDifyFiles(data, config, userId, requestId);
    const requestBody = buildWorkflowRequestBody(req, data, files, userId);
    const apiPath = resolveWorkflowPath(data);
    const requestUrl = `${config.DIFY_API_URL}${apiPath}`;

    log("info", "收到 Workflow 请求", {
      requestId,
      headers: sanitizeLog(req.headers),
      body: sanitizeLog(data),
      messageCount: messages.length,
      responseMode: requestBody.response_mode,
      hasWorkflowId: typeof data.workflow_id === "string" && Boolean(data.workflow_id.trim()),
      inputKeys: Object.keys(requestBody.inputs || {}),
      fileCount: files.length,
    });

    log("info", "发送 Workflow 请求到 Dify", {
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

    log("info", "收到 Workflow Dify 响应", {
      requestId,
      status: resp.status,
      statusText: resp.statusText,
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      log("error", "Workflow Dify API 请求失败", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        errorBody,
      });
      res.status(resp.status).send(errorBody);
      return;
    }

    if (requestBody.response_mode === "streaming") {
      await handleStreamingResponse({ req, res, resp, requestId, config });
      return;
    }

    await handleBlockingResponse({ req, res, resp, requestId });
  } catch (error) {
    log("error", "处理 Workflow 请求时发生错误", {
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
