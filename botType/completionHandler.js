// completionHandler.js

import fetch from "node-fetch";
import { PassThrough } from "stream";
import { log } from '../config/logger.js';
import { logApiCall, generateId, getFileExtension, getFileType } from "./utils.js";

// 上传文件到 Dify，获取文件 ID
async function uploadFileToDify(base64Data, config, userId) {
  try {
    // 解析 base64 数据 URL，提取 contentType 和 base64 字符串
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      throw new Error("Invalid base64 data");
    }
    let contentType = matches[1];
    const base64String = matches[2];
    let fileData = Buffer.from(base64String, "base64");

    // 如果 contentType 是 'image/jpg'，将其调整为 'image/jpeg'
    if (contentType === "image/jpg") {
      contentType = "image/jpeg";
    }

    // 从 contentType 确定文件扩展名
    const fileExtension = contentType.split("/")[1]; // 例如 'jpeg'、'png'、'gif'

    // 使用扩展名创建文件名
    const filename = `image.${fileExtension}`;

    // 创建 FormData 并包含 'user' 字段
    const form = new FormData();
    form.append("file", fileData, {
      filename: filename,
      contentType: contentType,
    });
    form.append("user", userId); // 使用提供的用户标识符

    // 记录文件上传请求的详细信息
    log("info", "正在上传文件到 Dify", {
      url: `${config.DIFY_API_URL}/files/upload`,
      headers: {
        Authorization: `Bearer ${config.API_KEY}`,
        ...form.getHeaders(),
      },
      formData: "<<FILE DATA>>", // 出于安全考虑，不记录实际文件数据
    });

    // 发送上传请求
    const response = await fetch(`${config.DIFY_API_URL}/files/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    // 记录文件上传响应的详细信息
    log("info", "文件上传响应", {
      status: response.status,
      statusText: response.statusText,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log("error", "文件上传失败", {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorBody,
      });
      throw new Error(
        `文件上传失败: ${response.status} ${response.statusText}: ${errorBody}`
      );
    }

    const result = await response.json();
    log("info", "文件上传成功", { fileId: result.id });
    return result.id; // 返回文件 ID
  } catch (error) {
    console.error("上传文件出错:", error);
    throw error;
  }
}

// 处理 Completion 类型请求
async function handleRequest(req, res, config, requestId, startTime) {
  try {
    const apiPath = "/completion-messages";
    const data = req.body;
    const messages = data.messages;
    let queryString = "";
    let files = [];

    // 记录收到的请求头和请求体
    log("info", "收到请求", {
      requestId,
      headers: req.headers,
      body: data,
    });

    const userId = config.API_USER; // 如果可用，替换为实际的用户 ID

    // 第一步：先扫描所有消息中的图片内容
    log("info", "开始扫描所有消息中的图片", { requestId, messageCount: messages.length });
    for (const message of messages) {
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "image_url" && content.image_url && content.image_url.url) {
            const imageUrl = content.image_url.url;

            // 检查URL是否为base64数据
            if (imageUrl.startsWith('data:')) {
              // 是base64数据，需要上传
              const fileExt = getFileExtension(imageUrl);
              const fileType = getFileType(fileExt);
              log("info", "检测到base64数据，准备上传", { requestId, fileType, fileExt });
              const fileId = await uploadFileToDify(
                imageUrl,
                config,
                userId
              );
              files.push({
                type: fileType,
                transfer_method: "local_file",
                upload_file_id: fileId,
              });
            } else {
              // 是真正的URL，直接使用remote_url方式
              const fileExt = getFileExtension(imageUrl);
              const fileType = getFileType(fileExt);
              log("info", "检测到远程文件URL", { requestId, url: imageUrl.substring(0, 30) + '...', fileType, fileExt });
              files.push({
                type: fileType,
                transfer_method: "remote_url",
                url: imageUrl,
              });
            }
          }
        }
      }
    }

    // 第二步：从最后一条消息中提取查询文本
    const lastMessage = messages[messages.length - 1];
    if (Array.isArray(lastMessage.content)) {
      for (const content of lastMessage.content) {
        // 处理字符串类型的内容（OpenAI格式）
        if (typeof content === "string") {
          queryString += content + "\n";
        }
        // 处理对象类型的内容
        else if (content.type === "text") {
          queryString += content.text + "\n";
        }
        // 注意：这里不再重复处理image_url，因为已经在上面处理过了
      }
      queryString = queryString.trim(); // 去除末尾的换行符
    } else {
      queryString = lastMessage.content;
    }

    // 日志记录
    log("info", "处理 Completion 类型消息", {
      requestId,
      contentLength: queryString.length,
      queryString,
      files,
    });

    const stream = data.stream !== undefined ? data.stream : false;
    let requestBody;

    // 如果指定了 INPUT_VARIABLE，则使用它作为键，否则默认使用 'query'
    const inputKey = config.INPUT_VARIABLE || "query";

    // 构建请求体
    requestBody = {
      inputs: { [inputKey]: queryString },
      response_mode: "streaming",
      user: userId,
      files: files,
    };

    // 记录将要发送到 Dify 的请求载荷
    log("info", "发送请求到 Dify", {
      requestId,
      url: config.DIFY_API_URL + apiPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.API_KEY}`,
      },
      body: requestBody,
    });

    // 发送请求到 Dify
    const resp = await fetch(config.DIFY_API_URL + apiPath, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    // 记录 API 调用时间
    const apiCallDuration = Date.now() - startTime;
    logApiCall(requestId, config, apiPath, apiCallDuration);

    // 记录 Dify 的响应状态
    log("info", "收到 Dify 响应", {
      requestId,
      status: resp.status,
      statusText: resp.statusText,
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      log("error", "Dify API 请求失败", {
        requestId,
        status: resp.status,
        statusText: resp.statusText,
        errorBody: errorBody,
      });
      res.status(resp.status).send(errorBody);
      return;
    }

    let isResponseEnded = false;

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      let buffer = "";
      const responseStream = resp.body
        .pipe(new PassThrough())
        .on("data", (chunk) => {
          buffer += chunk.toString();
          let lines = buffer.split("\n");

          for (let i = 0; i < lines.length - 1; i++) {
            let line = lines[i].trim();

            if (!line.startsWith("data:")) continue;
            line = line.slice(5).trim();
            let chunkObj;
            try {
              if (line.startsWith("{")) {
                chunkObj = JSON.parse(line);
              } else {
                continue;
              }
            } catch (error) {
              console.error("解析 chunk 出错:", error);
              continue;
            }

            // 记录每个 chunk 的内容
            log("debug", "处理 chunk", {
              requestId,
              chunkObj,
            });

            if (
              chunkObj.event === "message" ||
              chunkObj.event === "agent_message" ||
              chunkObj.event === "text_chunk"
            ) {
              let chunkContent;
              if (chunkObj.event === "text_chunk") {
                chunkContent = chunkObj.data.text;
              } else {
                chunkContent = chunkObj.answer;
              }

              if (chunkContent !== "") {
                const chunkId = `chatcmpl-${Date.now()}`;
                const chunkCreated = chunkObj.created_at;

                if (!isResponseEnded) {
                  res.write(
                    "data: " +
                      JSON.stringify({
                        id: chunkId,
                        object: "chat.completion.chunk",
                        created: chunkCreated,
                        model: data.model,
                        choices: [
                          {
                            index: 0,
                            delta: {
                              content: chunkContent,
                            },
                            finish_reason: null,
                          },
                        ],
                      }) +
                      "\n\n"
                  );
                }
              }
            } else if (
              chunkObj.event === "workflow_finished" ||
              chunkObj.event === "message_end"
            ) {
              const chunkId = `chatcmpl-${Date.now()}`;
              const chunkCreated = chunkObj.created_at;
              if (!isResponseEnded) {
                res.write(
                  "data: " +
                    JSON.stringify({
                      id: chunkId,
                      object: "chat.completion.chunk",
                      created: chunkCreated,
                      model: data.model,
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: "stop",
                        },
                      ],
                    }) +
                    "\n\n"
                );
              }
              if (!isResponseEnded) {
                res.write("data: [DONE]\n\n");
              }

              res.end();
              isResponseEnded = true;
            } else if (chunkObj.event === "agent_thought") {
              // 如果需要，处理 agent_thought 事件
            } else if (chunkObj.event === "ping") {
              // 如果需要，处理 ping 事件
            } else if (chunkObj.event === "error") {
              console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
              res
                .status(500)
                .write(
                  `data: ${JSON.stringify({ error: chunkObj.message })}\n\n`
                );

              if (!isResponseEnded) {
                res.write("data: [DONE]\n\n");
              }

              res.end();
              isResponseEnded = true;
            }
          }

          buffer = lines[lines.length - 1];
        });

      // 记录响应结束
      responseStream.on("end", () => {
        log("info", "响应结束", { requestId });
      });
    } else {
      let result = "";
      let usageData = "";
      let buffer = "";
      let hasError = false;

      // 记录普通响应开始
      log("info", "开始处理普通响应", {
        requestId,
        timestamp: new Date().toISOString(),
      });

      const responseStream = resp.body;
      responseStream.on("data", (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (line === "") continue;
          let chunkObj;
          try {
            const cleanedLine = line.replace(/^data: /, "").trim();
            if (cleanedLine.startsWith("{") && cleanedLine.endsWith("}")) {
              chunkObj = JSON.parse(cleanedLine);
            } else {
              continue;
            }
          } catch (error) {
            console.error("解析 JSON 出错:", error);
            continue;
          }

          // 记录每个 chunk 的内容
          log("debug", "处理 chunk", {
            requestId,
            chunkObj,
          });

          if (
            chunkObj.event === "message" ||
            chunkObj.event === "agent_message"
          ) {
            result += chunkObj.answer;
          } else if (chunkObj.event === "message_end") {
            usageData = {
              prompt_tokens: chunkObj.metadata.usage.prompt_tokens || 100,
              completion_tokens:
                chunkObj.metadata.usage.completion_tokens || 10,
              total_tokens: chunkObj.metadata.usage.total_tokens || 110,
            };
          } else if (chunkObj.event === "workflow_finished") {
            const outputs = chunkObj.data.outputs;
            if (config.OUTPUT_VARIABLE) {
              result = outputs[config.OUTPUT_VARIABLE];
            } else {
              result = outputs;
            }
            result = String(result);
            usageData = {
              prompt_tokens: chunkObj.metadata?.usage?.prompt_tokens || 100,
              completion_tokens:
                chunkObj.metadata?.usage?.completion_tokens || 10,
              total_tokens: chunkObj.data.total_tokens || 110,
            };
          } else if (chunkObj.event === "agent_thought") {
            // 如果需要，处理 agent_thought 事件
          } else if (chunkObj.event === "ping") {
            // 如果需要，处理 ping 事件
          } else if (chunkObj.event === "error") {
            hasError = true;
            console.error(`Error: ${chunkObj.code}, ${chunkObj.message}`);
            break;
          }
        }

        buffer = lines[lines.length - 1];
      });

      responseStream.on("end", () => {
        if (hasError) {
          res
            .status(500)
            .json({ error: "An error occurred while processing the request." });
        } else {
          const formattedResponse = {
            id: `chatcmpl-${generateId()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: data.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: result.trim(),
                },
                logprobs: null,
                finish_reason: "stop",
              },
            ],
            usage: usageData,
            system_fingerprint: "fp_2f57f81c11",
          };
          const jsonResponse = JSON.stringify(formattedResponse, null, 2);

          // 记录发送的响应
          log("info", "发送响应", {
            requestId,
            response: formattedResponse,
          });

          res.set("Content-Type", "application/json");
          res.send(jsonResponse);
        }
      });
    }
  } catch (error) {
    console.error("处理 Completion 请求时发生错误:", error);

    // 记录错误
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
