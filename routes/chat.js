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
const { nanoid } = require("nanoid");
const prisma = require("../config/database");

const router = express.Router();

// Store active streams for abort functionality
// Key: streamId, Value: { abortController, conversationId, userId, fullResponse, startTime }
const activeStreams = new Map();

// Initialize OpenAI client with optimized settings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 2,
  timeout: 60000, // 60 second timeout
});

// Pre-warm OpenAI connection on startup
(async () => {
  try {
    // Make a minimal API call to establish connection
    await openai.models.list().catch(() => {});
    console.log("[OPENAI] ✓ Connection pre-warmed");
  } catch (e) {
    console.log("[OPENAI] Connection warm-up skipped");
  }
})();

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
// Web search is now handled natively by the model

// Helper: Detect if the prompt requires web search (used for Quick Mode only)
// Think Mode and Research Mode always have web search enabled
function needsWebSearch(prompt) {
  if (!prompt) return false;
  const lowerPrompt = prompt.toLowerCase();

  // Keywords that indicate web search is needed for Quick Mode
  const searchKeywords = [
    // Explicit search requests
    "search",
    "look up",
    "lookup",
    "google",
    "find out",
    "find me",
    "browse",
    "check online",
    "search the web",
    "search web",
    "search online",

    // Weather queries
    "weather",
    "temperature",
    "forecast",
    "humidity",
    "rain today",
    "will it rain",
    "is it cold",
    "is it hot",

    // News and current events
    "news",
    "headlines",
    "breaking",
    "latest",
    "recent",
    "what happened",
    "what's happening",
    "trending",

    // Financial/market data
    "stock",
    "share price",
    "market",
    "crypto",
    "bitcoin",
    "ethereum",
    "exchange rate",
    "currency",
    "forex",
    "nifty",
    "sensex",

    // Sports scores and results
    "score",
    "match result",
    "who won",
    "game result",
    "standings",
    "ipl",
    "world cup",
    "premier league",
    "nba",
    "nfl",

    // Real-time information
    "live",
    "real-time",
    "realtime",
    "right now",
    "currently",
    "today",
    "yesterday",
    "this week",
    "this month",

    // Location-based queries
    "near me",
    "nearby",
    "open now",
    "hours of",
    "location of",
    "directions to",
    "how to get to",
    "address of",

    // Product/price queries
    "price of",
    "cost of",
    "how much is",
    "buy",
    "purchase",
    "deals on",
    "discount",
    "sale on",
    "cheapest",

    // People and entities (current info)
    "net worth",
    "age of",
    "birthday",
    "who is the current",
    "ceo of",
    "founder of",
    "president of",
    "prime minister",

    // Events and releases
    "release date",
    "when is",
    "schedule",
    "upcoming",
    "event",
    "concert",
    "movie release",
    "launch date",

    // Tech and updates
    "latest version",
    "new update",
    "changelog",
    "patch notes",
    "ios",
    "android",
    "windows",
    "update",

    // Year references (likely needs current info)
    "2024",
    "2025",
    "2026",
    "2027",
  ];

  return searchKeywords.some((keyword) => lowerPrompt.includes(keyword));
}

// Helper: Detect if the prompt requires image generation
function needsImageGeneration(prompt) {
  if (!prompt) return false;
  const lowerPrompt = prompt.toLowerCase();

  // Keywords that indicate image generation is needed
  const imageKeywords = [
    "create image",
    "create an image",
    "create a image",
    "generate image",
    "generate an image",
    "generate a image",
    "make image",
    "make an image",
    "make a image",
    "draw",
    "drawing",
    "sketch",
    "create picture",
    "create a picture",
    "generate picture",
    "make picture",
    "make a picture",
    "create art",
    "generate art",
    "make art",
    "create illustration",
    "generate illustration",
    "create visual",
    "generate visual",
    "design a",
    "design an",
    "paint",
    "painting",
    "render",
    "rendering",
    "create logo",
    "generate logo",
    "make logo",
    "create icon",
    "generate icon",
    "visualize",
    "visualization",
    "image of",
    "picture of",
    "photo of",
    "dall-e",
    "dalle",
  ];

  return imageKeywords.some((keyword) => lowerPrompt.includes(keyword));
}

// Perform image generation via DALL-E
async function performImageGeneration(
  prompt,
  size = "1024x1024",
  quality = "standard"
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

// Helper function to upload base64 image to Cloudinary and return URL
async function uploadBase64ToCloudinary(base64Data, revisedPrompt = "") {
  try {
    console.log("[CLOUDINARY] Uploading generated image...");
    const imageBuffer = Buffer.from(base64Data, "base64");
    const uploadResult = await uploadToCloudinary(
      imageBuffer,
      "perplex/generated-images",
      "image"
    );
    console.log("[CLOUDINARY] ✓ Image uploaded:", uploadResult.secure_url);
    return {
      success: true,
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      revised_prompt: revisedPrompt,
    };
  } catch (uploadError) {
    console.error("[CLOUDINARY] ⚠️ Upload failed:", uploadError.message);
    return {
      success: false,
      url: null,
      publicId: null,
      revised_prompt: revisedPrompt,
    };
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
  const timings = {}; // Track timing for each step
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
        : "N/A"
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
        documentFile.mimetype
      );
      return res.status(400).json({
        success: false,
        message: `Unsupported document type: ${
          documentFile.mimetype
        }. Supported types: ${Object.keys(SUPPORTED_DOCUMENT_TYPES).join(
          ", "
        )}`,
      });
    }

    // Model selection based on mode:
    // - Quick Mode: gpt-4o-mini (fastest, optimized for speed)
    // - Think Mode: gpt-4o (balanced speed and quality)
    // - Research Mode: gpt-4o with web search
    let model;
    if (researchMode) {
      model = "gpt-4o"; // Best for research with web search
    } else if (thinkMode) {
      model = "gpt-4o"; // Good reasoning capabilities
    } else {
      model = "gpt-4o-mini"; // Fastest for quick responses
    }
    console.log("[STREAM] Model selected:", model);
    if (researchMode) {
      console.log(
        "[STREAM] Research mode active - will force comprehensive web search"
      );
    }

    if (!prompt && !imageFile && !documentFile) {
      console.log(
        "[STREAM] ❌ Validation failed: No prompt, image, or document provided"
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
          documentFile.originalname
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
          parseError.message
        );
        return res.status(400).json({
          success: false,
          message: `Failed to parse document: ${parseError.message}`,
        });
      }
    }

    timings.parseInput = Date.now() - requestStartTime;
    console.log(`[STREAM] ⏱️ Input parsing took: ${timings.parseInput}ms`);

    // ============================================
    // OPTIMIZATION: Set up SSE connection FIRST before any DB operations
    // This gives the client immediate feedback that the request is being processed
    // ============================================

    // Prepare Server-Sent Events response upfront so the client gets an immediate connection
    console.log("[STREAM] Setting up SSE headers...");
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");
    res.setHeader("X-Accel-Buffering", "no");

    try {
      res.setHeader("Content-Encoding", "identity");
    } catch (_) {}
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    // Generate unique streamId and create AbortController for this stream
    const streamId = nanoid();
    const abortController = new AbortController();
    let isAborted = false;
    let fullResponse = "";

    // Send initial "connecting" event immediately (before DB operations)
    res.write(
      `data: ${JSON.stringify({
        type: "connecting",
        message: "Initializing...",
        streamId: streamId,
      })}\n\n`
    );
    if (typeof res.flush === "function") res.flush();
    console.log(
      "[STREAM] ✓ Sent 'connecting' event, starting DB operations..."
    );

    // Heartbeat to keep proxies from closing idle connections
    const heartbeat = setInterval(() => {
      try {
        res.write(": keep-alive\n\n");
        if (typeof res.flush === "function") res.flush();
      } catch (_) {}
    }, 15000);

    req.on("aborted", () => {
      try {
        clearInterval(heartbeat);
        isAborted = true;
        abortController.abort();
        activeStreams.delete(streamId);
        console.warn(
          "[STREAM] Request aborted by client, stream ID:",
          streamId
        );
      } catch (_) {}
    });
    req.on("close", () => {
      try {
        clearInterval(heartbeat);
        activeStreams.delete(streamId);
      } catch (_) {}
    });

    const cleanupStream = () => {
      activeStreams.delete(streamId);
      clearInterval(heartbeat);
    };

    // ============================================
    // Now perform DB operations (while client already has SSE connection)
    // Limit message history to 20 for performance
    // ============================================
    const dbStartTime = Date.now();
    console.log("[STREAM] Getting/creating conversation...");

    let conversation;
    let space = null;

    // Run conversation and space loading in parallel if both are needed
    if (conversationId && spaceId) {
      const [convResult, spaceResult] = await Promise.all([
        Conversation.findById(conversationId, {
          includeMessages: true,
          messageLimit: 20,
        }),
        Space.findById(spaceId),
      ]);
      conversation = convResult;
      space = spaceResult;
    } else if (conversationId) {
      conversation = await Conversation.findById(conversationId, {
        includeMessages: true,
        messageLimit: 20, // Only load last 20 messages for context
      });
    } else if (spaceId) {
      // For new conversations, create conversation and load space in parallel
      const [convResult, spaceResult] = await Promise.all([
        Conversation.create({
          userId: req.user.id,
          title: "New Chat",
          spaceId: spaceId,
        }),
        Space.findById(spaceId),
      ]);
      conversation = convResult;
      space = spaceResult;
    } else {
      // New conversation without space - simple create
      conversation = await Conversation.create({
        userId: req.user.id,
        title: "New Chat",
      });
    }

    // Validate conversation access
    if (
      conversationId &&
      (!conversation || conversation.userId !== req.user.id)
    ) {
      console.log(
        "[STREAM] ❌ Conversation not found or access denied:",
        conversationId
      );
      cleanupStream();
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: "Conversation not found",
        })}\n\n`
      );
      res.end();
      return;
    }

    // Validate space access
    if (spaceId && (!space || space.userId !== req.user.id)) {
      console.log("[STREAM] ❌ Space not found or access denied:", spaceId);
      cleanupStream();
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: "Access denied to space",
        })}\n\n`
      );
      res.end();
      return;
    }

    timings.database = Date.now() - dbStartTime;
    console.log(`[STREAM] ⏱️ Database operations took: ${timings.database}ms`);
    console.log(
      "[STREAM] ✓ Conversation ID:",
      conversation.id,
      "Messages:",
      conversation.messages?.length || 0
    );

    // Store stream info for potential abort
    activeStreams.set(streamId, {
      abortController,
      conversationId: conversation.id,
      userId: req.user.id,
      getFullResponse: () => fullResponse,
      startTime: Date.now(),
      userMessageContent: null,
      model: null,
    });

    // Send full "connected" event now that we have conversation ID
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        message: "Stream started",
        conversationId: conversation.id,
        streamId: streamId,
      })}\n\n`
    );
    if (typeof res.flush === "function") res.flush();
    console.log("[STREAM] ✓ Connection established with client");

    // Build messages array with conversation history
    console.log("[STREAM] Building messages array...");
    const messages = [];
    if (space?.defaultPrompt) {
      messages.push({ role: "system", content: space.defaultPrompt });
      console.log("[STREAM] Added space default prompt");
    }

    // Use different system prompts based on mode
    if (researchMode) {
      // RESEARCH MODE: Comprehensive web research
      messages.push({
        role: "system",
        content: `You are Erudite AIC an advanced research assistant with comprehensive web search capabilities. Your primary function is to conduct thorough, in-depth research on any topic the user asks about.

RESEARCH MODE INSTRUCTIONS:
1. ALWAYS use the web_search function to gather information - this is mandatory for every query.
2. Perform MULTIPLE web searches with different query variations to get comprehensive coverage.
3. Synthesize information from multiple sources to provide well-rounded, accurate answers.
4. Include relevant sources and citations in your responses.
5. Look for the most recent and authoritative information available.
6. If the topic is complex, break it down and research each aspect separately.
7. Provide detailed, well-structured responses with clear sections and bullet points.
8. Always acknowledge the date/time context of the information you find.
9. Cross-reference facts across multiple sources for accuracy.
10. Format your response in markdown with proper headings and structure.

Your goal is to be the most thorough research assistant possible, leaving no stone unturned in finding accurate, up-to-date information.`,
      });
      console.log("[STREAM] Added RESEARCH MODE system prompt");
    } else if (thinkMode) {
      // THINK MODE: Deep reasoning and analysis
      messages.push({
        role: "system",
        content: `You are Erudite AIC an advanced AI assistant optimized for deep thinking, complex reasoning, and thorough analysis.

THINK MODE INSTRUCTIONS:
1. Take your time to think through problems step by step.
2. Break down complex questions into smaller, manageable parts.
3. Consider multiple perspectives and approaches before arriving at conclusions.
4. Show your reasoning process - explain HOW you arrive at answers, not just WHAT the answer is.
5. For technical or mathematical problems, work through the logic methodically.
6. Identify assumptions, edge cases, and potential limitations in your analysis.
7. When appropriate, consider counterarguments or alternative viewpoints.
8. Provide comprehensive, well-reasoned responses rather than quick surface-level answers.
9. If you're uncertain about something, acknowledge it and explain why.
10. Format your response in markdown with clear structure for complex explanations.

You have access to web search for current information and image generation if needed. Use these tools when they would enhance your analysis.`,
      });
      console.log("[STREAM] Added THINK MODE system prompt");
    } else {
      // QUICK MODE (default): Fast, concise responses - SHORT system prompt for speed
      messages.push({
        role: "system",
        content: `You are Erudite AIC, a fast AI assistant. Be direct and concise. Use markdown. Give short, accurate answers.`,
      });
      console.log("[STREAM] Added QUICK MODE system prompt");
    }

    // Add conversation history if exists
    // Quick mode: limit to 10 messages for speed
    // Think/Research mode: limit to 20 messages for more context
    if (conversation.messages && conversation.messages.length > 0) {
      const messageLimit = thinkMode || researchMode ? 20 : 10;
      const recentMessages = conversation.messages.slice(-messageLimit);
      console.log(
        "[STREAM] Adding conversation history:",
        recentMessages.length,
        "of",
        conversation.messages.length,
        "messages"
      );
      recentMessages.forEach((msg) => {
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
        base64Image.length
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

    // Determine which tools are needed based on the prompt and mode
    const promptText = userMessageContent || prompt || "";
    const requiresImageGen = needsImageGeneration(promptText);

    // Web search logic:
    // - Research Mode: ALWAYS enable web search (AI decides when to use)
    // - Think Mode: ALWAYS enable web search (AI decides when to use)
    // - Quick Mode: Only enable if keywords match (for speed)
    const requiresWebSearch =
      researchMode || thinkMode || needsWebSearch(promptText);

    console.log("[STREAM] Tool detection:", {
      requiresWebSearch,
      requiresImageGen,
      mode: researchMode ? "research" : thinkMode ? "think" : "quick",
    });

    // Build tools array conditionally - only include tools when needed
    const tools = [];

    if (requiresWebSearch) {
      tools.push({ type: "web_search" });
    }

    if (requiresImageGen) {
      tools.push({
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
      });
    }

    // Only set tool choice if we have tools
    const toolChoice = tools.length > 0 ? "auto" : undefined;
    console.log(
      "[STREAM] Tools enabled:",
      tools.length > 0 ? tools.map((t) => t.type || t.function?.name) : "none"
    );

    // Determine if we should use the new 'responses' API (if available) or standard chat completions
    // The user requested to use the SDK's web search tool which is often associated with the 'responses' API
    const useResponsesApi = !!openai.responses;
    console.log("[STREAM] Using 'responses' API:", useResponsesApi);

    let stream;

    if (useResponsesApi) {
      // Construct input string from messages for the responses API
      // Assuming responses API takes a single 'input' string
      let inputString = "";
      if (messages.length > 0) {
        // Add system prompt if present
        const systemMsg = messages.find((m) => m.role === "system");
        if (systemMsg) inputString += `System: ${systemMsg.content}\n\n`;

        // Add conversation history (last 10 messages to keep it concise)
        const history = messages.filter((m) => m.role !== "system").slice(-10);
        history.forEach((msg) => {
          inputString += `${msg.role === "user" ? "User" : "Assistant"}: ${
            msg.content
          }\n`;
        });
      }
      // Ensure the prompt is at the end if not already added
      if (!inputString.endsWith(userMessageContent)) {
        inputString += `User: ${userMessageContent}`;
      }

      console.log("[STREAM] Starting stream with responses API. Model:", model);

      // Build tools for responses API conditionally
      const responsesTools = [];
      if (requiresWebSearch) responsesTools.push({ type: "web_search" });
      if (requiresImageGen) responsesTools.push({ type: "image_generation" });

      const openaiStartTime = Date.now();
      stream = await openai.responses.create({
        model,
        input: inputString,
        ...(responsesTools.length > 0 && { tools: responsesTools }),
        stream: true,
      });
      timings.openaiConnect = Date.now() - openaiStartTime;
      console.log(
        `[STREAM] ⏱️ OpenAI connection took: ${timings.openaiConnect}ms`
      );
    } else {
      // Fallback to standard chat completions
      console.log(
        "[STREAM] Starting stream with chat completions. Model:",
        model
      );

      // Start streaming immediately - NO PREFLIGHT
      // Only include tools if any are needed
      const openaiStartTime = Date.now();
      stream = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
        // Optimize streaming for faster first token
        stream_options: { include_usage: false },
        ...(tools.length > 0 && { tools, tool_choice: toolChoice }),
      });
      timings.openaiConnect = Date.now() - openaiStartTime;
      console.log(
        `[STREAM] ⏱️ OpenAI connection took: ${timings.openaiConnect}ms`
      );
    }

    let toolCalls = [];
    let generatedImages = [];
    let streamEndedWithToolCalls = false;
    let finishReason = null;
    let firstChunkReceived = false;

    // Helper to process stream chunks
    const processChunk = async (chunk) => {
      // Adapt to different chunk structures if necessary
      // Standard chat completion chunk: chunk.choices[0].delta
      // Responses API chunk: type="response.output_text.delta", delta="text"

      // Debug logging for ALL stream chunks with response type
      if (chunk.type && chunk.type.startsWith("response.")) {
        console.log(
          "[STREAM] Responses API chunk:",
          JSON.stringify(
            chunk,
            (key, value) => {
              // Truncate base64 data for logging
              if (typeof value === "string" && value.length > 200) {
                return value.substring(0, 100) + `...[${value.length} chars]`;
              }
              return value;
            },
            2
          )
        );
      }

      let delta = {};
      let reason = null;

      if (chunk.choices && chunk.choices[0]) {
        delta = chunk.choices[0].delta;
        reason = chunk.choices[0].finish_reason;
      } else if (chunk.type === "response.output_text.delta") {
        // Responses API text delta
        delta = { content: chunk.delta };
      } else if (chunk.type === "response.completed") {
        // Responses API completion - also check for images in output
        reason = "stop";

        // Check if the completed response contains any images we might have missed
        if (chunk.response?.output) {
          console.log("[STREAM] Checking response.completed for images...");
          for (const outputItem of chunk.response.output) {
            if (
              outputItem.type === "image_generation_call" ||
              outputItem.type === "image"
            ) {
              console.log(
                "[STREAM] Found image in completed response:",
                JSON.stringify(
                  outputItem,
                  (key, value) => {
                    if (typeof value === "string" && value.length > 100) {
                      return (
                        value.substring(0, 50) + `...[${value.length} chars]`
                      );
                    }
                    return value;
                  },
                  2
                )
              );

              // Extract image data from various possible structures
              // Check if result is a string directly (OpenAI Responses API format)
              let imageData = null;
              if (outputItem.result && typeof outputItem.result === "string") {
                imageData = outputItem.result;
              } else {
                imageData =
                  outputItem.result?.b64_json ||
                  outputItem.b64_json ||
                  outputItem.image_data ||
                  outputItem.image ||
                  outputItem.data;
              }
              let revisedPrompt =
                outputItem.revised_prompt ||
                outputItem.result?.revised_prompt ||
                outputItem.prompt ||
                "";

              // Check if we already sent this image
              const alreadySent = generatedImages.some(
                (img) => img.b64_json === imageData || img.url === imageData
              );

              if (imageData && typeof imageData === "string" && !alreadySent) {
                // Upload to Cloudinary
                const uploadResult = await uploadBase64ToCloudinary(
                  imageData,
                  revisedPrompt
                );
                generatedImages.push({
                  url: uploadResult.url,
                  publicId: uploadResult.publicId,
                  revised_prompt: revisedPrompt,
                });
                res.write(
                  `data: ${JSON.stringify({
                    type: "image",
                    url: uploadResult.url,
                    revised_prompt: revisedPrompt,
                    timestamp: new Date().toISOString(),
                  })}\n\n`
                );
                if (typeof res.flush === "function") res.flush();
                console.log("[STREAM] ✓ Image sent from response.completed");
              }
            }
          }
        }
      } else if (
        chunk.type === "response.output_item.done" &&
        chunk.item?.type === "image_generation_call"
      ) {
        // Handle native image generation results from the responses API
        const item = chunk.item;
        console.log(
          "[STREAM] Image generation result received from responses API"
        );
        console.log(
          "[STREAM] Image item structure:",
          JSON.stringify(
            item,
            (key, value) => {
              // Truncate base64 data for logging
              if (typeof value === "string" && value.length > 100) {
                return value.substring(0, 100) + "...[truncated]";
              }
              return value;
            },
            2
          )
        );
        console.log("[STREAM] Item top-level keys:", Object.keys(item));

        // Try to extract image data from various possible structures
        let imageData = null;
        let revisedPrompt = item.revised_prompt || item.prompt || "";

        // Check if item.result IS the base64 string directly (OpenAI Responses API format)
        if (item.result && typeof item.result === "string") {
          console.log(
            "[STREAM] item.result is a string (base64 data directly)"
          );
          imageData = item.result;
        }

        // Check direct item properties
        if (!imageData) {
          imageData = item.b64_json || item.image_data || item.data;
        }

        // Check item.result as object (alternative structure)
        if (!imageData && item.result && typeof item.result === "object") {
          const imageResult = item.result;
          console.log(
            "[STREAM] Checking item.result as object, keys:",
            Object.keys(imageResult)
          );
          imageData =
            imageResult.b64_json || imageResult.image || imageResult.data;
          revisedPrompt =
            imageResult.revised_prompt || item.call?.prompt || revisedPrompt;

          // Check for URL-based response
          if (!imageData && imageResult.url) {
            generatedImages.push({
              url: imageResult.url,
              revised_prompt: revisedPrompt,
            });

            res.write(
              `data: ${JSON.stringify({
                type: "image",
                url: imageResult.url,
                revised_prompt: revisedPrompt,
                timestamp: new Date().toISOString(),
              })}\n\n`
            );
            if (typeof res.flush === "function") res.flush();
            console.log("[STREAM] ✓ Image URL event sent to client");
          }
        }

        // Check item.image (alternative structure)
        if (!imageData && item.image) {
          console.log("[STREAM] Checking item.image");
          if (typeof item.image === "string") {
            imageData = item.image;
          } else {
            imageData = item.image.b64_json || item.image.data || item.image;
            revisedPrompt =
              item.image.revised_prompt || item.revised_prompt || revisedPrompt;
          }
        }

        // Check item.output (another possible structure)
        if (!imageData && item.output) {
          if (Array.isArray(item.output)) {
            // Handle array of images
            for (const output of item.output) {
              const imgData = output.b64_json || output.image || output.data;
              const imgPrompt = output.revised_prompt || revisedPrompt;
              if (imgData) {
                // Upload to Cloudinary
                const uploadResult = await uploadBase64ToCloudinary(
                  imgData,
                  imgPrompt
                );
                generatedImages.push({
                  url: uploadResult.url,
                  publicId: uploadResult.publicId,
                  revised_prompt: imgPrompt,
                });
                res.write(
                  `data: ${JSON.stringify({
                    type: "image",
                    url: uploadResult.url,
                    revised_prompt: imgPrompt,
                    timestamp: new Date().toISOString(),
                  })}\n\n`
                );
                if (typeof res.flush === "function") res.flush();
              }
            }
            console.log("[STREAM] ✓ Image events sent from output array");
          } else {
            imageData =
              item.output.b64_json || item.output.image || item.output.data;
            revisedPrompt = item.output.revised_prompt || revisedPrompt;
          }
        }

        // Last resort: scan all properties for base64 data
        if (!imageData) {
          console.log(
            "[STREAM] Scanning all item properties for image data..."
          );
          const findBase64InObject = (obj, depth = 0) => {
            if (depth > 3 || !obj || typeof obj !== "object") return null;
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === "string" && value.length > 1000) {
                // Likely base64 image data
                console.log(
                  `[STREAM] Found potential base64 at key: ${key}, length: ${value.length}`
                );
                return value;
              }
              if (typeof value === "object" && value !== null) {
                const found = findBase64InObject(value, depth + 1);
                if (found) return found;
              }
            }
            return null;
          };
          imageData = findBase64InObject(item);
        }

        // Send image event if we found base64 data
        if (imageData && typeof imageData === "string") {
          // Upload to Cloudinary
          const uploadResult = await uploadBase64ToCloudinary(
            imageData,
            revisedPrompt
          );
          generatedImages.push({
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            revised_prompt: revisedPrompt,
          });

          res.write(
            `data: ${JSON.stringify({
              type: "image",
              url: uploadResult.url,
              revised_prompt: revisedPrompt,
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          if (typeof res.flush === "function") res.flush();
          console.log("[STREAM] ✓ Image URL event sent to client");
        } else {
          console.log(
            "[STREAM] ⚠ No image data found in image_generation_call item"
          );
        }
      } else if (
        chunk.type === "response.output_item.added" &&
        chunk.item?.type === "image_generation_call"
      ) {
        // Send progress event when image generation starts
        console.log("[STREAM] Image generation started");
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            message: "Generating image...",
            tool: "image_generation",
            timestamp: new Date().toISOString(),
          })}\n\n`
        );
        if (typeof res.flush === "function") res.flush();
      } else if (
        chunk.type === "response.output_item.done" &&
        chunk.item?.type === "image"
      ) {
        // Handle direct image output from the responses API
        const item = chunk.item;
        console.log("[STREAM] Direct image output received from responses API");

        // Try to extract image data - the image might be in various places
        let imageData =
          item.image_data || item.data || item.b64_json || item.image;
        let revisedPrompt = item.revised_prompt || item.prompt || "";

        // Handle nested structure
        if (!imageData && item.content) {
          imageData =
            item.content.b64_json ||
            item.content.data ||
            item.content.image ||
            item.content;
          revisedPrompt = item.content.revised_prompt || revisedPrompt;
        }

        // Handle array content
        if (!imageData && Array.isArray(item.content)) {
          for (const content of item.content) {
            const imgData = content.b64_json || content.data || content.image;
            if (imgData && typeof imgData === "string") {
              // Upload to Cloudinary
              const uploadResult = await uploadBase64ToCloudinary(
                imgData,
                content.revised_prompt || revisedPrompt
              );
              generatedImages.push({
                url: uploadResult.url,
                publicId: uploadResult.publicId,
                revised_prompt: content.revised_prompt || revisedPrompt,
              });
              res.write(
                `data: ${JSON.stringify({
                  type: "image",
                  url: uploadResult.url,
                  revised_prompt: content.revised_prompt || revisedPrompt,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();
              console.log("[STREAM] ✓ Image event sent from content array");
            }
          }
        }

        if (imageData && typeof imageData === "string") {
          // Upload to Cloudinary
          const uploadResult = await uploadBase64ToCloudinary(
            imageData,
            revisedPrompt
          );
          generatedImages.push({
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            revised_prompt: revisedPrompt,
          });
          res.write(
            `data: ${JSON.stringify({
              type: "image",
              url: uploadResult.url,
              revised_prompt: revisedPrompt,
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          if (typeof res.flush === "function") res.flush();
          console.log("[STREAM] ✓ Direct image event sent to client");
        }
      } else if (
        chunk.type === "response.output_item.done" &&
        chunk.item?.type === "function_call"
      ) {
        // Handle tool calls if they appear here (future proofing)
      } else if (
        chunk.type === "response.image_generation.done" ||
        chunk.type === "response.image_generation_call.done"
      ) {
        // Handle dedicated image generation completion event
        console.log("[STREAM] Image generation done event received");
        const imageData =
          chunk.result?.b64_json || chunk.b64_json || chunk.image || chunk.data;
        const revisedPrompt =
          chunk.result?.revised_prompt || chunk.revised_prompt || "";

        if (imageData && typeof imageData === "string") {
          // Upload to Cloudinary
          const uploadResult = await uploadBase64ToCloudinary(
            imageData,
            revisedPrompt
          );
          generatedImages.push({
            url: uploadResult.url,
            publicId: uploadResult.publicId,
            revised_prompt: revisedPrompt,
          });
          res.write(
            `data: ${JSON.stringify({
              type: "image",
              url: uploadResult.url,
              revised_prompt: revisedPrompt,
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          if (typeof res.flush === "function") res.flush();
          console.log("[STREAM] ✓ Image sent from image_generation.done event");
        }
      } else if (chunk.type && chunk.type.startsWith("response.")) {
        // Log other responses API events for debugging
        console.log("[STREAM] Unhandled responses API event:", chunk.type);
        if (chunk.item?.type) {
          console.log("[STREAM]   item.type:", chunk.item.type);
        }
        if (chunk.item) {
          console.log("[STREAM]   item keys:", Object.keys(chunk.item));
        }
        // Fallback/Generic
        delta = chunk.delta || {};
        reason = chunk.finish_reason;
      } else {
        // Fallback/Generic
        delta = chunk.delta || {};
        reason = chunk.finish_reason;
      }

      // Accumulate tool calls
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id,
              type: tc.type,
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.type) toolCalls[idx].type = tc.type;
          if (tc.function?.name)
            toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments)
            toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }

      // Stream content
      if (delta?.content) {
        fullResponse += delta.content;
        res.write(
          `data: ${JSON.stringify({
            type: "chunk",
            content: delta.content,
            timestamp: new Date().toISOString(),
          })}\n\n`
        );
        if (typeof res.flush === "function") res.flush();
      }

      if (reason) {
        finishReason = reason;
        if (reason === "tool_calls") {
          streamEndedWithToolCalls = true;
        }
      }
    };

    for await (const chunk of stream) {
      // Track time to first chunk
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        timings.firstChunk = Date.now() - requestStartTime;
        console.log(`[STREAM] ⏱️ Time to first chunk: ${timings.firstChunk}ms`);
      }

      // Check if stream was aborted
      if (isAborted || abortController.signal.aborted) {
        console.log(
          "[STREAM] Stream aborted by user, stopping at",
          fullResponse.length,
          "characters"
        );
        finishReason = "stopped";
        break;
      }
      await processChunk(chunk);
    }

    // Handle tool calls if the stream ended with them
    if (streamEndedWithToolCalls && toolCalls.length > 0) {
      console.log("[STREAM] Tool calls detected:", toolCalls.length);

      // Append assistant message with tool calls
      messages.push({
        role: "assistant",
        content: fullResponse || null,
        tool_calls: toolCalls,
      });

      // Execute tools
      for (const call of toolCalls) {
        console.log(
          "[STREAM] Executing tool:",
          call.function?.name || call.type
        );

        if (call.function?.name === "generate_image") {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch (_) {}

          // Send progress
          res.write(
            `data: ${JSON.stringify({
              type: "progress",
              message: "Generating image...",
              tool: "generate_image",
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          if (typeof res.flush === "function") res.flush();

          const result = await performImageGeneration(
            args.prompt,
            args.size,
            args.quality
          );

          // Handle result
          let toolResponse = result;
          try {
            const resultObj = JSON.parse(result);
            if (resultObj.success && resultObj.b64_json) {
              // Upload base64 image to Cloudinary
              console.log(
                "[STREAM] Uploading generated image to Cloudinary..."
              );
              let imageUrl = null;
              let imagePublicId = null;
              try {
                const imageBuffer = Buffer.from(resultObj.b64_json, "base64");
                const uploadResult = await uploadToCloudinary(
                  imageBuffer,
                  "perplex/generated-images",
                  "image"
                );
                imageUrl = uploadResult.secure_url;
                imagePublicId = uploadResult.public_id;
                console.log(
                  "[STREAM] ✓ Generated image uploaded to Cloudinary:",
                  imageUrl
                );
              } catch (uploadError) {
                console.error(
                  "[STREAM] ⚠️ Failed to upload generated image to Cloudinary:",
                  uploadError.message
                );
                // Fall back to base64 if upload fails
              }

              generatedImages.push({
                url: imageUrl,
                revised_prompt: resultObj.revised_prompt,
                publicId: imagePublicId,
              });
              // Send image event with URL instead of base64
              res.write(
                `data: ${JSON.stringify({
                  type: "image",
                  url: imageUrl,
                  revised_prompt: resultObj.revised_prompt,
                  timestamp: new Date().toISOString(),
                })}\n\n`
              );
              if (typeof res.flush === "function") res.flush();

              toolResponse = JSON.stringify({
                success: true,
                message: "Image generated successfully and sent to the user.",
                revised_prompt: resultObj.revised_prompt,
                image_delivered: true,
                image_url: imageUrl,
              });
            }
          } catch (_) {}

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toolResponse,
          });
        } else {
          // Handle other tools (like web_search if it returns a tool call)
          // For native web_search, we might just acknowledge it
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "Tool executed successfully.",
          });
        }
      }

      // Start second stream for final response
      console.log("[STREAM] Starting second stream after tools...");
      const secondStream = await openai.chat.completions.create({
        model,
        messages,
        stream: true,
        tools,
        tool_choice: "none",
      });

      for await (const chunk of secondStream) {
        // Check if stream was aborted
        if (isAborted || abortController.signal.aborted) {
          console.log("[STREAM] Second stream aborted by user");
          finishReason = "stopped";
          break;
        }
        await processChunk(chunk);
      }
    }

    // Send done event
    console.log(`[STREAM] ✓ Stream completed. Length: ${fullResponse.length}`);
    res.write(
      `data: ${JSON.stringify({
        type: "done",
        finish_reason: finishReason,
        full_response: fullResponse,
        generated_images:
          generatedImages.length > 0 ? generatedImages : undefined,
        timestamp: new Date().toISOString(),
      })}\n\n`
    );
    if (typeof res.flush === "function") res.flush();

    // Clean up stream from active streams and close connection immediately
    cleanupStream();
    const totalDuration = Date.now() - requestStartTime;

    // Log timing summary
    console.log("[STREAM] ⏱️ === TIMING SUMMARY ===");
    console.log(`[STREAM] ⏱️ Input parsing: ${timings.parseInput || 0}ms`);
    console.log(`[STREAM] ⏱️ Database ops: ${timings.database || 0}ms`);
    console.log(`[STREAM] ⏱️ OpenAI connect: ${timings.openaiConnect || 0}ms`);
    console.log(
      `[STREAM] ⏱️ Time to first chunk: ${timings.firstChunk || 0}ms`
    );
    console.log(`[STREAM] ⏱️ Total duration: ${totalDuration}ms`);
    console.log("[STREAM] ⏱️ ======================");

    console.log("[STREAM] Closing stream connection");
    console.log(
      "[STREAM] Final response length:",
      fullResponse.length,
      "characters"
    );
    res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
    if (typeof res.flush === "function") res.flush();
    res.end();
    console.log("========== [STREAM] Request Completed ==========\n");

    // Save messages to database asynchronously (fire-and-forget)
    // This runs after the response is sent to the client
    (async () => {
      console.log("[STREAM-BG] Saving messages to database...");
      try {
        // Upload files to Cloudinary if present
        let imageUrl = null;
        let imagePublicId = null;
        if (imageFile) {
          console.log("[STREAM-BG] Uploading image to Cloudinary...");
          try {
            const result = await uploadToCloudinary(
              imageFile.buffer,
              "perplex/images",
              "image"
            );
            imageUrl = result.secure_url;
            imagePublicId = result.public_id;
            console.log("[STREAM-BG] ✓ Image uploaded:", imageUrl);
          } catch (uploadError) {
            console.error(
              "[STREAM-BG] ❌ Image upload failed:",
              uploadError.message
            );
          }
        }

        let documentUrl = null;
        let documentPublicId = null;
        if (documentFile) {
          console.log("[STREAM-BG] Uploading document to Cloudinary...");
          try {
            const result = await uploadToCloudinary(
              documentFile.buffer,
              "perplex/documents",
              "auto"
            );
            documentUrl = result.secure_url;
            documentPublicId = result.public_id;
            console.log("[STREAM-BG] ✓ Document uploaded:", documentUrl);
          } catch (uploadError) {
            console.error(
              "[STREAM-BG] ❌ Document upload failed:",
              uploadError.message
            );
          }
        }

        // Save user message
        console.log("[STREAM-BG] Saving user message...");
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
        console.log("[STREAM-BG] ✓ User message saved");

        // Save assistant response
        console.log("[STREAM-BG] Saving assistant response...");
        await Conversation.addMessage(conversation.id, {
          role: "assistant",
          content: fullResponse,
          metadata: {
            model,
            responseLength: fullResponse.length,
            generatedImages:
              generatedImages.length > 0
                ? generatedImages.map((img) => ({
                    url: img.url || undefined,
                    publicId: img.publicId || undefined,
                    revised_prompt: img.revised_prompt,
                  }))
                : undefined,
          },
        });
        console.log("[STREAM-BG] ✓ Assistant response saved");

        // Auto-generate title if this is the first message
        if (!conversationId) {
          console.log("[STREAM-BG] Auto-generating conversation title...");
          await Conversation.autoGenerateTitle(conversation.id);
          console.log("[STREAM-BG] ✓ Conversation title generated");
        }
        console.log(
          "[STREAM-BG] ✓ All database operations completed successfully"
        );
      } catch (dbError) {
        console.error("[STREAM-BG] ❌ Error saving to database:", dbError);
        console.error("[STREAM-BG] Database error details:", {
          message: dbError.message,
          stack: dbError.stack,
        });
      }

      // Save to user's search history
      try {
        console.log("[STREAM-BG] Saving to user search history...");
        const historyEntry =
          prompt ||
          (documentFile
            ? `[document: ${documentMetadata?.filename || "uploaded"}]`
            : "[image]");
        await User.addToSearchHistory(req.user.id, historyEntry);
        console.log("[STREAM-BG] ✓ Search history updated");
      } catch (historyError) {
        console.error(
          "[STREAM-BG] ⚠️ Failed to save search history:",
          historyError.message
        );
      }
    })();
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
      })}\n\n`
    );
    // ensure heartbeat is cleared if set
    try {
      clearInterval(heartbeat);
    } catch (_) {}
    res.end();
    console.log("========== [STREAM] Request Failed ==========\n");
  }
});

// @route   POST /api/chat/stop
// @desc    Stop an ongoing stream response
// @access  Private
router.post("/stop", auth, async (req, res) => {
  try {
    const { streamId } = req.body;

    console.log("[STOP] Stop request received for streamId:", streamId);

    if (!streamId) {
      return res.status(400).json({
        success: false,
        message: "streamId is required",
      });
    }

    // Find the active stream
    const streamInfo = activeStreams.get(streamId);

    if (!streamInfo) {
      console.log("[STOP] Stream not found:", streamId);
      return res.status(404).json({
        success: false,
        message: "Stream not found or already completed",
      });
    }

    // Verify the user owns this stream
    if (streamInfo.userId !== req.user.id) {
      console.log("[STOP] Unauthorized access attempt for stream:", streamId);
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Abort the stream
    console.log("[STOP] Aborting stream:", streamId);
    streamInfo.abortController.abort();

    // Get the partial response before cleanup
    const partialResponse = streamInfo.getFullResponse();
    const conversationId = streamInfo.conversationId;

    // Clean up
    activeStreams.delete(streamId);

    console.log(
      "[STOP] Stream stopped successfully. Partial response length:",
      partialResponse?.length || 0
    );

    res.json({
      success: true,
      message: "Stream stopped successfully",
      data: {
        streamId,
        conversationId,
        partialResponseLength: partialResponse?.length || 0,
        stoppedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[STOP] Error stopping stream:", error);
    res.status(500).json({
      success: false,
      message: "Failed to stop stream",
      error: error.message,
    });
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
      model = thinkMode ? "gpt-5.2-2025-12-11" : "gpt-5-nano-2025-08-07",
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

    // Always use gpt-5-nano by default
    const model = thinkMode ? "gpt-5.2-2025-12-11" : "gpt-5-nano-2025-08-07";
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

    // Upload image to Cloudinary if present
    let imageUrl = null;
    let imagePublicId = null;
    if (imageFile) {
      console.log("[ASK] Uploading image to Cloudinary...");
      try {
        const result = await uploadToCloudinary(
          imageFile.buffer,
          "perplex/images",
          "image"
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

    // Step 2: Get AI response using gpt-5-nano
    const chatModel = thinkMode ? "gpt-5.2" : "gpt-5-nano-2025-08-07";
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
      text ? text.substring(0, 100) + (text.length > 100 ? "..." : "") : "N/A"
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
        response_format
      );
      return res.status(400).json({
        success: false,
        message: `Invalid response format. Valid options: ${validFormats.join(
          ", "
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
          (instructions.length > 100 ? "..." : "")
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
      "Failed to convert text to speech"
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
          ", "
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
        "Failed to stream text to speech"
      );
      return res.status(status).json(body);
    }

    // If streaming already started, end the response
    res.end();
  }
});

// ============================================
// Chat Sharing Endpoints
// ============================================

// @route   POST /api/chat/share
// @desc    Create a shareable link for a conversation
// @access  Private
router.post("/share", auth, async (req, res) => {
  try {
    const { conversationId } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "conversationId is required",
      });
    }

    // Check if conversation exists and user owns it
    const conversation = await Conversation.findById(conversationId, {
      includeMessages: false,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    if (conversation.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only share your own conversations.",
      });
    }

    // Check if conversation is already shared
    const existingShare = await prisma.sharedConversation.findFirst({
      where: { conversationId },
    });

    if (existingShare) {
      // Return existing share link
      const baseUrl = process.env.FRONTEND_URL || "https://eruditeaic.com";
      return res.json({
        success: true,
        data: {
          shareId: existingShare.shareId,
          shareUrl: `${baseUrl}/shared/${existingShare.shareId}`,
        },
      });
    }

    // Generate unique share ID (8 characters)
    const shareId = nanoid(8);

    // Create share record
    await prisma.sharedConversation.create({
      data: {
        shareId,
        conversationId,
        sharedBy: req.user.id,
      },
    });

    const baseUrl = process.env.FRONTEND_URL || "https://eruditeaic.com";

    res.json({
      success: true,
      data: {
        shareId,
        shareUrl: `${baseUrl}/shared/${shareId}`,
      },
    });
  } catch (error) {
    console.error("Share conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to share conversation",
      error: error.message,
    });
  }
});

// @route   GET /api/chat/shared/:shareId
// @desc    Get a shared conversation (public access)
// @access  Public
router.get("/shared/:shareId", async (req, res) => {
  try {
    const { shareId } = req.params;

    // Look up the share record
    const sharedConversation = await prisma.sharedConversation.findUnique({
      where: { shareId },
      include: {
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!sharedConversation) {
      return res.status(404).json({
        success: false,
        message: "Shared conversation not found",
      });
    }

    // Format the response
    const { conversation, user, sharedAt } = sharedConversation;

    res.json({
      success: true,
      data: {
        id: conversation.id,
        shareId,
        title: conversation.title,
        messages: conversation.messages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          metadata: msg.metadata,
          createdAt: msg.createdAt,
        })),
        sharedBy: user.name,
        sharedAt,
        createdAt: conversation.createdAt,
      },
    });
  } catch (error) {
    console.error("Get shared conversation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch shared conversation",
      error: error.message,
    });
  }
});

module.exports = router;
