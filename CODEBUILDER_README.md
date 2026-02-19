# Code Builder Feature

## Overview

The Code Builder is a powerful feature that streams React code generation from OpenAI. It creates production-ready React components and applications based on natural language prompts.

## Features

- ✨ **Real-time Streaming**: Watch code being generated in real-time
- 🎯 **React-Focused**: Generates modern React code with hooks and best practices
- 📁 **Structured Output**: Returns properly organized files with correct paths
- 🔄 **Code Refinement**: Iterate and improve generated code with feedback
- 🚀 **Production-Ready**: Clean, well-commented, and maintainable code

## Quick Start

### 1. Ensure OpenAI API Key is Set

Make sure your `.env` file contains:

```
OPENAI_API_KEY=your_openai_api_key_here
```

### 2. Start the Server

```bash
npm start
# or
npm run dev
```

### 3. Test the API

#### Option A: Use the HTML Demo

Open `examples/codebuilderDemo.html` in your browser:

1. Enter your JWT authentication token
2. Describe what you want to build
3. Click "Generate Code"
4. Watch the code stream in real-time!

#### Option B: Use the Node.js Test Script

```bash
# Edit examples/test-codebuilder.js and add your JWT token
# Then run:
node examples/test-codebuilder.js
```

#### Option C: Use cURL

```bash
# Replace YOUR_TOKEN with your JWT token
curl -X POST http://localhost:3000/api/codebuilder/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "prompt": "Create a simple counter app",
    "projectName": "counter-app"
  }'
```

## API Endpoints

### POST `/api/codebuilder/generate`

Generate React code from a text prompt.

**Request:**

```json
{
  "prompt": "Create a todo app with add, delete, and complete features",
  "projectName": "todo-app"
}
```

**Response:** Server-Sent Events (SSE) stream

### POST `/api/codebuilder/refine`

Refine existing code based on feedback.

**Request:**

```json
{
  "files": [
    {
      "path": "src/App.jsx",
      "content": "import React from 'react'..."
    }
  ],
  "feedback": "Add dark mode support"
}
```

**Response:** Server-Sent Events (SSE) stream

## Example Usage

### JavaScript/Node.js

```javascript
const response = await fetch("http://localhost:3000/api/codebuilder/generate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    prompt: "Create a weather app",
    projectName: "weather-app",
  }),
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
        console.log(data.content); // Stream each piece
      } else if (data.type === "complete") {
        console.log("Files:", data.files); // All generated files
      } else if (data.type === "error") {
        console.error("Error:", data.message);
      }
    }
  }
}
```

### React Component

```jsx
import React, { useState } from "react";

function CodeBuilder() {
  const [files, setFiles] = useState([]);
  const [streaming, setStreaming] = useState("");

  const generateCode = async (prompt) => {
    const response = await fetch("/api/codebuilder/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
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
            setStreaming((prev) => prev + data.content);
          } else if (data.type === "complete") {
            setFiles(data.files);
          }
        }
      }
    }
  };

  return (
    <div>
      <button onClick={() => generateCode("Create a button component")}>
        Generate
      </button>
      <pre>{streaming}</pre>
      {files.map((file) => (
        <div key={file.path}>
          <h3>{file.path}</h3>
          <pre>{file.content}</pre>
        </div>
      ))}
    </div>
  );
}
```

## Example Prompts

### Simple Components

```
"Create a button component with primary, secondary, and danger variants"
"Build a card component with image, title, and description"
"Create a modal dialog with open/close functionality"
```

### Complete Apps

```
"Build a todo app with add, delete, and mark as complete features"
"Create a weather app that displays current temperature and conditions"
"Build a contact form with validation and success message"
```

### Advanced Features

```
"Create a kanban board with drag and drop functionality"
"Build a shopping cart with add to cart, remove, and total calculation"
"Create a multi-step form wizard with validation"
```

## Output Format

Generated code follows this structure:

```
===FILE: src/App.jsx===
import React, { useState } from 'react';
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
}
===END FILE===
```

The API parses this format and returns structured file objects:

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

## Generated File Types

- **jsx** - React JSX files
- **javascript** - Plain JavaScript files
- **css** - CSS stylesheets
- **scss** - SCSS stylesheets
- **json** - JSON configuration files
- **html** - HTML files
- **markdown** - Markdown documentation

## Best Practices

### Writing Good Prompts

✅ **Good:**

```
"Create a todo app with:
- Add new todos with a text input
- Mark todos as complete with a checkbox
- Delete todos with a button
- Display completed count"
```

❌ **Too Vague:**

```
"Make a todo app"
```

### Iterating with Refinement

1. Generate initial code
2. Review the output
3. Use `/refine` endpoint with specific feedback
4. Repeat until satisfied

Example refinement flow:

```
1. Generate: "Create a counter app"
2. Refine: "Add a reset button"
3. Refine: "Add dark mode styling"
4. Refine: "Add animation when count changes"
```

### Performance Tips

- Be specific in your prompts to reduce back-and-forth
- For large applications, generate in parts
- Use `/refine` for small changes instead of regenerating
- Set appropriate `max_tokens` if needed (default: 4000)

## Configuration

You can customize the Code Builder in [routes/codebuilder.js](routes/codebuilder.js):

```javascript
// Change the AI model
const stream = await openai.chat.completions.create({
  model: "gpt-4o", // Change to "gpt-4", "gpt-3.5-turbo", etc.
  // ...
});

// Adjust creativity
temperature: 0.7, // Lower = more focused, Higher = more creative

// Adjust response length
max_tokens: 4000, // Increase for larger applications
```

## Troubleshooting

### "No token provided"

Make sure you include the JWT token in the Authorization header:

```
Authorization: Bearer YOUR_TOKEN
```

### Streaming not working

Ensure your client properly handles Server-Sent Events (SSE). The response uses `Content-Type: text/event-stream`.

### Empty files array

If files aren't parsed correctly, check that the AI is using the proper file format with `===FILE:` markers.

### Timeout errors

Large applications may take longer to generate. Increase the timeout in the code builder route if needed (default: 120 seconds).

## Documentation

- **API Documentation**: [CODEBUILDER_API_DOCUMENTATION.md](../CODEBUILDER_API_DOCUMENTATION.md)
- **HTML Demo**: [examples/codebuilderDemo.html](examples/codebuilderDemo.html)
- **Node.js Test**: [examples/test-codebuilder.js](examples/test-codebuilder.js)

## Support

For issues or feature requests, please refer to the main project documentation.

---

**Happy Coding! 🚀**
