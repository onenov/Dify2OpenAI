import fetch from "node-fetch";
import FormData from "form-data";

import { log } from "../config/logger.js";
import { getFileExtension, getFileType, sanitizeLog } from "./utils.js";

const DIFY_FILE_TYPES = new Set(["document", "image", "audio", "video", "custom"]);

export function extractTextFromContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item?.type === "text") {
        return item.text || "";
      }

      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseBase64DataUrl(dataUrl) {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 data");
  }

  const [, rawContentType, base64String] = matches;
  const contentType = rawContentType === "image/jpg" ? "image/jpeg" : rawContentType;
  const fileData = Buffer.from(base64String, "base64");
  const fileExtension = contentType.split("/")[1] || "bin";

  return {
    contentType,
    fileData,
    filename: `upload.${fileExtension}`,
  };
}

export async function uploadFileToDify(base64Data, config, userId) {
  const { contentType, fileData, filename } = parseBase64DataUrl(base64Data);

  const form = new FormData();
  form.append("file", fileData, {
    filename,
    contentType,
  });
  form.append("user", userId);

  const url = `${config.DIFY_API_URL}/files/upload`;
  const headers = {
    Authorization: `Bearer ${config.API_KEY}`,
    ...form.getHeaders(),
  };

  log("info", "正在上传文件到 Dify", {
    url,
    headers: sanitizeLog(headers),
    formData: "<<FILE DATA>>",
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: form,
  });

  log("info", "文件上传响应", {
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`文件上传失败: ${response.status} ${response.statusText}: ${errorBody}`);
  }

  const result = await response.json();
  log("info", "文件上传成功", { fileId: result.id });
  return result.id;
}

function buildRemoteDifyFileFromUrl(fileUrl, requestId) {
  const fileExt = getFileExtension(fileUrl);
  const fileType = getFileType(fileExt);

  log("info", "检测到远程文件 URL", {
    requestId,
    url: fileUrl.substring(0, 120),
    fileType,
    fileExt,
  });

  return {
    type: fileType,
    transfer_method: "remote_url",
    url: fileUrl,
  };
}

async function buildDifyFileFromSource(source, config, userId, requestId) {
  if (typeof source === "string") {
    if (source.startsWith("data:")) {
      const fileExt = getFileExtension(source);
      const fileType = getFileType(fileExt);

      log("info", "检测到 base64 文件，准备上传", {
        requestId,
        fileType,
        fileExt,
      });

      const fileId = await uploadFileToDify(source, config, userId);
      return {
        type: fileType,
        transfer_method: "local_file",
        upload_file_id: fileId,
      };
    }

    return buildRemoteDifyFileFromUrl(source, requestId);
  }

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return null;
  }

  if (typeof source.url === "string" && source.transfer_method !== "local_file") {
    return buildRemoteDifyFileFromUrl(source.url, requestId);
  }

  if (
    typeof source.upload_file_id === "string"
    && source.transfer_method === "local_file"
    && DIFY_FILE_TYPES.has(source.type)
  ) {
    return {
      type: source.type,
      transfer_method: "local_file",
      upload_file_id: source.upload_file_id,
    };
  }

  return null;
}

function collectFileSources(data = {}) {
  const sources = [];

  if (Array.isArray(data.files)) {
    sources.push(...data.files);
  }

  const messages = Array.isArray(data.messages) ? data.messages : [];
  for (const message of messages) {
    if (!Array.isArray(message?.content)) {
      continue;
    }

    for (const content of message.content) {
      const imageUrl = content?.image_url?.url;
      if (content?.type !== "image_url" || !imageUrl) {
        continue;
      }

      sources.push(imageUrl);
    }
  }

  return sources;
}

export async function collectDifyFiles(data, config, userId, requestId) {
  const files = [];
  const sources = collectFileSources(data);

  for (const source of sources) {
    const file = await buildDifyFileFromSource(source, config, userId, requestId);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

export function normalizeAdaptiveInputs(data = {}) {
  if (!data.variable || typeof data.variable !== "object" || Array.isArray(data.variable)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(data.variable).filter(([, value]) => value !== undefined),
  );
}

export function createDifySseParser(onEvent) {
  let buffer = "";

  return (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]" || !payload.startsWith("{")) {
        continue;
      }

      try {
        onEvent(JSON.parse(payload));
      } catch (error) {
        log("warn", "解析 Dify SSE 事件失败", {
          error: error.message,
          payload: payload.slice(0, 200),
        });
      }
    }
  };
}

export function mapDifyUsage(metadata = {}) {
  const usage = metadata?.usage || {};

  return {
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
  };
}

function resolveDifyId(payload = {}) {
  return payload.message_id ?? payload.id ?? payload.data?.id ?? null;
}

function resolveDifyWorkflowRunId(payload = {}) {
  return payload.workflow_run_id ?? payload.data?.workflow_run_id ?? payload.data?.id ?? null;
}

export function buildDifyResponseExtension(payload = {}) {
  return {
    event: payload.event ?? null,
    mode: payload.mode ?? null,
    task_id: payload.task_id ?? null,
    id: payload.id ?? null,
    message_id: resolveDifyId(payload),
    conversation_id: payload.conversation_id ?? null,
    workflow_run_id: resolveDifyWorkflowRunId(payload),
    answer: payload.answer ?? null,
    metadata: payload.metadata ?? null,
    data: payload.data ?? null,
    created_at: payload.created_at ?? null,
    base_response: sanitizeLog(payload),
  };
}

export function buildDifyChunkExtension(event = {}) {
  return {
    event: event.event ?? null,
    task_id: event.task_id ?? null,
    id: event.id ?? event.data?.id ?? null,
    message_id: event.message_id ?? event.id ?? null,
    conversation_id: event.conversation_id ?? null,
    workflow_run_id: resolveDifyWorkflowRunId(event),
    node_id: event.node_id ?? event.data?.node_id ?? null,
    node_type: event.node_type ?? event.data?.node_type ?? null,
    node_title: event.title ?? event.data?.title ?? null,
    status: event.status ?? event.data?.status ?? null,
    code: event.code ?? null,
    message: event.message ?? null,
    error: event.error ?? event.data?.error ?? null,
    answer: event.answer ?? null,
    audio: event.audio ?? null,
    file_type: event.type ?? null,
    belongs_to: event.belongs_to ?? null,
    url: event.url ?? null,
    metadata: event.metadata ?? null,
    data: event.data ?? null,
    created_at: event.created_at ?? event.data?.created_at ?? null,
    raw_event: sanitizeLog(event),
  };
}
