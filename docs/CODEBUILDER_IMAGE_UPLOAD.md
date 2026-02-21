# Code Builder with Image Upload

## Overview

The Code Builder API now supports image uploads! You can send UI mockups, design screenshots, or wireframes along with your prompt, and the AI will generate React code that matches the visual design.

## Features

- 📷 **Image Upload Support** - Send PNG, JPG, GIF, or WebP images
- 🎨 **Visual Analysis** - AI analyzes colors, layouts, typography, and spacing
- 🎯 **Accurate Recreation** - Generates code that matches the provided design
- 📁 **10MB Limit** - Supports images up to 10MB in size

---

## API Changes

### Endpoint: `POST /api/codebuilder/generate`

**Before (JSON only):**

```javascript
{
  "prompt": "Create a todo app",
  "projectName": "todo-app"
}
```

**Now (Multipart Form Data with optional image):**

```
Content-Type: multipart/form-data

Fields:
- prompt: "Create a todo app based on this design"
- projectName: "todo-app"
- image: [File] (optional)
```

### Endpoint: `POST /api/codebuilder/refine`

**Before (JSON only):**

```javascript
{
  "files": [...],
  "feedback": "Add dark mode"
}
```

**Now (Multipart Form Data with optional image):**

```
Content-Type: multipart/form-data

Fields:
- files: "[{...}]" (JSON string)
- feedback: "Make it look like this design"
- image: [File] (optional)
```

---

## Usage Examples

### JavaScript/Fetch (Browser)

#### Generate Code with Image

```javascript
const generateWithImage = async (prompt, imageFile) => {
  const formData = new FormData();
  formData.append("prompt", prompt);
  formData.append("projectName", "my-app");

  if (imageFile) {
    formData.append("image", imageFile); // File from <input type="file">
  }

  const response = await fetch(
    "http://localhost:3000/api/codebuilder/generate",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        // Don't set Content-Type - browser will set it with boundary
      },
      body: formData,
    },
  );

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
          console.log(data.content);
        } else if (data.type === "complete") {
          console.log("Files:", data.files);
        }
      }
    }
  }
};

// Usage
const fileInput = document.querySelector('input[type="file"]');
const imageFile = fileInput.files[0];
await generateWithImage("Recreate this UI", imageFile);
```

#### Refine Code with Image

```javascript
const refineWithImage = async (files, feedback, imageFile) => {
  const formData = new FormData();
  formData.append("files", JSON.stringify(files)); // Must stringify
  formData.append("feedback", feedback);

  if (imageFile) {
    formData.append("image", imageFile);
  }

  const response = await fetch("http://localhost:3000/api/codebuilder/refine", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  // Handle streaming response same as above
};
```

---

### React Component Example

```jsx
import React, { useState } from "react";

function CodeBuilderWithImage() {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState(null);
  const [files, setFiles] = useState([]);
  const [streaming, setStreaming] = useState("");

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith("image/")) {
      setImage(file);
    } else {
      alert("Please select an image file");
    }
  };

  const generateCode = async () => {
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("projectName", "my-app");

    if (image) {
      formData.append("image", image);
    }

    const response = await fetch("/api/codebuilder/generate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
      body: formData,
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
      <h2>Generate React Code from Design</h2>

      <div>
        <label>Upload Design/Mockup (Optional):</label>
        <input type="file" accept="image/*" onChange={handleImageChange} />
        {image && (
          <div>
            <p>Selected: {image.name}</p>
            <img
              src={URL.createObjectURL(image)}
              alt="Preview"
              style={{ maxWidth: "300px", marginTop: "10px" }}
            />
          </div>
        )}
      </div>

      <div>
        <label>Describe what you want:</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Recreate this design as a React component..."
        />
      </div>

      <button onClick={generateCode}>Generate Code</button>

      {streaming && <pre>{streaming}</pre>}

      {files.map((file, i) => (
        <div key={i}>
          <h4>{file.path}</h4>
          <pre>{file.content}</pre>
        </div>
      ))}
    </div>
  );
}

export default CodeBuilderWithImage;
```

---

### Node.js Example

```javascript
const fs = require("fs");
const FormData = require("form-data");
const fetch = require("node-fetch");

async function generateWithImage() {
  const formData = new FormData();
  formData.append("prompt", "Recreate this landing page design");
  formData.append("projectName", "landing-page");

  // Add image from file system
  const imageStream = fs.createReadStream("./design-mockup.png");
  formData.append("image", imageStream);

  const response = await fetch(
    "http://localhost:3000/api/codebuilder/generate",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...formData.getHeaders(),
      },
      body: formData,
    },
  );

  // Handle streaming response
  const reader = response.body;
  reader.on("data", (chunk) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (data.type === "chunk") {
          process.stdout.write(data.content);
        }
      }
    }
  });
}
```

---

### cURL Example

```bash
# Generate code with image
curl -X POST http://localhost:3000/api/codebuilder/generate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "prompt=Recreate this UI design" \
  -F "projectName=my-app" \
  -F "image=@/path/to/design.png"

# Refine code with image
curl -X POST http://localhost:3000/api/codebuilder/refine \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F 'files=[{"path":"src/App.jsx","content":"..."}]' \
  -F "feedback=Make it look like this design" \
  -F "image=@/path/to/new-design.png"
```

---

## Image Requirements

### Supported Formats

- ✅ PNG (.png)
- ✅ JPEG (.jpg, .jpeg)
- ✅ GIF (.gif)
- ✅ WebP (.webp)

### File Size

- Maximum: 10 MB
- Recommended: Under 5 MB for faster processing

### Image Quality

- Use **high-resolution** images for best results
- Clear screenshots or mockups work best
- AI analyzes with "high detail" mode for accurate recreation

---

## Best Practices

### 1. **Combine Text + Image**

```
Prompt: "Create a dashboard with the layout shown in the image"
Image: dashboard-mockup.png
```

### 2. **Be Specific**

```
Prompt: "Recreate this hero section with the exact colors, fonts, and spacing"
Image: hero-section.jpg
```

### 3. **Iterative Refinement**

```
Step 1: Generate with initial design
Step 2: Refine with updated mockup
Step 3: Refine again with detail screenshots
```

### 4. **Use for Complex UIs**

- Landing pages
- Dashboards
- Forms with custom styling
- Navigation bars
- Card layouts

---

## Example Prompts with Images

### Landing Page

```
Prompt: "Recreate this landing page with React. Include the hero section, features grid, and call-to-action button."
Image: landing-page-design.png
```

### Dashboard

```
Prompt: "Build a dashboard matching this design. Include sidebar navigation, stats cards, and chart placeholders."
Image: dashboard-mockup.png
```

### Form

```
Prompt: "Create a multi-step form with this exact styling and layout."
Image: form-design.png
```

### Component

```
Prompt: "Build a pricing card component that looks exactly like this."
Image: pricing-card.png
```

---

## Error Handling

### Invalid File Type

```json
{
  "success": false,
  "message": "Only image files are allowed"
}
```

### File Too Large

```json
{
  "success": false,
  "message": "File too large. Maximum size is 10MB"
}
```

### Missing Prompt

```json
{
  "success": false,
  "errors": [
    {
      "msg": "Prompt is required",
      "param": "prompt"
    }
  ]
}
```

---

## Tips for Best Results

1. **Clear Images**: Use high-quality screenshots, not photos of screens
2. **Single Component**: For complex designs, submit one section at a time
3. **Annotate**: Include text describing specific interactions or behaviors
4. **Color Codes**: Mention exact hex codes if critical: "#FF5733 for the CTA button"
5. **Responsive**: Mention if the image shows desktop/mobile: "This is the mobile view"

---

## Comparison

| Feature         | Without Image  | With Image        |
| --------------- | -------------- | ----------------- |
| Layout Accuracy | Basic/Generic  | High/Precise      |
| Color Matching  | N/A            | Exact             |
| Typography      | Default styles | Matched to design |
| Spacing         | Standard       | Per design        |
| Component Style | Generic        | Custom to mockup  |

---

## Frontend Integration Example

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Code Builder with Image</title>
  </head>
  <body>
    <h1>Generate React Code from Design</h1>

    <form id="codeBuilderForm">
      <div>
        <label>Design Image (Optional):</label>
        <input type="file" id="imageInput" accept="image/*" />
        <div id="imagePreview"></div>
      </div>

      <div>
        <label>Prompt:</label>
        <textarea
          id="promptInput"
          placeholder="Describe what to build..."
        ></textarea>
      </div>

      <button type="submit">Generate Code</button>
    </form>

    <div id="output"></div>

    <script>
      const form = document.getElementById("codeBuilderForm");
      const imageInput = document.getElementById("imageInput");
      const promptInput = document.getElementById("promptInput");
      const imagePreview = document.getElementById("imagePreview");
      const output = document.getElementById("output");

      // Show preview when image selected
      imageInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (e) => {
            imagePreview.innerHTML = `<img src="${e.target.result}" style="max-width: 300px;">`;
          };
          reader.readAsDataURL(file);
        }
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const formData = new FormData();
        formData.append("prompt", promptInput.value);
        formData.append("projectName", "my-app");

        const imageFile = imageInput.files[0];
        if (imageFile) {
          formData.append("image", imageFile);
        }

        const response = await fetch(
          "http://localhost:3000/api/codebuilder/generate",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: formData,
          },
        );

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
                output.textContent += data.content;
              } else if (data.type === "complete") {
                console.log("Generated files:", data.files);
              }
            }
          }
        }
      });
    </script>
  </body>
</html>
```

---

## Support

For questions or issues with image uploads, check:

- File format is supported (PNG, JPG, GIF, WebP)
- File size is under 10 MB
- Using multipart/form-data content type
- Image field name is "image"

---

**Happy Building! 🎨🚀**
