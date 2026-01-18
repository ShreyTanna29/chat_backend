const express = require("express");
const OpenAI = require("openai");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Space = require("../models/Space");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
const { convertToPCM16 } = require("../utils/audioConverter");
const {
  parseDocument,
  isSupportedDocument,
  SUPPORTED_DOCUMENT_TYPES,
} = require("../utils/documentParser");
const { uploadToCloudinary } = require("../utils/cloudinary");

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
  console.log("[WEB_SEARCH] Starting web search for query:", query);
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.error("[WEB_SEARCH] ❌ TAVILY_API_KEY not configured!");
      return JSON.stringify({
        error: "Web search not configured",
        hint: "Set TAVILY_API_KEY in environment to enable web search",
        query,
      });
    }

    console.log("[WEB_SEARCH] Making request to Tavily API...");
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

    if (!resp.ok) {
      console.error(
        "[WEB_SEARCH] ❌ Tavily API error:",
        resp.status,
        resp.statusText,
      );
      const errorText = await resp.text();
      console.error("[WEB_SEARCH] Error response:", errorText);
      return JSON.stringify({
        error: "Search API error",
        status: resp.status,
        message: errorText,
        query,
      });
    }

    const data = await resp.json();
    console.log(
      "[WEB_SEARCH] ✓ Received",
      data.results?.length || 0,
      "results",
    );

    // Normalize output for the model
    const normalized = {
      answer: data.answer,
      results: (data.results || []).slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
    console.log("[WEB_SEARCH] ✓ Search completed successfully");
    return JSON.stringify(normalized);
  } catch (err) {
    console.error("[WEB_SEARCH] ❌ Exception:", err.message);
    console.error("[WEB_SEARCH] Error stack:", err.stack);
    return JSON.stringify({
      error: "Search failed",
      message: err.message,
      query,
    });
  }
}

// Perform image generation via DALL-E
async function performImageGeneration(
  prompt,
  size = "1024x1024",
  quality = "standard",
) {
  console.log("[IMAGE_GEN] Starting image generation for prompt:", prompt);
  try {
    console.log("[IMAGE_GEN] Making request to DALL-E API...");
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: prompt,
      n: 1,
      size: size,
      quality: quality,
    });

    const imageData = response.data[0];
    console.log("[IMAGE_GEN] ✓ Image generated successfully");

    const result = {
      success: true,
      b64_json: imageData.b64_json || null,
      revised_prompt: imageData.revised_prompt || prompt,
    };

    console.log("[IMAGE_GEN] Result:", {
      hasBase64: !!result.b64_json,
      base64Length: result.b64_json?.length || 0,
      revisedPrompt: result.revised_prompt?.substring(0, 100),
    });

    return JSON.stringify(result);
  } catch (err) {
    console.error("[IMAGE_GEN] ❌ Exception:", err.message);
    console.error("[IMAGE_GEN] Error details:", {
      status: err.status,
      code: err.code,
      type: err.type,
    });
    return JSON.stringify({
      success: false,
      error: "Image generation failed",
      message: err.message,
      code: err.code,
      prompt,
    });
  }
}

// Set up multer for image and document uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
  },
});

// Multer fields configuration for stream endpoint
const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "document", maxCount: 1 },
]);

// Validation for chat request
const chatValidation = [
  body("prompt")
    .trim()
    .isLength({ min: 1, max: 4000 })
    .withMessage("Prompt must be between 1 and 4000 characters"),
];

// @route   POST /api/chat/stream
// @desc    Stream chat response from GPT-5 (supports image and document input)
// @access  Private
router.post("/stream", auth, uploadFields, async (req, res) => {
  const requestStartTime = Date.now();
  console.log("\n========== [STREAM] New Request Started ==========");
  console.log("[STREAM] Timestamp:", new Date().toISOString());
  console.log("[STREAM] User ID:", req.user?.id);
  console.log("[STREAM] User Email:", req.user?.email);

  try {
    const prompt = req.body.prompt;
    const imageFile = req.files?.image?.[0] || null;
    const documentFile = req.files?.document?.[0] || null;
    const conversationId = req.body.conversationId; // Optional: continue existing conversation
    const thinkMode =
      req.body.thinkMode === "true" || req.body.thinkMode === true; // Optional: use GPT-5 for advanced reasoning
    const researchMode =
      req.body.researchMode === "true" || req.body.researchMode === true; // Optional: comprehensive web research mode
    const spaceId = req.body.spaceId || null; // Optional: run within a Space

    console.log("[STREAM] Request Parameters:");
    console.log("  - Prompt length:", prompt ? prompt.length : 0, "characters");
    console.log(
      "  - Prompt preview:",
      prompt
        ? prompt.substring(0, 100) + (prompt.length > 100 ? "..." : "")
        : "N/A",
    );
    console.log("  - Has image:", !!imageFile);
    if (imageFile) {
      console.log("  - Image details:", {
        mimetype: imageFile.mimetype,
        size: imageFile.size,
        originalname: imageFile.originalname,
      });
    }
    console.log("  - Has document:", !!documentFile);
    if (documentFile) {
      console.log("  - Document details:", {
        mimetype: documentFile.mimetype,
        size: documentFile.size,
        originalname: documentFile.originalname,
      });
    }
    console.log("  - Conversation ID:", conversationId || "New conversation");
    console.log("  - Think Mode:", thinkMode);
    console.log("  - Research Mode:", researchMode);
    console.log("  - Space ID:", spaceId || "None");

    // Validate document type if provided
    if (documentFile && !isSupportedDocument(documentFile.mimetype)) {
      console.log(
        "[STREAM] ❌ Unsupported document type:",
        documentFile.mimetype,
      );
      return res.status(400).json({
        success: false,
        message: `Unsupported document type: ${
          documentFile.mimetype
        }. Supported types: ${Object.keys(SUPPORTED_DOCUMENT_TYPES).join(
          ", ",
        )}`,
      });
    }

    // Use GPT-5-nano for better rate limits with function calling for web search
    // Research mode uses the advanced model for comprehensive research
    let model =
      thinkMode || researchMode
        ? "gpt-5.2-2025-12-11"
        : "gpt-5-mini-2025-08-07";
    console.log("[STREAM] Model selected:", model);
    if (researchMode) {
      console.log(
        "[STREAM] Research mode active - will force comprehensive web search",
      );
    }

    if (!prompt && !imageFile && !documentFile) {
      console.log(
        "[STREAM] ❌ Validation failed: No prompt, image, or document provided",
      );
      return res.status(400).json({
        success: false,
        message: "Prompt, image, or document is required",
      });
    }

    // Parse document if provided
    let documentContent = null;
    let documentMetadata = null;
    if (documentFile) {
      console.log("[STREAM] Parsing document...");
      try {
        const parsed = await parseDocument(
          documentFile.buffer,
          documentFile.mimetype,
          documentFile.originalname,
        );
        documentContent = parsed.text;
        documentMetadata = parsed.metadata;
        console.log("[STREAM] ✓ Document parsed successfully:", {
          filename: documentMetadata.filename,
          extractedLength: documentMetadata.extractedLength,
        });
      } catch (parseError) {
        console.error(
          "[STREAM] ❌ Document parsing failed:",
          parseError.message,
        );
        return res.status(400).json({
          success: false,
          message: `Failed to parse document: ${parseError.message}`,
        });
      }
    }

    // Get or create conversation
    console.log("[STREAM] Getting/creating conversation...");
    let conversation;
    if (conversationId) {
      console.log("[STREAM] Loading existing conversation:", conversationId);
      conversation = await Conversation.findById(conversationId, {
        includeMessages: true,
      });
      if (!conversation || conversation.userId !== req.user.id) {
        console.log(
          "[STREAM] ❌ Conversation not found or access denied:",
          conversationId,
        );
        return res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
      }
      console.log(
        "[STREAM] ✓ Conversation loaded. Message count:",
        conversation.messages?.length || 0,
      );
    } else {
      console.log("[STREAM] Creating new conversation...");
      // Create new conversation
      conversation = await Conversation.create({
        userId: req.user.id,
        title: "New Chat",
        spaceId: spaceId || undefined,
      });
      console.log("[STREAM] ✓ New conversation created. ID:", conversation.id);
    }

    // Prepare Server-Sent Events response upfront so the client gets an immediate connection
    console.log("[STREAM] Setting up SSE headers...");
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
    console.log("[STREAM] ✓ SSE headers configured");

    try {
      res.setHeader("Content-Encoding", "identity");
    } catch (_) {}
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    // Send initial connection confirmation immediately
    console.log("[STREAM] Sending 'connected' event to client");
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        message: "Stream started",
        conversationId: conversation.id,
      })}\n\n`,
    );
    if (typeof res.flush === "function") res.flush();
    console.log("[STREAM] ✓ Connection established with client");

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
      console.log("[STREAM] Loading space:", spaceId);
      space = await Space.findById(spaceId);
      if (!space || space.userId !== req.user.id) {
        console.log("[STREAM] ❌ Space not found or access denied:", spaceId);
        return res
          .status(403)
          .json({ success: false, message: "Access denied to space" });
      }
      console.log("[STREAM] ✓ Space loaded:", space.name);
      console.log("[STREAM] Space has default prompt:", !!space.defaultPrompt);
    }

    // Build messages array with conversation history
    console.log("[STREAM] Building messages array...");
    const messages = [];
    if (space?.defaultPrompt) {
      messages.push({ role: "system", content: space.defaultPrompt });
      console.log("[STREAM] Added space default prompt");
    }

    // Use different system prompts based on mode
    if (researchMode) {
      messages.push({
        role: "system",
        content:
          "You are an advanced research assistant with comprehensive web search capabilities. Your primary function is to conduct thorough, in-depth research on any topic the user asks about. IMPORTANT INSTRUCTIONS FOR RESEARCH MODE:\n\n1. ALWAYS use the web_search function to gather information - this is mandatory for every query.\n2. Perform MULTIPLE web searches with different query variations to get comprehensive coverage of the topic.\n3. Synthesize information from multiple sources to provide well-rounded, accurate answers.\n4. Include relevant sources and citations in your responses.\n5. Look for the most recent and authoritative information available.\n6. If the topic is complex, break it down and research each aspect separately.\n7. Provide detailed, well-structured responses with clear sections and bullet points where appropriate.\n8. Always acknowledge the date/time context of the information you find.\n\nYour goal is to be the most thorough research assistant possible, leaving no stone unturned in finding accurate, up-to-date information.",
      });
      console.log("[STREAM] Added RESEARCH MODE system prompt");
    } else {
      messages.push({
        role: "system",
        content:
          "You are a helpful AI assistant with web search and image generation capabilities. IMPORTANT: When the user asks about current events, news, today's information, real-time data, recent updates, or anything that requires up-to-date information, you MUST use the web_search function to get accurate, current information. Always prefer using web search for questions about 'today', 'now', 'current', 'latest', 'recent', or 'what's happening'. When the user asks to create, generate, draw, or make an image, picture, or artwork, use the generate_image function with a detailed, descriptive prompt. If an image is provided, analyze it and answer the user's question based on both the image and the prompt. If a document is provided, analyze its content and answer based on the document, the prompt, and any other context.",
      });
      console.log("[STREAM] Added system prompt with tool instructions");
    }

    // Add conversation history if exists
    if (conversation.messages && conversation.messages.length > 0) {
      console.log(
        "[STREAM] Adding conversation history:",
        conversation.messages.length,
        "messages",
      );
      conversation.messages.forEach((msg) => {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      });
    } else {
      console.log("[STREAM] No conversation history to add");
    }

    // Add current user message
    let userMessageContent = prompt || "";

    // Append document content to the user message if provided
    if (documentContent) {
      const docPrefix = `\n\n--- Document: ${
        documentMetadata?.filename || "uploaded document"
      } ---\n`;
      const docSuffix = "\n--- End of Document ---\n";
      userMessageContent =
        (userMessageContent || "Please analyze this document.") +
        docPrefix +
        documentContent +
        docSuffix;
      console.log("[STREAM] Document content appended to user message");
    }

    // Default prompt if only image is provided
    if (!userMessageContent && imageFile) {
      userMessageContent = "What is in this image?";
    }

    console.log("[STREAM] Adding current user message...");
    if (imageFile) {
      console.log("[STREAM] Encoding image to base64...");
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
      console.log(
        "[STREAM] ✓ User message with image added. Base64 length:",
        base64Image.length,
      );
      if (documentContent) {
        console.log("[STREAM] ✓ Document content also included in message");
      }
    } else {
      messages.push({ role: "user", content: userMessageContent });
      if (documentContent) {
        console.log("[STREAM] ✓ User message with document content added");
      } else {
        console.log("[STREAM] ✓ Text-only user message added");
      }
    }
    console.log("[STREAM] Total messages in context:", messages.length);

    try {
      // Define tools for function calling (web search and image generation)
      const tools = [
        {
          type: "function",
          function: {
            name: "web_search",
            description:
              "Search the web for current information, news, facts, or any real-time data. Use this when the user asks about current events, today's news, recent updates, or anything requiring up-to-date information beyond your training data cutoff.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "The search query to find information on the web. Be specific and include relevant keywords.",
                },
              },
              required: ["query"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "generate_image",
            description:
              "Generate an image using DALL-E based on a text description. Use this when the user asks to create, generate, draw, or make an image, picture, illustration, artwork, or visual content. Always use detailed and descriptive prompts for best results.",
            parameters: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description:
                    "A detailed description of the image to generate. Be specific about style, colors, composition, and details. Maximum 4000 characters.",
                },
                size: {
                  type: "string",
                  enum: ["1024x1024", "1536x1024", "1024x1536", "auto"],
                  description:
                    "The size of the generated image. Use 1024x1024 for square, 1536x1024 for landscape, 1024x1536 for portrait, or auto to let the model decide. Default is 1024x1024.",
                },
                quality: {
                  type: "string",
                  enum: ["low", "medium", "high", "auto"],
                  description:
                    "The quality of the generated image. Higher quality takes longer. Default is auto.",
                },
              },
              required: ["prompt"],
            },
          },
        },
      ];

      // Check if the query likely needs real-time data
      const needsRealTimeData =
        /\b(today|now|current|latest|recent|news|happening|2024|2025|this (week|month|year))\b/i.test(
          userMessageContent,
        );
      console.log("[STREAM] Query needs real-time data:", needsRealTimeData);

      // Check if the query likely needs image generation
      const needsImageGeneration =
        /\b(generate|create|draw|make|design|produce|render)\b.*\b(image|picture|photo|illustration|artwork|visual|graphic|icon|logo|banner)\b/i.test(
          userMessageContent,
        ) ||
        /\b(image|picture|photo|illustration|artwork|visual|graphic|icon|logo|banner)\b.*\b(of|for|showing|with|depicting)\b/i.test(
          userMessageContent,
        );
      console.log(
        "[STREAM] Query needs image generation:",
        needsImageGeneration,
      );

      // Determine tool choice based on query content and mode
      // Research mode ALWAYS forces web search
      const toolChoice =
        researchMode || needsRealTimeData ? "required" : "auto";
      console.log(
        "[STREAM] Tool choice strategy:",
        toolChoice,
        researchMode ? "(forced by research mode)" : "",
      );

      // Always enable web search for real-time data
      console.log(
        "[STREAM] Creating preflight request to check for tool calls...",
      );
      let workingMessages = [...messages];
      const preflight = await openai.chat.completions.create({
        model,
        messages: workingMessages,
        tools: tools,
        tool_choice: toolChoice,
      });
      console.log("[STREAM] ✓ Preflight response received");

      const preMsg = preflight.choices?.[0]?.message;
      const toolCalls = preMsg?.tool_calls || [];
      console.log("[STREAM] Tool calls detected:", toolCalls.length);

      // Track generated images for the response
      let generatedImages = [];

      if (toolCalls.length > 0) {
        console.log("[STREAM] Processing", toolCalls.length, "tool call(s)...");
        // Include assistant tool_calls message
        workingMessages.push({
          role: "assistant",
          content: preMsg.content || null,
          tool_calls: toolCalls,
        });

        // Execute tool calls
        for (const call of toolCalls) {
          console.log(
            "[STREAM] Executing tool call:",
            call.function?.name,
            "(ID:",
            call.id + ")",
          );
          if (
            call.type === "function" &&
            call.function?.name === "web_search"
          ) {
            let args = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch (_) {}
            const query = args.query || userMessageContent;
            console.log("[STREAM] Web search query:", query);
            const searchStartTime = Date.now();
            const result = await performWebSearch(query);
            const searchDuration = Date.now() - searchStartTime;
            console.log(
              "[STREAM] ✓ Web search completed in",
              searchDuration,
              "ms. Result length:",
              result.length,
            );
            // Log search result preview
            try {
              const resultObj = JSON.parse(result);
              console.log("[STREAM] Search result preview:", {
                hasAnswer: !!resultObj.answer,
                answerPreview: resultObj.answer?.substring(0, 100),
                resultsCount: resultObj.results?.length || 0,
                hasError: !!resultObj.error,
              });
            } catch (e) {
              console.log("[STREAM] Could not parse search result for preview");
            }
            workingMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: result,
            });
            console.log("[STREAM] ✓ Tool result added to messages");
          } else if (
            call.type === "function" &&
            call.function?.name === "generate_image"
          ) {
            let args = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch (_) {}
            const imagePrompt = args.prompt || userMessageContent;
            const size = args.size || "1024x1024";
            const quality = args.quality || "auto";
            console.log("[STREAM] Image generation request:", {
              promptPreview: imagePrompt.substring(0, 100),
              size,
              quality,
            });

            // Send a progress event to the client
            res.write(
              `data: ${JSON.stringify({
                type: "progress",
                message: "Generating image...",
                tool: "generate_image",
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            if (typeof res.flush === "function") res.flush();

            const genStartTime = Date.now();
            const result = await performImageGeneration(
              imagePrompt,
              size,
              quality,
            );
            const genDuration = Date.now() - genStartTime;
            console.log(
              "[STREAM] ✓ Image generation completed in",
              genDuration,
              "ms",
            );

            // Parse result and track generated image
            let toolResponseForLLM = result; // Default to full result
            try {
              const resultObj = JSON.parse(result);
              if (resultObj.success && resultObj.b64_json) {
                generatedImages.push({
                  b64_json: resultObj.b64_json,
                  revised_prompt: resultObj.revised_prompt,
                });
                console.log("[STREAM] ✓ Image added to generated images list");

                // Send image event to client with b64_json
                res.write(
                  `data: ${JSON.stringify({
                    type: "image",
                    b64_json: resultObj.b64_json,
                    revised_prompt: resultObj.revised_prompt,
                    timestamp: new Date().toISOString(),
                  })}\n\n`,
                );
                if (typeof res.flush === "function") res.flush();

                // Create a lightweight response for the LLM (without base64 data)
                // This prevents token limit issues when sending back to the model
                toolResponseForLLM = JSON.stringify({
                  success: true,
                  message: "Image generated successfully and sent to the user.",
                  revised_prompt: resultObj.revised_prompt,
                  image_delivered: true,
                });
              }
            } catch (e) {
              console.log("[STREAM] Could not parse image generation result");
            }

            workingMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: toolResponseForLLM,
            });
            console.log("[STREAM] ✓ Tool result added to messages");
          }
        }
        console.log("[STREAM] ✓ All tool calls executed");
        console.log(
          "[STREAM] Total messages before final response:",
          workingMessages.length,
        );

        // Stream final answer; prevent further tool calls to avoid loops
        console.log("[STREAM] Creating streaming request with tool results...");
        const stream = await openai.chat.completions.create({
          model,
          messages: workingMessages,
          stream: true,
          tools: tools,
          tool_choice: "none",
        });

        console.log(
          `[STREAM] Starting stream with model: ${model} (with tool results)`,
        );
        let chunkCount = 0;
        const streamStartTime = Date.now();
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            chunkCount++;
            fullResponse += content;
            res.write(
              `data: ${JSON.stringify({
                type: "chunk",
                content: content,
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            if (typeof res.flush === "function") res.flush();

            // Log every 50 chunks to avoid log spam
            if (chunkCount % 50 === 0) {
              console.log(
                `[STREAM] Streaming progress: ${chunkCount} chunks, ${fullResponse.length} chars`,
              );
            }
          }
          if (chunk.choices[0]?.finish_reason) {
            const streamDuration = Date.now() - streamStartTime;
            console.log(`[STREAM] ✓ Stream completed from ${model}`);
            console.log(`[STREAM] Stream statistics:`);
            console.log(`  - Total chunks: ${chunkCount}`);
            console.log(`  - Response length: ${fullResponse.length} chars`);
            console.log(`  - Stream duration: ${streamDuration}ms`);
            console.log(`  - Finish reason: ${chunk.choices[0].finish_reason}`);
            res.write(
              `data: ${JSON.stringify({
                type: "done",
                finish_reason: chunk.choices[0].finish_reason,
                full_response: fullResponse,
                generated_images:
                  generatedImages.length > 0 ? generatedImages : undefined,
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            if (typeof res.flush === "function") res.flush();
            break;
          }
        }
      } else {
        // No tool calls requested; stream normally
        console.log(
          "[STREAM] No tool calls needed. Creating direct streaming request...",
        );
        const stream = await openai.chat.completions.create({
          model,
          messages,
          stream: true,
          tools: tools,
        });

        console.log(`[STREAM] Starting stream with model: ${model}`);
        let chunkCount = 0;
        const streamStartTime = Date.now();
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            chunkCount++;
            fullResponse += content;
            res.write(
              `data: ${JSON.stringify({
                type: "chunk",
                content: content,
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            if (typeof res.flush === "function") res.flush();

            // Log every 50 chunks to avoid log spam
            if (chunkCount % 50 === 0) {
              console.log(
                `[STREAM] Streaming progress: ${chunkCount} chunks, ${fullResponse.length} chars`,
              );
            }
          }
          if (chunk.choices[0]?.finish_reason) {
            const streamDuration = Date.now() - streamStartTime;
            console.log(`[STREAM] ✓ Stream completed from ${model}`);
            console.log(`[STREAM] Stream statistics:`);
            console.log(`  - Total chunks: ${chunkCount}`);
            console.log(`  - Response length: ${fullResponse.length} chars`);
            console.log(`  - Stream duration: ${streamDuration}ms`);
            console.log(`  - Finish reason: ${chunk.choices[0].finish_reason}`);
            res.write(
              `data: ${JSON.stringify({
                type: "done",
                finish_reason: chunk.choices[0].finish_reason,
                full_response: fullResponse,
                generated_images:
                  generatedImages.length > 0 ? generatedImages : undefined,
                timestamp: new Date().toISOString(),
              })}\n\n`,
            );
            if (typeof res.flush === "function") res.flush();
            break;
          }
        }
      }

      // Save messages to database
      console.log("[STREAM] Saving messages to database...");
      try {
        // Upload files to Cloudinary if present
        let imageUrl = null;
        let imagePublicId = null;
        if (imageFile) {
          console.log("[STREAM] Uploading image to Cloudinary...");
          try {
            const result = await uploadToCloudinary(
              imageFile.buffer,
              "perplex/images",
              "image",
            );
            imageUrl = result.secure_url;
            imagePublicId = result.public_id;
            console.log("[STREAM] ✓ Image uploaded:", imageUrl);
          } catch (uploadError) {
            console.error(
              "[STREAM] ❌ Image upload failed:",
              uploadError.message,
            );
          }
        }

        let documentUrl = null;
        let documentPublicId = null;
        if (documentFile) {
          console.log("[STREAM] Uploading document to Cloudinary...");
          try {
            const result = await uploadToCloudinary(
              documentFile.buffer,
              "perplex/documents",
              "auto",
            );
            documentUrl = result.secure_url;
            documentPublicId = result.public_id;
            console.log("[STREAM] ✓ Document uploaded:", documentUrl);
          } catch (uploadError) {
            console.error(
              "[STREAM] ❌ Document upload failed:",
              uploadError.message,
            );
          }
        }

        // Save user message
        console.log("[STREAM] Saving user message...");
        await Conversation.addMessage(conversation.id, {
          role: "user",
          content: userMessageContent,
          metadata: {
            hasImage: !!imageFile,
            imageType: imageFile?.mimetype,
            imageUrl,
            imagePublicId,
            hasDocument: !!documentFile,
            documentName: documentMetadata?.filename,
            documentType: documentMetadata?.mimetype,
            documentSize: documentMetadata?.originalSize,
            documentUrl,
            documentPublicId,
          },
        });
        console.log("[STREAM] ✓ User message saved");

        // Save assistant response
        console.log("[STREAM] Saving assistant response...");
        await Conversation.addMessage(conversation.id, {
          role: "assistant",
          content: fullResponse,
          metadata: {
            model,
            responseLength: fullResponse.length,
            generatedImages:
              generatedImages.length > 0
                ? generatedImages.map((img) => ({
                    url: img.url,
                    revised_prompt: img.revised_prompt,
                  }))
                : undefined,
          },
        });
        console.log("[STREAM] ✓ Assistant response saved");

        // Auto-generate title if this is the first message
        if (!conversationId) {
          console.log("[STREAM] Auto-generating conversation title...");
          await Conversation.autoGenerateTitle(conversation.id);
          console.log("[STREAM] ✓ Conversation title generated");
        }
        console.log(
          "[STREAM] ✓ All database operations completed successfully",
        );
      } catch (dbError) {
        console.error("[STREAM] ❌ Error saving to database:", dbError);
        console.error("[STREAM] Database error details:", {
          message: dbError.message,
          stack: dbError.stack,
        });
        // Don't fail the request if DB save fails
      }

      // Save to user's search history
      try {
        console.log("[STREAM] Saving to user search history...");
        const historyEntry =
          prompt ||
          (documentFile
            ? `[document: ${documentMetadata?.filename || "uploaded"}]`
            : "[image]");
        await User.addToSearchHistory(req.user.id, historyEntry);
        console.log("[STREAM] ✓ Search history updated");
      } catch (historyError) {
        console.error(
          "[STREAM] ⚠️ Failed to save search history:",
          historyError.message,
        );
      }
    } catch (openaiError) {
      // We already opened the SSE stream; emit an error event and close
      console.error("[STREAM] ❌ OpenAI API Error:", {
        message: openaiError.message,
        status: openaiError.status,
        code: openaiError.code,
        type: openaiError.type,
      });
      console.error("[STREAM] OpenAI error stack:", openaiError.stack);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: "Failed to get response from AI service",
          error: openaiError.message,
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );
      if (typeof res.flush === "function") res.flush();
    }
    clearInterval(heartbeat);
    const totalDuration = Date.now() - requestStartTime;
    console.log("[STREAM] Closing stream connection");
    console.log("[STREAM] Total request duration:", totalDuration, "ms");
    console.log(
      "[STREAM] Final response length:",
      fullResponse.length,
      "characters",
    );
    res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
    if (typeof res.flush === "function") res.flush();
    res.end();
    console.log("========== [STREAM] Request Completed ==========\n");
  } catch (error) {
    const totalDuration = Date.now() - requestStartTime;
    console.error("[STREAM] ❌ Unexpected Error:", {
      message: error.message,
      stack: error.stack,
      duration: totalDuration + "ms",
    });

    if (!res.headersSent) {
      console.log("[STREAM] Sending error response (headers not sent yet)");
      console.log("========== [STREAM] Request Failed ==========\n");
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
    console.log("[STREAM] Sending error event through stream");
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: "Stream error occurred",
        error: error.message,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );
    // ensure heartbeat is cleared if set
    try {
      clearInterval(heartbeat);
    } catch (_) {}
    res.end();
    console.log("========== [STREAM] Request Failed ==========\n");
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
      model = thinkMode ? "gpt-5.2-2025-12-11" : "gpt-5-mini-2025-08-07",
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
      } chars, Tokens used: ${completion.usage?.total_tokens || "N/A"}`,
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
      "Failed to get AI response",
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

    // Always use gpt-5-nano by default
    const model = thinkMode ? "gpt-5.2-2025-12-11" : "gpt-5-mini-2025-08-07";
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
      `[ASK] Sending request to model: ${model}, Has image: ${!!imageFile}`,
    );

    const completion = await openai.chat.completions.create({
      model,
      messages,
    });

    const response = completion.choices[0]?.message?.content || "";
    console.log(
      `[ASK] Response received from ${model} - Length: ${
        response.length
      } chars, Tokens used: ${completion.usage?.total_tokens || "N/A"}`,
    );

    // Upload image to Cloudinary if present
    let imageUrl = null;
    let imagePublicId = null;
    if (imageFile) {
      console.log("[ASK] Uploading image to Cloudinary...");
      try {
        const result = await uploadToCloudinary(
          imageFile.buffer,
          "perplex/images",
          "image",
        );
        imageUrl = result.secure_url;
        imagePublicId = result.public_id;
        console.log("[ASK] ✓ Image uploaded:", imageUrl);
      } catch (uploadError) {
        console.error("[ASK] ❌ Image upload failed:", uploadError.message);
      }
    }

    // Save messages to database
    try {
      await Conversation.addMessage(conversation.id, {
        role: "user",
        content: userMessageContent,
        metadata: {
          hasImage: !!imageFile,
          imageType: imageFile?.mimetype,
          imageUrl,
          imagePublicId,
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
      "Failed to get AI response",
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
      `[VOICE] Transcription received - Text length: ${userText.length} chars`,
    );

    // Step 2: Get AI response using gpt-5-nano
    const chatModel = thinkMode ? "gpt-5.2" : "gpt-5-mini-2025-08-07";
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
      `[VOICE] Response received from ${chatModel} - Length: ${aiText.length} chars`,
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
      "Failed to process voice chat",
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
        `[UPLOAD-AUDIO] Invalid file type: ${audioFile.mimetype}, extension: ${fileExtension}`,
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
      `[UPLOAD-AUDIO] Conversion successful. PCM16 size: ${pcm16Buffer.length} bytes`,
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

// ============================================
// Text-to-Speech Endpoint
// ============================================

// @route   POST /api/chat/tts
// @desc    Convert text to speech using OpenAI gpt-4o-mini-tts-2025-12-15 model
// @access  Private
router.post("/tts", auth, async (req, res) => {
  console.log("\n========== [TTS] New Request Started ==========");
  console.log("[TTS] Timestamp:", new Date().toISOString());
  console.log("[TTS] User ID:", req.user?.id);
  console.log("[TTS] User Email:", req.user?.email);

  try {
    const {
      text,
      voice = "alloy",
      instructions,
      response_format = "mp3",
      speed = 1.0,
    } = req.body;

    console.log("[TTS] Request Parameters:");
    console.log("  - Text length:", text ? text.length : 0, "characters");
    console.log(
      "  - Text preview:",
      text ? text.substring(0, 100) + (text.length > 100 ? "..." : "") : "N/A",
    );
    console.log("  - Voice:", voice);
    console.log("  - Instructions:", instructions ? "Provided" : "None");
    console.log("  - Response format:", response_format);
    console.log("  - Speed:", speed);

    // Validate text input
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("[TTS] ❌ Validation failed: No text provided");
      return res.status(400).json({
        success: false,
        message: "Text is required",
      });
    }

    // Validate text length (OpenAI has a limit of ~4096 characters per request)
    if (text.length > 4096) {
      console.log("[TTS] ❌ Validation failed: Text too long");
      return res.status(400).json({
        success: false,
        message: "Text must be 4096 characters or less",
      });
    }

    // Validate voice option
    const validVoices = [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "onyx",
      "nova",
      "sage",
      "shimmer",
      "verse",
    ];
    if (!validVoices.includes(voice)) {
      console.log("[TTS] ❌ Validation failed: Invalid voice:", voice);
      return res.status(400).json({
        success: false,
        message: `Invalid voice. Valid options: ${validVoices.join(", ")}`,
      });
    }

    // Validate response format
    const validFormats = ["mp3", "opus", "aac", "flac", "wav", "pcm"];
    if (!validFormats.includes(response_format)) {
      console.log(
        "[TTS] ❌ Validation failed: Invalid response format:",
        response_format,
      );
      return res.status(400).json({
        success: false,
        message: `Invalid response format. Valid options: ${validFormats.join(
          ", ",
        )}`,
      });
    }

    // Validate speed (0.25 to 4.0)
    const parsedSpeed = parseFloat(speed);
    if (isNaN(parsedSpeed) || parsedSpeed < 0.25 || parsedSpeed > 4.0) {
      console.log("[TTS] ❌ Validation failed: Invalid speed:", speed);
      return res.status(400).json({
        success: false,
        message: "Speed must be between 0.25 and 4.0",
      });
    }

    console.log("[TTS] Creating speech with gpt-4o-mini-tts-2025-12-15...");

    // Build the request parameters
    const ttsParams = {
      model: "gpt-4o-mini-tts-2025-12-15",
      input: text.trim(),
      voice: voice,
      response_format: response_format,
      speed: parsedSpeed,
    };

    // Add instructions if provided (for controlling tone, emotion, pacing, etc.)
    if (
      instructions &&
      typeof instructions === "string" &&
      instructions.trim()
    ) {
      ttsParams.instructions = instructions.trim();
      console.log(
        "[TTS] Instructions added:",
        instructions.substring(0, 100) +
          (instructions.length > 100 ? "..." : ""),
      );
    }

    // Call OpenAI TTS API
    const ttsResponse = await openai.audio.speech.create(ttsParams);
    console.log("[TTS] ✓ Speech generated successfully");

    // Get the audio data as a buffer
    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    console.log("[TTS] Audio buffer size:", audioBuffer.length, "bytes");

    // Convert to base64 for JSON response
    const audioBase64 = audioBuffer.toString("base64");

    // Determine content type based on format
    const contentTypes = {
      mp3: "audio/mpeg",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
      wav: "audio/wav",
      pcm: "audio/pcm",
    };

    res.json({
      success: true,
      message: "Text-to-speech conversion successful",
      data: {
        audio: audioBase64,
        format: response_format,
        contentType: contentTypes[response_format],
        voice: voice,
        textLength: text.length,
        audioSize: audioBuffer.length,
        timestamp: new Date().toISOString(),
      },
    });

    console.log("[TTS] ✓ Response sent successfully");
  } catch (error) {
    console.error("[TTS] ❌ Error:", error);
    const { status, body } = toAIErrorResponse(
      error,
      "Failed to convert text to speech",
    );
    return res.status(status).json(body);
  }
});

// @route   POST /api/chat/tts/stream
// @desc    Stream text-to-speech audio using OpenAI gpt-4o-mini-tts-2025-12-15 model
// @access  Private
router.post("/tts/stream", auth, async (req, res) => {
  console.log("\n========== [TTS-STREAM] New Request Started ==========");
  console.log("[TTS-STREAM] Timestamp:", new Date().toISOString());
  console.log("[TTS-STREAM] User ID:", req.user?.id);

  try {
    const {
      text,
      voice = "alloy",
      instructions,
      response_format = "mp3",
      speed = 1.0,
    } = req.body;

    console.log("[TTS-STREAM] Request Parameters:");
    console.log("  - Text length:", text ? text.length : 0, "characters");
    console.log("  - Voice:", voice);
    console.log("  - Response format:", response_format);

    // Validate text input
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      console.log("[TTS-STREAM] ❌ Validation failed: No text provided");
      return res.status(400).json({
        success: false,
        message: "Text is required",
      });
    }

    if (text.length > 4096) {
      console.log("[TTS-STREAM] ❌ Validation failed: Text too long");
      return res.status(400).json({
        success: false,
        message: "Text must be 4096 characters or less",
      });
    }

    // Validate voice option
    const validVoices = [
      "alloy",
      "ash",
      "ballad",
      "coral",
      "echo",
      "fable",
      "onyx",
      "nova",
      "sage",
      "shimmer",
      "verse",
    ];
    if (!validVoices.includes(voice)) {
      return res.status(400).json({
        success: false,
        message: `Invalid voice. Valid options: ${validVoices.join(", ")}`,
      });
    }

    // Validate response format
    const validFormats = ["mp3", "opus", "aac", "flac", "wav", "pcm"];
    if (!validFormats.includes(response_format)) {
      return res.status(400).json({
        success: false,
        message: `Invalid response format. Valid options: ${validFormats.join(
          ", ",
        )}`,
      });
    }

    const parsedSpeed = parseFloat(speed);
    if (isNaN(parsedSpeed) || parsedSpeed < 0.25 || parsedSpeed > 4.0) {
      return res.status(400).json({
        success: false,
        message: "Speed must be between 0.25 and 4.0",
      });
    }

    // Determine content type based on format
    const contentTypes = {
      mp3: "audio/mpeg",
      opus: "audio/opus",
      aac: "audio/aac",
      flac: "audio/flac",
      wav: "audio/wav",
      pcm: "audio/pcm",
    };

    // Set headers for streaming audio
    res.setHeader("Content-Type", contentTypes[response_format]);
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    console.log("[TTS-STREAM] Creating streaming speech...");

    // Build the request parameters
    const ttsParams = {
      model: "gpt-4o-mini-tts-2025-12-15",
      input: text.trim(),
      voice: voice,
      response_format: response_format,
      speed: parsedSpeed,
    };

    // Add instructions if provided
    if (
      instructions &&
      typeof instructions === "string" &&
      instructions.trim()
    ) {
      ttsParams.instructions = instructions.trim();
    }

    // Call OpenAI TTS API
    const ttsResponse = await openai.audio.speech.create(ttsParams);

    // Stream the response
    const audioBuffer = Buffer.from(await ttsResponse.arrayBuffer());
    res.write(audioBuffer);
    res.end();

    console.log("[TTS-STREAM] ✓ Audio streamed successfully");
  } catch (error) {
    console.error("[TTS-STREAM] ❌ Error:", error);

    // If headers haven't been sent, return JSON error
    if (!res.headersSent) {
      const { status, body } = toAIErrorResponse(
        error,
        "Failed to stream text to speech",
      );
      return res.status(status).json(body);
    }

    // If streaming already started, end the response
    res.end();
  }
});

module.exports = router;
