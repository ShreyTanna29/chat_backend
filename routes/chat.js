const express = require("express");
const OpenAI = require("openai");
const auth = require("../middleware/auth");
const User = require("../models/User");
const { body, validationResult } = require("express-validator");
const multer = require("multer");

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  body("temperature")
    .optional()
    .isFloat({ min: 0, max: 2 })
    .withMessage("Temperature must be between 0 and 2"),
  body("maxTokens")
    .optional()
    .isInt({ min: 1, max: 4000 })
    .withMessage("Max tokens must be between 1 and 4000"),
];

// @route   POST /api/chat/stream
// @desc    Stream chat response from GPT-5 (uses gpt-5-mini for image input)
// @access  Private
router.post("/stream", auth, upload.single("image"), async (req, res) => {
  try {
    const prompt = req.body.prompt;
    const imageFile = req.file;
    // Always use GPT-5 for text, gpt-5-mini for image
    let model = imageFile ? "gpt-5-mini" : "gpt-5";
    const temperature = 0.7;
    const maxTokens = 1000;

    if (!prompt && !imageFile) {
      return res.status(400).json({
        success: false,
        message: "Prompt or image is required",
      });
    }

    // Set up Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Cache-Control");

    // Send initial connection confirmation
    res.write(
      `data: ${JSON.stringify({
        type: "connected",
        message: "Stream started",
      })}\n\n`
    );

    // Build messages array
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful AI assistant. If an image is provided, analyze it and answer the user's question based on both the image and the prompt.",
      },
    ];
    if (imageFile) {
      const base64Image = imageFile.buffer.toString("base64");
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt || "What is in this image?" },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageFile.mimetype};base64,${base64Image}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    try {
      const stream = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });

      let fullResponse = "";
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
        }
        if (chunk.choices[0]?.finish_reason) {
          res.write(
            `data: ${JSON.stringify({
              type: "done",
              finish_reason: chunk.choices[0].finish_reason,
              full_response: fullResponse,
              timestamp: new Date().toISOString(),
            })}\n\n`
          );
          break;
        }
      }
      // Save to user's search history
      try {
        await User.addToSearchHistory(req.user.id, prompt || "[image]");
      } catch (historyError) {}
    } catch (openaiError) {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: "Failed to get response from AI service",
          error: openaiError.message,
          timestamp: new Date().toISOString(),
        })}\n\n`
      );
    }
    res.write(`data: ${JSON.stringify({ type: "close" })}\n\n`);
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
      model = "gpt-3.5-turbo",
      temperature = 0.7,
      maxTokens = 1000,
    } = req.body;

    // Create the chat completion
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant similar to Perplexity. Provide accurate, informative, and well-structured responses. When possible, break down complex topics into clear sections.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: temperature,
      max_tokens: maxTokens,
    });

    const response = completion.choices[0]?.message?.content || "";

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
        prompt: prompt,
        response: response,
        model: model,
        usage: completion.usage,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Chat error:", error);

    if (error.code === "insufficient_quota") {
      return res.status(402).json({
        success: false,
        message: "OpenAI API quota exceeded",
      });
    }

    if (error.code === "rate_limit_exceeded") {
      return res.status(429).json({
        success: false,
        message: "Rate limit exceeded. Please try again later.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to get AI response",
      error: error.message,
    });
  }
});

// @route   POST /api/chat/ask
// @desc    Ask a question with optional image (uses GPT-4 vision if image provided)
// @access  Private
router.post("/ask", auth, upload.single("image"), async (req, res) => {
  try {
    const { prompt } = req.body;
    const imageFile = req.file;
    if (!prompt && !imageFile) {
      return res.status(400).json({
        success: false,
        message: "Prompt or image is required",
      });
    }

    // Always use GPT-4 for this route
    const model = imageFile ? "gpt-4-vision-preview" : "gpt-5";
    const messages = [
      {
        role: "system",
        content:
          "You are a helpful AI assistant. If an image is provided, analyze it and answer the user's question based on both the image and the prompt.",
      },
    ];

    if (imageFile) {
      // Convert image buffer to base64
      const base64Image = imageFile.buffer.toString("base64");
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt || "What is in this image?" },
          {
            type: "image_url",
            image_url: {
              url: `data:${imageFile.mimetype};base64,${base64Image}`,
            },
          },
        ],
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "";

    // Save to user's search history
    try {
      await User.addToSearchHistory(req.user.id, prompt || "[image]");
    } catch (historyError) {
      // Ignore
    }

    res.json({
      success: true,
      data: {
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
    res.status(500).json({
      success: false,
      message: "Failed to get AI response",
      error: error.message,
    });
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
    const transcriptResp = await openai.audio.transcriptions.create({
      file: Readable.from(audioFile.buffer),
      model: "whisper-1",
      response_format: "text",
      language: "en",
    });
    const userText = transcriptResp.text || transcriptResp;

    // Step 2: Get AI response using GPT-5
    const aiResp = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful AI assistant. Respond in a conversational tone.",
        },
        { role: "user", content: userText },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });
    const aiText = aiResp.choices[0]?.message?.content || "";

    // Step 3: Synthesize AI response to voice using OpenAI TTS
    const ttsResp = await openai.audio.speech.create({
      model: "tts-1",
      input: aiText,
      voice: "alloy",
      response_format: "mp3",
    });

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
    res.status(500).json({
      success: false,
      message: "Failed to process voice chat",
      error: error.message,
    });
  }
});

module.exports = router;
