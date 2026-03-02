const express = require("express");
const OpenAI = require("openai");
const auth = require("../middleware/auth");
const { body, validationResult } = require("express-validator");
const multer = require("multer");
const prisma = require("../config/database");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Build helpers — replicate the frontend buildEmbedFiles / buildPackageJson
// logic so the server can run a real Vite production build.
// ---------------------------------------------------------------------------

const KNOWN_PACKAGE_VERSIONS = {
  "react-router-dom": "^6.26.0",
  "react-router": "^6.26.0",
  axios: "^1.7.7",
  "lucide-react": "^0.400.0",
  "framer-motion": "^11.5.0",
  zustand: "^5.0.0",
  "react-hook-form": "^7.53.0",
  zod: "^3.23.8",
  "date-fns": "^4.1.0",
  "@tanstack/react-query": "^5.59.0",
  clsx: "^2.1.1",
  "class-variance-authority": "^0.7.0",
  "tailwind-merge": "^2.5.0",
  tailwindcss: "^3.4.13",
  "@emotion/react": "^11.13.3",
  "@emotion/styled": "^11.13.0",
  "@mui/material": "^6.1.1",
  "styled-components": "^6.1.13",
  uuid: "^10.0.0",
  "react-icons": "^5.3.0",
  recharts: "^2.12.7",
  "chart.js": "^4.4.4",
  "react-chartjs-2": "^5.2.0",
  lodash: "^4.17.21",
  "lodash-es": "^4.17.21",
  immer: "^10.1.1",
};

const DEFAULT_TEMPLATE_FILES = {
  "src/App.jsx": `export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', textAlign: 'center', padding: '4rem 2rem' }}>
      <h1>Code Builder</h1>
    </div>
  );
}
`,
  "src/main.jsx": `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
`,
};

function buildPackageJson(files, projectName) {
  const aiPkgFile = files.find(
    (f) => f.path === "package.json" || f.path.endsWith("/package.json"),
  );
  if (aiPkgFile) {
    try {
      const parsed = JSON.parse(aiPkgFile.content);
      parsed.devDependencies = {
        "@vitejs/plugin-react": "^4.3.4",
        vite: "^5.4.10",
        ...parsed.devDependencies,
      };
      parsed.scripts = { dev: "vite", build: "vite build", ...parsed.scripts };
      return JSON.stringify(parsed, null, 2);
    } catch {
      // fall through
    }
  }

  const sourceFiles = files.filter((f) => /\.(jsx?|tsx?)$/.test(f.path));
  const detectedPackages = new Set();
  const importRe =
    /(?:import\s+(?:.+?\s+from\s+)?['"]|require\s*\(\s*['"])([^'"./][^'"]*)['"]/g;

  for (const f of sourceFiles) {
    let match;
    while ((match = importRe.exec(f.content)) !== null) {
      const pkg = match[1];
      const root = pkg.startsWith("@")
        ? pkg.split("/").slice(0, 2).join("/")
        : pkg.split("/")[0];
      if (root && !["react", "react-dom"].includes(root)) {
        detectedPackages.add(root);
      }
    }
  }

  const extraDeps = {};
  for (const pkg of detectedPackages) {
    extraDeps[pkg] = KNOWN_PACKAGE_VERSIONS[pkg] ?? "latest";
  }

  return JSON.stringify(
    {
      name: (projectName || "react-app").replace(/\s+/g, "-").toLowerCase(),
      version: "0.0.0",
      private: true,
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", ...extraDeps },
      devDependencies: { "@vitejs/plugin-react": "^4.3.4", vite: "^5.4.10" },
    },
    null,
    2,
  );
}

/** Build a complete file map (defaults + AI files + generated package.json). */
function buildAllFiles(files, projectName) {
  const allFiles = { ...DEFAULT_TEMPLATE_FILES };
  for (const f of files) {
    if (f.path === "package.json") continue;
    allFiles[f.path] = f.content;
  }
  allFiles["package.json"] = buildPackageJson(files, projectName);
  // Use relative base so assets resolve correctly when served from any URL prefix
  allFiles["vite.config.js"] = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './' });
`;
  return allFiles;
}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".ogg",
  ".mp3",
  ".pdf",
  ".zip",
]);

function readDistFiles(distDir, baseDir = distDir) {
  const result = {};
  const entries = fs.readdirSync(distDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(distDir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      Object.assign(result, readDistFiles(fullPath, baseDir));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      const binary = BINARY_EXTENSIONS.has(ext);
      result[relPath] = {
        content: binary
          ? fs.readFileSync(fullPath).toString("base64")
          : fs.readFileSync(fullPath, "utf-8"),
        binary,
      };
    }
  }
  return result;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Build the project in a temp directory and store the dist output in the DB.
 * Runs asynchronously in the background after the API has already responded.
 */
async function buildProjectInBackground(slug, files, name) {
  const buildDir = path.join(os.tmpdir(), "codebuilder-builds", slug);
  console.log(`[CODEBUILDER BUILD] Starting build for ${slug} in ${buildDir}`);

  try {
    // Write all source files
    const allFiles = buildAllFiles(files, name);
    for (const [filePath, content] of Object.entries(allFiles)) {
      const absPath = path.join(buildDir, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, "utf-8");
    }

    // Install dependencies
    console.log(`[CODEBUILDER BUILD] Running npm install for ${slug}`);
    await execAsync("npm install --prefer-offline", {
      cwd: buildDir,
      timeout: 180_000,
    });

    // Build
    console.log(`[CODEBUILDER BUILD] Running vite build for ${slug}`);
    await execAsync("npm run build", { cwd: buildDir, timeout: 120_000 });

    // Read dist output
    const distDir = path.join(buildDir, "dist");
    const distFiles = readDistFiles(distDir);
    console.log(
      `[CODEBUILDER BUILD] Build succeeded for ${slug} — ${Object.keys(distFiles).length} files`,
    );

    await prisma.codeProject.update({
      where: { slug },
      data: { distFiles, buildStatus: "ready" },
    });
  } catch (err) {
    console.error(`[CODEBUILDER BUILD] Build failed for ${slug}:`, err.message);
    await prisma.codeProject.update({
      where: { slug },
      data: {
        buildStatus: "failed",
        buildError: err.message || "Build failed",
      },
    });
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(buildDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

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
        stream_options: { include_usage: true },
      });

      // Track accumulated response
      let fullResponse = "";
      let usageData = null;

      // Stream the response
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";

        if (chunk.usage) {
          usageData = chunk.usage;
        }

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
              usage: usageData,
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
      .notEmpty()
      .withMessage("Files are required")
      .custom((value) => {
        // Accept either array (JSON) or string (multipart form data)
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) && parsed.length > 0;
          } catch {
            return false;
          }
        }
        return Array.isArray(value) && value.length > 0;
      })
      .withMessage("Files must be a valid non-empty array"),
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
8. When asked to explain, only explain and do not generate code.

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
        stream_options: { include_usage: true },
      });

      let fullResponse = "";
      let usageData = null;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";

        if (chunk.usage) {
          usageData = chunk.usage;
        }

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
              usage: usageData,
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

/**
 * POST /api/codebuilder/projects
 * Publish (save) a generated project so it can be previewed at /preview/:slug
 */
router.post(
  "/projects",
  auth,
  [
    body("name").optional().trim().isLength({ max: 100 }),
    body("files")
      .isArray({ min: 1 })
      .withMessage("files must be a non-empty array"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name = "react-app", files } = req.body;

    // Build a URL-safe slug: sanitised name + 6 random hex chars for uniqueness
    const safeName =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .substring(0, 50) || "react-app";
    const suffix = crypto.randomBytes(3).toString("hex");
    const slug = `${safeName}-${suffix}`;

    try {
      // Create the project record immediately with buildStatus "building"
      const project = await prisma.codeProject.create({
        data: {
          slug,
          name,
          userId: req.user.id,
          files,
          buildStatus: "building",
        },
      });

      // Respond immediately so the client can open the preview URL right away
      res.json({ success: true, slug: project.slug });

      // Kick off the Vite build in the background (don't await)
      buildProjectInBackground(slug, files, name).catch((err) => {
        console.error("[CODEBUILDER] Unexpected build error for", slug, err);
      });
    } catch (err) {
      console.error("[CODEBUILDER] Publish error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to publish project" });
    }
  },
);

/**
 * GET /api/codebuilder/projects/:slug
 * Fetch a published project by slug — public, no auth required
 */
router.get("/projects/:slug", async (req, res) => {
  try {
    const project = await prisma.codeProject.findUnique({
      where: { slug: req.params.slug },
      select: {
        slug: true,
        name: true,
        files: true,
        buildStatus: true,
        buildError: true,
        createdAt: true,
      },
    });
    if (!project) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }
    res.json({ success: true, project });
  } catch (err) {
    console.error("[CODEBUILDER] Fetch project error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch project" });
  }
});

/**
 * GET /api/codebuilder/projects/:slug/dist/*
 * Serve the pre-built static files for a deployed project.
 * Falls back to index.html so client-side SPA routing still works.
 */
router.use("/projects/:slug/dist", async (req, res) => {
  try {
    const project = await prisma.codeProject.findUnique({
      where: { slug: req.params.slug },
      select: { buildStatus: true, distFiles: true },
    });

    if (!project) {
      return res.status(404).send("Project not found");
    }

    if (project.buildStatus !== "ready" || !project.distFiles) {
      const status = project.buildStatus;
      return res
        .status(503)
        .send(
          status === "building"
            ? "Build in progress — please wait."
            : status === "failed"
              ? "Build failed."
              : "Project not yet built.",
        );
    }

    // req.path inside router.use is the remainder after the prefix
    let filePath = req.path.replace(/^\//, "") || "index.html";
    if (filePath.endsWith("/")) filePath += "index.html";

    const distFiles = project.distFiles;
    let fileEntry = distFiles[filePath];

    // SPA fallback: serve index.html for unknown paths
    if (!fileEntry) {
      fileEntry = distFiles["index.html"];
      if (!fileEntry) return res.status(404).send("File not found");
      filePath = "index.html";
    }

    const mimeType = getMimeType(filePath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    if (fileEntry.binary) {
      res.send(Buffer.from(fileEntry.content, "base64"));
    } else {
      res.send(fileEntry.content);
    }
  } catch (err) {
    console.error("[CODEBUILDER] Serve dist error:", err);
    res.status(500).send("Internal server error");
  }
});

module.exports = router;
