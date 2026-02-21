const express = require("express");
const OpenAI = require("openai");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");
const multer = require("multer");

const router = express.Router();

// Initialize OpenAI client specifically for code generation
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 2,
});

// Set up multer for image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size for images
  },
  fileFilter: (req, file, cb) => {
    // Accept only images
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

/**
 * POST /api/codebuilder/generate
 * Stream React code from OpenAI in a structured file format
 * Accepts optional image/mockup for visual reference
 */
router.post(
  "/generate",
  auth,
  upload.single("image"), // Accept single image file
  [
    body("prompt")
      .notEmpty()
      .trim()
      .withMessage("Prompt is required")
      .isLength({ max: 5000 })
      .withMessage("Prompt must be less than 5000 characters"),
    body("projectName")
      .optional()
      .trim()
      .isLength({ max: 100 })
      .withMessage("Project name must be less than 100 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { prompt, projectName = "react-app" } = req.body;
    const imageFile = req.file || null; // Get uploaded image
    const userId = req.user.id;

    console.log(`[CODEBUILDER] User ${userId} requesting: ${prompt}`);
    if (imageFile) {
      console.log(`[CODEBUILDER] Image provided:`, {
        mimetype: imageFile.mimetype,
        size: imageFile.size,
        originalname: imageFile.originalname,
      });
    }

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // System prompt for React code generation
    const systemPrompt = `You are an expert React developer. Generate clean, modern React code following best practices. The site should be stunning, beautiful, responsive and user-friendly.

IMPORTANT RULES:
1. Only generate React code (JavaScript/JSX)
2. Use functional components with hooks
3. Follow modern React patterns (hooks, context, etc.)
4. Include proper imports and exports
5. Write clean, well-commented code
6. Use proper file structure
7. If an image/mockup is provided, analyze it carefully and recreate the UI as accurately as possible
8. Match colors, layouts, typography, and spacing from any provided design images

FILE FORMAT:
Output files in this exact format:

===FILE: path/to/file.jsx===
// File content here
===END FILE===

===FILE: path/to/another-file.js===
// Another file content
===END FILE===

Example:
===FILE: src/App.jsx===
import React from 'react';
import './App.css';

function App() {
  return (
    <div className="App">
      <h1>Hello World</h1>
    </div>
  );
}

export default App;
===END FILE===

===FILE: src/App.css===
.App {
  text-align: center;
  padding: 20px;
}
===END FILE===

Generate complete, production-ready React code. Each file should be self-contained and properly structured.`;

    try {
      // Build user message content
      const userMessageContent = [];

      // Add text prompt
      userMessageContent.push({
        type: "text",
        text: `Project: ${projectName}\n\nRequirement: ${prompt}\n\nGenerate the complete React application with all necessary files.`,
      });

      // Add image if provided
      if (imageFile) {
        console.log("[CODEBUILDER] Encoding image to base64...");
        const base64Image = imageFile.buffer.toString("base64");
        userMessageContent.push({
          type: "image_url",
          image_url: {
            url: `data:${imageFile.mimetype};base64,${base64Image}`,
            detail: "high", // Use high detail for better UI analysis
          },
        });
        console.log("[CODEBUILDER] ✓ Image added to request");
      }

      // Create streaming completion
      const stream = await openai.chat.completions.create({
        model: "gpt-5.2-2025-12-11",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessageContent,
          },
        ],
        stream: true,
      });

      // Track accumulated response
      let fullResponse = "";

      // Stream the response
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";

        if (content) {
          fullResponse += content;

          // Send chunk to client
          res.write(
            `data: ${JSON.stringify({
              type: "chunk",
              content: content,
            })}\n\n`,
          );
        }

        // Check if stream is done
        if (chunk.choices[0]?.finish_reason === "stop") {
          console.log(`[CODEBUILDER] Generation complete for user ${userId}`);

          // Parse files from response
          const files = parseFilesFromResponse(fullResponse);

          // Send completion with parsed files
          res.write(
            `data: ${JSON.stringify({
              type: "complete",
              files: files,
              totalFiles: files.length,
            })}\n\n`,
          );

          res.end();
          return;
        }
      }
    } catch (error) {
      console.error("[CODEBUILDER] Error:", error);

      // Send error to client
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: error.message || "Failed to generate code",
          code: error.code,
        })}\n\n`,
      );

      res.end();
    }
  },
);

/**
 * Parse files from the generated response
 * Expected format: ===FILE: path/to/file.jsx=== ... ===END FILE===
 */
function parseFilesFromResponse(response) {
  const files = [];
  const fileRegex = /===FILE:\s*(.+?)\s*===\n([\s\S]*?)===END FILE===/g;

  let match;
  while ((match = fileRegex.exec(response)) !== null) {
    const [, filePath, content] = match;
    files.push({
      path: filePath.trim(),
      content: content.trim(),
      type: getFileType(filePath),
    });
  }

  // If no files found in the expected format, treat entire response as single file
  if (files.length === 0 && response.trim()) {
    files.push({
      path: "src/App.jsx",
      content: response.trim(),
      type: "jsx",
    });
  }

  return files;
}

/**
 * Determine file type based on extension
 */
function getFileType(filePath) {
  const extension = filePath.split(".").pop().toLowerCase();
  const typeMap = {
    jsx: "jsx",
    js: "javascript",
    tsx: "tsx",
    ts: "typescript",
    css: "css",
    scss: "scss",
    json: "json",
    html: "html",
    md: "markdown",
  };
  return typeMap[extension] || "text";
}

/**
 * POST /api/codebuilder/refine
 * Refine existing code based on user feedback
 * Accepts optional image for visual reference
 */
router.post(
  "/refine",
  auth,
  upload.single("image"), // Accept single image file
  [
    body("files")
      .isArray()
      .withMessage("Files must be an array")
      .notEmpty()
      .withMessage("At least one file is required"),
    body("files.*.path").notEmpty().withMessage("File path is required"),
    body("files.*.content").notEmpty().withMessage("File content is required"),
    body("feedback")
      .notEmpty()
      .trim()
      .withMessage("Feedback is required")
      .isLength({ max: 2000 })
      .withMessage("Feedback must be less than 2000 characters"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    // Parse files if it's a JSON string (from multipart form data)
    let files;
    try {
      files =
        typeof req.body.files === "string"
          ? JSON.parse(req.body.files)
          : req.body.files;
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid files format. Must be a valid JSON array.",
      });
    }

    const { feedback } = req.body;
    const imageFile = req.file || null; // Get uploaded image
    const userId = req.user.id;

    console.log(`[CODEBUILDER] User ${userId} refining ${files.length} files`);
    if (imageFile) {
      console.log(`[CODEBUILDER] Image provided for refinement:`, {
        mimetype: imageFile.mimetype,
        size: imageFile.size,
        originalname: imageFile.originalname,
      });
    }

    // Set headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Build current code context
    let currentCode = "Current files:\n\n";
    files.forEach((file) => {
      currentCode += `===FILE: ${file.path}===\n${file.content}\n===END FILE===\n\n`;
    });

    const systemPrompt = `You are an expert React developer. Refine and improve the provided React code based on user feedback.

IMPORTANT RULES:
1. Only generate React code (JavaScript/JSX)
2. Maintain the existing file structure unless changes are needed
3. Follow modern React patterns and best practices
4. Keep imports and exports consistent
5. Apply the requested changes while preserving working functionality
6. If an image/mockup is provided, use it as reference for visual changes
7. Match colors, layouts, typography, and spacing from any provided design images

FILE FORMAT:
Output files in this exact format:

===FILE: path/to/file.jsx===
// Updated file content here
===END FILE===

Only include files that were modified. Unchanged files can be omitted.`;

    try {
      // Build user message content
      const userMessageContent = [];

      // Add current code and feedback as text
      userMessageContent.push({
        type: "text",
        text: `${currentCode}\n\nUser feedback: ${feedback}\n\nPlease update the code based on this feedback.`,
      });

      // Add image if provided
      if (imageFile) {
        console.log("[CODEBUILDER] Encoding image to base64 for refinement...");
        const base64Image = imageFile.buffer.toString("base64");
        userMessageContent.push({
          type: "image_url",
          image_url: {
            url: `data:${imageFile.mimetype};base64,${base64Image}`,
            detail: "high", // Use high detail for better UI analysis
          },
        });
        console.log("[CODEBUILDER] ✓ Image added to refinement request");
      }

      const stream = await openai.chat.completions.create({
        model: "gpt-5.2-2025-12-11",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userMessageContent,
          },
        ],
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
            })}\n\n`,
          );
        }

        if (chunk.choices[0]?.finish_reason === "stop") {
          console.log(`[CODEBUILDER] Refinement complete for user ${userId}`);

          const updatedFiles = parseFilesFromResponse(fullResponse);

          res.write(
            `data: ${JSON.stringify({
              type: "complete",
              files: updatedFiles,
              totalFiles: updatedFiles.length,
            })}\n\n`,
          );

          res.end();
          return;
        }
      }
    } catch (error) {
      console.error("[CODEBUILDER] Refine error:", error);

      res.write(
        `data: ${JSON.stringify({
          type: "error",
          message: error.message || "Failed to refine code",
          code: error.code,
        })}\n\n`,
      );

      res.end();
    }
  },
);

module.exports = router;
