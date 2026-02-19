# Code Builder API Documentation

## Overview

The Code Builder API streams React code from OpenAI in a structured file format. It creates a dedicated OpenAI connection and generates clean, production-ready React components.

## Base URL

```
/api/codebuilder
```

## Authentication

All endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

---

## Endpoints

### 1. Generate React Code (Streaming)

**Endpoint:** `POST /api/codebuilder/generate`

**Description:** Generate complete React applications based on a text prompt. The response streams in real-time and returns structured files.

**Request Body:**

```json
{
  "prompt": "Create a todo app with add, delete, and mark as complete features",
  "projectName": "todo-app" // Optional, defaults to "react-app"
}
```

**Request Parameters:**

- `prompt` (required): Description of what you want to build (max 5000 characters)
- `projectName` (optional): Name of the project (max 100 characters)

**Response Format (Server-Sent Events):**

The endpoint streams data using Server-Sent Events (SSE). Each event is sent as:

```
data: <JSON_OBJECT>
```

**Event Types:**

1. **Chunk Event** - Sent continuously as code is generated

```json
{
  "type": "chunk",
  "content": "import React from 'react';\n"
}
```

2. **Complete Event** - Sent when generation is finished

```json
{
  "type": "complete",
  "files": [
    {
      "path": "src/App.jsx",
      "content": "import React from 'react'...",
      "type": "jsx"
    },
    {
      "path": "src/App.css",
      "content": ".App { ... }",
      "type": "css"
    }
  ],
  "totalFiles": 2
}
```

3. **Error Event** - Sent if an error occurs

```json
{
  "type": "error",
  "message": "Failed to generate code",
  "code": "error_code"
}
```

**File Types:**

- `jsx` - React JSX files
- `javascript` - Plain JavaScript files
- `css` - CSS stylesheets
- `scss` - SCSS stylesheets
- `json` - JSON configuration files
- `html` - HTML files
- `markdown` - Markdown documentation
- `text` - Plain text files

**Example Usage (JavaScript):**

```javascript
const response = await fetch("http://localhost:3000/api/codebuilder/generate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    prompt: "Create a weather app that shows current weather",
    projectName: "weather-app",
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

let files = [];
let accumulatedCode = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split("\n");

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = JSON.parse(line.slice(6));

      if (data.type === "chunk") {
        accumulatedCode += data.content;
        console.log("Streaming:", data.content);
      } else if (data.type === "complete") {
        files = data.files;
        console.log("Generation complete!", files);
      } else if (data.type === "error") {
        console.error("Error:", data.message);
      }
    }
  }
}
```

---

### 2. Refine Existing Code (Streaming)

**Endpoint:** `POST /api/codebuilder/refine`

**Description:** Refine and improve existing React code based on user feedback. Streams the updated code in real-time.

**Request Body:**

```json
{
  "files": [
    {
      "path": "src/App.jsx",
      "content": "import React from 'react'..."
    },
    {
      "path": "src/components/TodoItem.jsx",
      "content": "import React from 'react'..."
    }
  ],
  "feedback": "Add dark mode support and improve accessibility"
}
```

**Request Parameters:**

- `files` (required): Array of file objects with `path` and `content`
- `feedback` (required): Description of desired changes (max 2000 characters)

**Response Format:**

Same as the `/generate` endpoint - uses Server-Sent Events with `chunk`, `complete`, and `error` event types.

**Note:** Only modified files are returned in the `complete` event. Unchanged files are omitted.

**Example Usage (JavaScript):**

```javascript
const response = await fetch("http://localhost:3000/api/codebuilder/refine", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    files: [
      {
        path: "src/App.jsx",
        content: existingAppCode,
      },
    ],
    feedback: "Add error handling and loading states",
  }),
});

// Handle streaming response (same as /generate)
```

---

## File Format

The AI generates files in a structured format:

```
===FILE: src/App.jsx===
import React, { useState } from 'react';
import './App.css';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="App">
      <h1>Count: {count}</h1>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}

export default App;
===END FILE===

===FILE: src/App.css===
.App {
  text-align: center;
  padding: 20px;
  font-family: Arial, sans-serif;
}

button {
  padding: 10px 20px;
  font-size: 16px;
  cursor: pointer;
}
===END FILE===
```

---

## Code Generation Rules

The AI follows these rules when generating React code:

1. **React Only** - Only generates React code (JavaScript/JSX)
2. **Functional Components** - Uses modern functional components with hooks
3. **Best Practices** - Follows React best practices and patterns
4. **Proper Structure** - Includes proper imports, exports, and file organization
5. **Clean Code** - Well-commented, readable, and maintainable
6. **Modern Patterns** - Uses hooks, context, and modern React features

---

## Example Prompts

**Simple Component:**

```json
{
  "prompt": "Create a button component with primary, secondary, and danger variants"
}
```

**Complete App:**

```json
{
  "prompt": "Build a contact form with name, email, and message fields. Include validation and a success message after submission."
}
```

**Complex Feature:**

```json
{
  "prompt": "Create a kanban board with drag and drop functionality. Include three columns: To Do, In Progress, and Done. Users should be able to add, edit, and delete tasks."
}
```

---

## Error Handling

**Validation Errors (400):**

```json
{
  "success": false,
  "errors": [
    {
      "msg": "Prompt is required",
      "param": "prompt",
      "location": "body"
    }
  ]
}
```

**Authentication Errors (401):**

```json
{
  "message": "No token provided"
}
```

**Server Errors (500):**
Sent as SSE error event:

```json
{
  "type": "error",
  "message": "Internal server error",
  "code": "internal_error"
}
```

---

## Rate Limits

The OpenAI API has rate limits. The code builder uses:

- **Model:** gpt-4o (GPT-4 Optimized)
- **Max Tokens:** 4000 per request
- **Timeout:** 120 seconds (2 minutes)
- **Retries:** 2 automatic retries

---

## Tips for Best Results

1. **Be Specific:** Provide detailed requirements in your prompt
2. **Break Down Complex Apps:** For large applications, generate in parts
3. **Use Refine:** Iterate on generated code using the `/refine` endpoint
4. **Include Details:** Mention styling preferences, functionality, and edge cases
5. **Test Incrementally:** Test generated components before requesting more

---

## Frontend Example (React)

```jsx
import React, { useState } from "react";

function CodeBuilder() {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [currentOutput, setCurrentOutput] = useState("");

  const generateCode = async () => {
    setStreaming(true);
    setCurrentOutput("");
    setFiles([]);

    try {
      const response = await fetch("/api/codebuilder/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ prompt }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.type === "chunk") {
              setCurrentOutput((prev) => prev + data.content);
            } else if (data.type === "complete") {
              setFiles(data.files);
              setStreaming(false);
            } else if (data.type === "error") {
              console.error("Error:", data.message);
              setStreaming(false);
            }
          }
        }
      }
    } catch (error) {
      console.error("Failed to generate code:", error);
      setStreaming(false);
    }
  };

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what you want to build..."
      />
      <button onClick={generateCode} disabled={streaming}>
        {streaming ? "Generating..." : "Generate Code"}
      </button>

      {currentOutput && (
        <div>
          <h3>Streaming Output:</h3>
          <pre>{currentOutput}</pre>
        </div>
      )}

      {files.length > 0 && (
        <div>
          <h3>Generated Files:</h3>
          {files.map((file, index) => (
            <div key={index}>
              <h4>{file.path}</h4>
              <pre>
                <code>{file.content}</code>
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CodeBuilder;
```

---

## Support

For issues or questions, refer to the main API documentation or contact the development team.
