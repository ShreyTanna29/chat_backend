const express = require("express");
const OpenAI = require("openai");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Space = require("../models/Space");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
const { convertToPCM16 } = require("../utils/audioConverter");

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper: normalize AI/OpenAI errors to proper HTTP status and body
function toAIErrorResponse(err, fallbackMessage = "AI service error") {
  // OpenAI Node SDK errors often include `status` and `error` payload
  const status =
    err?.status ||
    err?.response?.status ||
    (err?.code === "insufficient_quota"
      ? 402
      : err?.code === "rate_limit_exceeded"
      ? 429
      : 502);

  const ai = err?.error || err?.response?.data?.error;

  const message = ai?.message || err?.message || fallbackMessage;
  const code = ai?.code || err?.code;
  const type = ai?.type || err?.type;

  return {
    status,
    body: {
      success: false,
      message,
      code,
      type,
      // include the raw ai error object when available for debugging (safe surface)
      error: ai || undefined,
    },
  };
}

// Optional web search tool (function-calling) for GPT-5 think mode

// Perform web search via Tavily if configured; otherwise return a helpful message
async function performWebSearch(query) {
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        error: "Web search not configured",
        hint: "Set TAVILY_API_KEY in environment to enable web search",
        query,
      });
    }

    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        include_answer: true,
        max_results: 5,
        search_depth: "advanced",
      }),
    });

    const data = await resp.json();
    // Normalize output for the model
    const normalized = {
      answer: data.answer,
      results: (data.results || []).slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
    return JSON.stringify(normalized);
  } catch (err) {
    return JSON.stringify({
      error: "Search failed",
      message: err.message,
      query,
    });
  }
}

// Set up multer for image uploads
const upload = multer({ storage: multer.memoryStorage() });

// Validation for chat request
const chatValidation = [
  body("prompt")
    .trim()
    .isLength({ min: 1, max: 4000 })
    .withMessage("Prompt must be between 1 and 4000 characters"),
  body("model")
    .optional()
    .isIn(["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo-preview"])
    .withMessage("Invalid model specified"),
];

// @route   POST /api/chat/stream
// @desc    Stream chat response from GPT-5 (uses gpt-5-mini for image input)
// @access  Private
router.post("/stream", auth, upload.single("image"), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    const imageFile = req.file;
    const conversationId = req.body.conversationId; // Optional: continue existing conversation
    const thinkMode =
      req.body.thinkMode === "true" || req.body.thinkMode === true; // Optional: use GPT-5 for advanced reasoning
    const spaceId = req.body.spaceId || null; // Optional: run within a Space

    // Select model based on thinkMode
    let model = thinkMode ? "gpt-5-search-api" : "gpt-4.1-mini";

    if (!prompt && !imageFile) {
      return res.status(400).json({
        success: false,
        message: "Prompt or image is required",
      });
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId, {
        includeMessages: true,
      });
      if (!conversation || conversation.userId !== req.user.id) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }
    } else {
      // Create new conversation
      conversation = await Conversation.create({
        userId: req.user.id,
        title: "New Chat",
        spaceId: spaceId || undefined,
      });
    }

    // Prepare Server-Sent Events response upfront so the client gets an immediate connection
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    // Important for Nginx/Proxies to avoid buffering SSE
    res.setHeader("X-Accel-Buffering", "no");
    // Disable compression for SSE on some production setups
    // Accumulate assistant output across the stream
    let fullResponse = "";

    try {
      res.setHeader("Content-Encoding", "identity");
    } catch (_) {}
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    // Send initial connection confirmation immediately
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        message: "Stream started",
        conversationId: conversation.id,
      })}\n\n`
    );
    if (typeof res.flush === "function") res.flush();

    // Heartbeat to keep proxies from closing idle connections
    const heartbeat = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
        if (typeof res.flush === "function") res.flush();
      } catch (_) {}
    }, 15000);
    // Some proxies emit 'aborted' instead of 'close'
    req.on("aborted", () => {
      try {
        clearInterval(heartbeat);
        console.warn("[STREAM] Request aborted by client");
      } catch (_) {}
    });
    req.on("close", () => {
      try {
        clearInterval(heartbeat);
      } catch (_) {}
    });

    // Load space (if provided) and build system prompts
    let space = null;
    if (spaceId) {
      space = await Space.findById(spaceId);
      if (!space || space.userId !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied to space" });
      }
    }

    // Build messages array with conversation history
    const messages = [];
    if (space?.defaultPrompt) {
      messages.push({ role: "system", content: space.defaultPrompt });
    }
    messages.push({
      role: "system",
      content: thinkMode
        ? "You are a helpful AI assistant with web search capabilities. Use web search to find current, accurate information when needed. If an image is provided, analyze it and answer the user's question based on both the image and the prompt."
        : "You are a helpful AI assistant. If an image is provided, analyze it and answer the user's question based on both the image and the prompt.",
    });

    // Add conversation history if exists
    if (conversation.messages && conversation.messages.length > 0) {
      conversation.messages.forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    }

    // Add current user message
    const userMessageContent = prompt || "What is in this image?";
    if (imageFile) {
      const base64Image = imageFile.buffer.toString("base64");
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userMessageContent },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageFile.mimetype};base64,${base64Image}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: userMessageContent });
    }

    try {
      if (thinkMode && model === "gpt-5-search-api") {
        // Preflight: allow function-calling to request web_search
        let workingMessages = [...messages];
        const preflight = await openai.chat.completions.create({
          model,
          messages: workingMessages,
        });

        const preMsg = preflight.choices?.[0]?.message;
        const toolCalls = preMsg?.tool_calls || [];

        if (toolCalls.length > 0) {
          // Include assistant tool_calls message
          workingMessages.push({
            role: "assistant",
            content: preMsg.content || null,
            tool_calls: toolCalls,
          });

          // Execute tool calls
          for (const call of toolCalls) {
            if (
              call.type === "function" &&
              call.function?.name === "web_search"
            ) {
              let args = {};
              try {
                args = JSON.parse(call.function.arguments || "{}");
              } catch (_) {}
              const query = args.query || userMessageContent;
              const result = await performWebSearch(query);
              workingMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: result,
              });
            }
          }

          // Stream final answer; prevent further tool calls to avoid loops
          const stream = await openai.chat.completions.create({
            model,
            messages: workingMessages,
            stream: true,
            tool_choice: "none",
          });

          // use outer fullResponse accumulator
          console.log(
            `[STREAM] Starting stream with model: ${model} (thinkMode + web_search)`
          );
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              res.write(
                `data: ${JSON.stringify({
                  type: "chunk",
                  content: content,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();
            }
            if (chunk.choices[0]?.finish_reason) {
              console.log(
                `[STREAM] Response received from ${model} - Length: ${fullResponse.length} chars, Finish reason: ${chunk.choices[0].finish_reason}`
              );
              res.write(
                `data: ${JSON.stringify({
                  type: "done",
                  finish_reason: chunk.choices[0].finish_reason,
                  full_response: fullResponse,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();
              break;
            }
          }
        } else {
          // No tool calls requested; stream normally
          const stream = await openai.chat.completions.create({
            model,
            messages,
            stream: true,
          });

          // use outer fullResponse accumulator
          console.log(`[STREAM] Starting stream with model: ${model}`);
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              res.write(
                `data: ${JSON.stringify({
                  type: "chunk",
                  content: content,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();
            }
            if (chunk.choices[0]?.finish_reason) {
              console.log(
                `[STREAM] Response received from ${model} - Length: ${fullResponse.length} chars, Finish reason: ${chunk.choices[0].finish_reason}`
              );
              res.write(
                `data: ${JSON.stringify({
                  type: "done",
                  finish_reason: chunk.choices[0].finish_reason,
                  full_response: fullResponse,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();
              break;
            }
          }
        }
      } else {
        // Original streaming path (no think mode)
        const stream = await openai.chat.completions.create({
          model,
          messages,
          stream: true,
        });

        // use outer fullResponse accumulator
        console.log(`[STREAM] Starting stream with model: ${model}`);

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            res.write(
              `data: ${JSON.stringify({
                type: "chunk",
                content: content,
                timestamp: new Date().toISOString(),
              })}\n\n`
            );
            if (typeof res.flush === "function") res.flush();
          }
          if (chunk.choices[0]?.finish_reason) {
            console.log(
              `[STREAM] Response received from ${model} - Length: ${fullResponse.length} chars, Finish reason: ${chunk.choices[0].finish_reason}`
            );
            res.write(
              `data: ${JSON.stringify({
                type: "done",
                finish_reason: chunk.choices[0].finish_reason,
                full_response: fullResponse,
                timestamp: new Date().toISOString(),
              })}\n\n`
            );
            if (typeof res.flush === "function") res.flush();
            break;
          }
        }
      }

      // Save messages to database
      try {
        // Save user message
        await Conversation.addMessage(conversation.id, {
          role: "user",
          content: userMessageContent,
          metadata: {
            hasImage: !!imageFile,
            imageType: imageFile?.mimetype,
          },
        });

        // Save assistant response
        await Conversation.addMessage(conversation.id, {
          role: "assistant",
          content: fullResponse,
          metadata: {
            model,
            responseLength: fullResponse.length,
          },
        });

        // Auto-generate title if this is the first message
        if (!conversationId) {
          await Conversation.autoGenerateTitle(conversation.id);
        }
      } catch (dbError) {
        console.error("[STREAM] Error saving to database:", dbError);
        // Don't fail the request if DB save fails
      }

      // Save to user's search history
      try {
        await User.addToSearchHistory(req.user.id, prompt || "[image]");
      } catch (historyError) {}
    } catch (openaiError) {
      // We already opened the SSE stream; emit an error event and close
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: "Failed to get response from AI service",
          error: openaiError.message,
          timestamp: new Date().toISOString(),
        })}\n\n`
      );
      if (typeof res.flush === "function") res.flush();
    }
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
    if (typeof res.flush === "function") res.flush();
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: "Stream error occurred",
        error: error.message,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );
    // ensure heartbeat is cleared if set
    try {
      clearInterval(heartbeat);
    } catch (_) {}
    res.end();
  }
});

// @route   POST /api/chat/simple
// @desc    Get simple (non-streaming) chat response
// @access  Private
router.post("/simple", auth, chatValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const {
      prompt,
      model = "gpt-4.1-mini",
      conversationId,
      spaceId,
    } = req.body;

    // Validate space if provided
    let space = null;
    if (spaceId) {
      space = await Space.findById(spaceId);
      if (!space || space.userId !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied to space" });
      }
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId, {
        includeMessages: true,
      });
      if (!conversation || conversation.userId !== req.user.id) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }
    } else {
      // Create new conversation
      conversation = await Conversation.create({
        userId: req.user.id,
        title: "New Chat",
        spaceId: spaceId || undefined,
      });
    }

    console.log(`[SIMPLE] Sending request to model: ${model}`);

    // Build messages with conversation history
    const messages = [];
    if (space?.defaultPrompt) {
      messages.push({ role: "system", content: space.defaultPrompt });
    }
    messages.push({
      role: "system",
      content:
        "You are a helpful AI assistant similar to Perplexity. Provide accurate, informative, and well-structured responses. When possible, break down complex topics into clear sections.",
    });

    // Add conversation history
    if (conversation.messages && conversation.messages.length > 0) {
      conversation.messages.forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    }

    // Add current user message
    messages.push({
      role: "user",
      content: prompt,
    });

    // Create the chat completion
    const completion = await openai.chat.completions.create({
      model: model,
      messages,
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log(
      `[SIMPLE] Response received from ${model} - Length: ${
        response.length
      } chars, Tokens used: ${completion.usage?.total_tokens || "N/A"}`
    );

    // Save messages to database
    try {
      await Conversation.addMessage(conversation.id, {
        role: "user",
        content: prompt,
        metadata: {},
      });

      await Conversation.addMessage(conversation.id, {
        role: "assistant",
        content: response,
        metadata: {
          model,
          tokens: completion.usage?.total_tokens,
        },
      });

      // Auto-generate title if this is the first message
      if (!conversationId) {
        await Conversation.autoGenerateTitle(conversation.id);
      }
    } catch (dbError) {
      console.error("[SIMPLE] Error saving to database:", dbError);
    }

    // Save to user's search history
    try {
      await User.addToSearchHistory(req.user.id, prompt);
    } catch (historyError) {
      console.error("Error saving to search history:", historyError);
      // Don't fail the request if history saving fails
    }

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        prompt: prompt,
        response: response,
        model: model,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const { status, body } = toAIErrorResponse(
      error,
      "Failed to get AI response"
    );
    return res.status(status).json(body);
  }
});

// @route   POST /api/chat/ask
// @desc    Ask a question with optional image (uses GPT-4 vision if image provided)
// @access  Private
router.post("/ask", auth, upload.single("image"), async (req, res) => {
  try {
    const { prompt, conversationId, spaceId } = req.body;
    const imageFile = req.file;
    if (!prompt && !imageFile) {
      return res.status(400).json({
        success: false,
        message: "Prompt or image is required",
      });
    }

    // Validate space if provided
    let space = null;
    if (spaceId) {
      space = await Space.findById(spaceId);
      if (!space || space.userId !== req.user.id) {
        return res
          .status(403)
          .json({ success: false, message: "Access denied to space" });
      }
    }

    // Get or create conversation
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId, {
        includeMessages: true,
      });
      if (!conversation || conversation.userId !== req.user.id) {
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }
    } else {
      // Create new conversation
      conversation = await Conversation.create({
        userId: req.user.id,
        title: "New Chat",
        spaceId: spaceId || undefined,
      });
    }

    // Always use gpt-4.1-mini by default
    const model = "gpt-4.1-mini";
    const messages = [];
    if (space?.defaultPrompt) {
      messages.push({ role: "system", content: space.defaultPrompt });
    }
    messages.push({
      role: "system",
      content:
        "You are a helpful AI assistant. If an image is provided, analyze it and answer the user's question based on both the image and the prompt.",
    });

    // Add conversation history
    if (conversation.messages && conversation.messages.length > 0) {
      conversation.messages.forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    }

    const userMessageContent = prompt || "What is in this image?";
    if (imageFile) {
      // Convert image buffer to base64
      const base64Image = imageFile.buffer.toString("base64");
      messages.push({
        role: "user",
        content: [
          { type: "text", text: userMessageContent },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageFile.mimetype};base64,${base64Image}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: userMessageContent });
    }

    console.log(
      `[ASK] Sending request to model: ${model}, Has image: ${!!imageFile}`
    );

    const completion = await openai.chat.completions.create({
      model,
      messages,
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log(
      `[ASK] Response received from ${model} - Length: ${
        response.length
      } chars, Tokens used: ${completion.usage?.total_tokens || "N/A"}`
    );

    // Save messages to database
    try {
      await Conversation.addMessage(conversation.id, {
        role: "user",
        content: userMessageContent,
        metadata: {
          hasImage: !!imageFile,
          imageType: imageFile?.mimetype,
        },
      });

      await Conversation.addMessage(conversation.id, {
        role: "assistant",
        content: response,
        metadata: {
          model,
          tokens: completion.usage?.total_tokens,
        },
      });

      // Auto-generate title if this is the first message
      if (!conversationId) {
        await Conversation.autoGenerateTitle(conversation.id);
      }
    } catch (dbError) {
      console.error("[ASK] Error saving to database:", dbError);
    }

    // Save to user's search history
    try {
      await User.addToSearchHistory(req.user.id, prompt || "[image]");
    } catch (historyError) {
      // Ignore
    }

    res.json({
      success: true,
      data: {
        conversationId: conversation.id,
        prompt: prompt || null,
        image: !!imageFile,
        response,
        model,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Chat image/ask error:", error);
    const { status, body } = toAIErrorResponse(
      error,
      "Failed to get AI response"
    );
    return res.status(status).json(body);
  }
});

// @route   GET /api/chat/history
// @desc    Get user's chat/search history
// @access  Private
router.get("/history", auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const history = user.searchHistory || [];

    // Implement pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedHistory = history.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        history: paginatedHistory,
        pagination: {
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total_items: history.length,
          total_pages: Math.ceil(history.length / limit),
        },
      },
    });
  } catch (error) {
    console.error("History fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch chat history",
    });
  }
});

// @route   DELETE /api/chat/history
// @desc    Clear user's chat/search history
// @access  Private
router.delete("/history", auth, async (req, res) => {
  try {
    await User.clearSearchHistory(req.user.id);

    res.json({
      success: true,
      message: "Chat history cleared successfully",
    });
  } catch (error) {
    console.error("History clear error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to clear chat history",
    });
  }
});

// @route   POST /api/chat/voice
// @desc    Voice-to-voice chat with AI using OpenAI's API
// @access  Private
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");

router.post("/voice", auth, upload.single("audio"), async (req, res) => {
  try {
    const audioFile = req.file;
    if (!audioFile) {
      return res.status(400).json({
        success: false,
        message: "Audio file is required",
      });
    }

    // Step 1: Transcribe user audio to text using OpenAI Whisper
    console.log(`[VOICE] Transcribing audio with Whisper`);
    const transcriptResp = await openai.audio.transcriptions.create({
      file: Readable.from(audioFile.buffer),
      model: "whisper-1",
      response_format: "text",
      language: "en",
    });
    const userText = transcriptResp.text || transcriptResp;
    console.log(
      `[VOICE] Transcription received - Text length: ${userText.length} chars`
    );

    // Step 2: Get AI response using gpt-4.1-mini
    const chatModel = "gpt-4.1-mini";
    console.log(`[VOICE] Sending request to model: ${chatModel}`);
    const aiResp = await openai.chat.completions.create({
      model: chatModel,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant. Respond in a conversational tone.",
        },
        { role: "user", content: userText },
      ],
    });
    const aiText = aiResp.choices[0]?.message?.content || "";
    console.log(
      `[VOICE] Response received from ${chatModel} - Length: ${aiText.length} chars`
    );

    // Step 3: Synthesize AI response to voice using OpenAI TTS
    console.log(`[VOICE] Generating speech with TTS`);
    const ttsResp = await openai.audio.speech.create({
      model: "tts-1",
      input: aiText,
      voice: "alloy",
      response_format: "mp3",
    });
    console.log(`[VOICE] Speech generated successfully`);

    // Save to user's search history
    try {
      await User.addToSearchHistory(req.user.id, `[voice] ${userText}`);
    } catch (historyError) {}

    // Return both transcript and AI audio
    res.setHeader("Content-Type", "application/json");
    res.json({
      success: true,
      data: {
        transcript: userText,
        aiText,
        audio: ttsResp.audio || ttsResp, // base64 or buffer
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Voice chat error:", error);
    const { status, body } = toAIErrorResponse(
      error,
      "Failed to process voice chat"
    );
    return res.status(status).json(body);
  }
});

// ============================================
// Conversation Management Endpoints
// ============================================

// @route   GET /api/chat/conversations
// @desc    Get all conversations for the authenticated user
// @access  Private
router.get("/conversations", auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await Conversation.findByUserId(req.user.id, {
      page,
      limit,
      includeMessages: false, // Only include first message for preview
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
      error: error.message,
    });
  }
});

// @route   GET /api/chat/conversations/:id
// @desc    Get a specific conversation with all messages
// @access  Private
router.get("/conversations/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Verify ownership
    if (conversation.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversation",
      error: error.message,
    });
  }
});

// @route   POST /api/chat/conversations
// @desc    Create a new conversation
// @access  Private
router.post("/conversations", auth, async (req, res) => {
  try {
    const { title = "New Chat" } = req.body;

    const conversation = await Conversation.create({
      userId: req.user.id,
      title,
    });

    res.status(201).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create conversation",
      error: error.message,
    });
  }
});

// @route   PUT /api/chat/conversations/:id
// @desc    Update conversation (e.g., change title)
// @access  Private
router.put("/conversations/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    const conversation = await Conversation.findById(id, {
      includeMessages: false,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Verify ownership
    if (conversation.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const updated = await Conversation.update(id, { title });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    console.error("Update conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update conversation",
      error: error.message,
    });
  }
});

// @route   DELETE /api/chat/conversations/:id
// @desc    Delete a conversation
// @access  Private
router.delete("/conversations/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findById(id, {
      includeMessages: false,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Verify ownership
    if (conversation.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    await Conversation.delete(id);

    res.json({
      success: true,
      message: "Conversation deleted successfully",
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete conversation",
      error: error.message,
    });
  }
});

// @route   DELETE /api/chat/conversations
// @desc    Delete all conversations for the user
// @access  Private
router.delete("/conversations", auth, async (req, res) => {
  try {
    await Conversation.deleteAllByUserId(req.user.id);

    res.json({
      success: true,
      message: "All conversations deleted successfully",
    });
  } catch (error) {
    console.error("Delete all conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete conversations",
      error: error.message,
    });
  }
});

// @route   GET /api/chat/conversations/search
// @desc    Search conversations by title or content
// @access  Private
router.get("/conversations/search", auth, async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Search query is required",
      });
    }

    const conversations = await Conversation.search(req.user.id, q, {
      page,
      limit,
    });

    res.json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    console.error("Search conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to search conversations",
      error: error.message,
    });
  }
});

// ============================================
// Space Management Endpoints
// ============================================

// @route   GET /api/chat/spaces
// @desc    List spaces for the authenticated user
// @access  Private
router.get("/spaces", auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await Space.findByUserId(req.user.id, { page, limit });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Get spaces error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch spaces",
      error: error.message,
    });
  }
});

// @route   POST /api/chat/spaces
// @desc    Create a new space
// @access  Private
router.post("/spaces", auth, async (req, res) => {
  try {
    const { name, defaultPrompt } = req.body;
    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }
    const space = await Space.create({
      userId: req.user.id,
      name: name.trim(),
      defaultPrompt,
    });
    res.status(201).json({ success: true, data: space });
  } catch (error) {
    console.error("Create space error:", error);
    // Handle unique constraint (userId,name)
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "A space with this name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to create space",
      error: error.message,
    });
  }
});

// @route   GET /api/chat/spaces/:id
// @desc    Get a specific space
// @access  Private
router.get("/spaces/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const space = await Space.findById(id);
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    if (space.userId !== req.user.id)
      return res.status(403).json({ success: false, message: "Access denied" });
    res.json({ success: true, data: space });
  } catch (error) {
    console.error("Get space error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch space",
      error: error.message,
    });
  }
});

// @route   PUT /api/chat/spaces/:id
// @desc    Update space
// @access  Private
router.put("/spaces/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, defaultPrompt } = req.body;
    const space = await Space.findById(id);
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    if (space.userId !== req.user.id)
      return res.status(403).json({ success: false, message: "Access denied" });

    const updated = await Space.update(id, { name, defaultPrompt });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update space error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update space",
      error: error.message,
    });
  }
});

// @route   DELETE /api/chat/spaces/:id
// @desc    Delete space (conversations retained but detached)
// @access  Private
router.delete("/spaces/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const space = await Space.findById(id);
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    if (space.userId !== req.user.id)
      return res.status(403).json({ success: false, message: "Access denied" });

    await Space.delete(id);
    res.json({ success: true, message: "Space deleted" });
  } catch (error) {
    console.error("Delete space error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete space",
      error: error.message,
    });
  }
});

// @route   GET /api/chat/spaces/:id/conversations
// @desc    List conversations within a space
// @access  Private
router.get("/spaces/:id/conversations", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const space = await Space.findById(id);
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    if (space.userId !== req.user.id)
      return res.status(403).json({ success: false, message: "Access denied" });

    const result = await Space.listConversations(id, { page, limit });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("List space conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list conversations",
      error: error.message,
    });
  }
});

// @route   POST /api/chat/upload-audio
// @desc    Upload and convert audio file from 3GP/M4A to PCM16 WAV
// @access  Private
router.post("/upload-audio", auth, upload.single("audio"), async (req, res) => {
  try {
    console.log("[UPLOAD-AUDIO] Received audio upload request");

    // Check if audio file was provided
    if (!req.file) {
      console.log("[UPLOAD-AUDIO] No audio file provided");
      return res.status(400).json({
        success: false,
        message: "Audio file is required",
      });
    }

    const audioFile = req.file;
    console.log(`[UPLOAD-AUDIO] File details:`, {
      originalname: audioFile.originalname,
      mimetype: audioFile.mimetype,
      size: audioFile.size,
    });

    // Validate file type (3GP or M4A)
    const allowedMimeTypes = [
      "audio/3gpp",
      "audio/3gp",
      "audio/m4a",
      "audio/mp4",
      "audio/aac",
      "video/3gpp",
    ];

    const fileExtension = audioFile.originalname.toLowerCase().split(".").pop();
    const allowedExtensions = ["3gp", "m4a", "aac", "mp4"];

    if (
      !allowedMimeTypes.includes(audioFile.mimetype) &&
      !allowedExtensions.includes(fileExtension)
    ) {
      console.log(
        `[UPLOAD-AUDIO] Invalid file type: ${audioFile.mimetype}, extension: ${fileExtension}`
      );
      return res.status(400).json({
        success: false,
        message: "Invalid audio format. Only 3GP and M4A files are supported.",
      });
    }

    console.log("[UPLOAD-AUDIO] Converting audio to PCM16...");

    // Convert audio buffer to PCM16 WAV
    const pcm16Buffer = await convertToPCM16(audioFile.buffer);

    console.log(
      `[UPLOAD-AUDIO] Conversion successful. PCM16 size: ${pcm16Buffer.length} bytes`
    );

    // Encode to base64 for JSON response
    const pcm16Audio = pcm16Buffer.toString("base64");

    // Return the converted audio
    res.json({
      success: true,
      message: "Audio converted successfully",
      data: {
        pcm16Audio: pcm16Audio,
        originalSize: audioFile.size,
        convertedSize: pcm16Buffer.length,
        format: "PCM16 WAV (24kHz, 16-bit, mono)",
      },
    });

    console.log("[UPLOAD-AUDIO] Response sent successfully");
  } catch (error) {
    console.error("[UPLOAD-AUDIO] Error processing audio:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process audio file",
      error: error.message,
    });
  }
});

module.exports = router;
