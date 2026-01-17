# Spaces API Documentation

## Overview

Spaces allow users to organize conversations into separate workspaces. Each space can have its own default prompt/instructions that apply to all conversations within that space.

**Base URL:** `https://eruditeaic.com/api/chat`

**Authentication:** All endpoints require Bearer token authentication.

---

## Table of Contents

1. [List Spaces](#1-list-spaces)
2. [Create Space](#2-create-space)
3. [Get Single Space](#3-get-single-space)
4. [Update Space](#4-update-space)
5. [Delete Space](#5-delete-space)
6. [List Conversations in Space](#6-list-conversations-in-space)
7. [Create Conversation in Space](#7-create-conversation-in-space)

---

## 1. List Spaces

Get all spaces for the authenticated user with pagination.

### Endpoint

```
GET /api/chat/spaces
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### Query Parameters

| Parameter | Type    | Required | Default | Description    |
| --------- | ------- | -------- | ------- | -------------- |
| `page`    | integer | No       | 1       | Page number    |
| `limit`   | integer | No       | 20      | Items per page |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "spaces": [
      {
        "id": "clx1a2b3c4d5e6f7g8h9i0j1",
        "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
        "name": "Work Projects",
        "defaultPrompt": "You are a professional software development assistant.",
        "createdAt": "2025-01-10T10:30:00.000Z",
        "updatedAt": "2025-01-15T14:20:00.000Z",
        "_count": {
          "conversations": 5
        }
      },
      {
        "id": "clx2b3c4d5e6f7g8h9i0j1k2",
        "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
        "name": "Personal",
        "defaultPrompt": null,
        "createdAt": "2025-01-08T09:15:00.000Z",
        "updatedAt": "2025-01-14T16:45:00.000Z",
        "_count": {
          "conversations": 12
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "pages": 1
    }
  }
}
```

### Example Request

```javascript
const response = await fetch(
  "http://3.138.200.50:3000/api/chat/spaces?page=1&limit=20",
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
const data = await response.json();
```

---

## 2. Create Space

Create a new space for organizing conversations.

### Endpoint

```
POST /api/chat/spaces
```

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Request Body

```json
{
  "name": "Work Projects",
  "defaultPrompt": "You are a professional software development assistant. Always provide code examples and best practices."
}
```

| Field           | Type   | Required | Description                                           |
| --------------- | ------ | -------- | ----------------------------------------------------- |
| `name`          | string | Yes      | Space name (unique per user)                          |
| `defaultPrompt` | string | No       | Default system prompt for conversations in this space |

### Success Response (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
    "name": "Work Projects",
    "defaultPrompt": "You are a professional software development assistant. Always provide code examples and best practices.",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
}
```

### Error Responses

**400 Bad Request** - Missing name

```json
{
  "success": false,
  "message": "Name is required"
}
```

**409 Conflict** - Duplicate name

```json
{
  "success": false,
  "message": "A space with this name already exists"
}
```

### Example Request

```javascript
const response = await fetch("http://3.138.200.50:3000/api/chat/spaces", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Work Projects",
    defaultPrompt: "You are a professional software development assistant.",
  }),
});
const data = await response.json();
```

---

## 3. Get Single Space

Retrieve details of a specific space.

### Endpoint

```
GET /api/chat/spaces/:id
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### URL Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `id`      | string | Yes      | Space ID    |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
    "name": "Work Projects",
    "defaultPrompt": "You are a professional software development assistant.",
    "createdAt": "2025-01-10T10:30:00.000Z",
    "updatedAt": "2025-01-15T14:20:00.000Z"
  }
}
```

### Error Responses

**404 Not Found**

```json
{
  "success": false,
  "message": "Space not found"
}
```

**403 Forbidden** - Accessing another user's space

```json
{
  "success": false,
  "message": "Access denied"
}
```

### Example Request

```javascript
const spaceId = "clx1a2b3c4d5e6f7g8h9i0j1";
const response = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
const data = await response.json();
```

---

## 4. Update Space

Update space name or default prompt.

### Endpoint

```
PUT /api/chat/spaces/:id
```

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### URL Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `id`      | string | Yes      | Space ID    |

### Request Body

```json
{
  "name": "Updated Work Projects",
  "defaultPrompt": "You are an expert software architect."
}
```

| Field           | Type   | Required | Description                            |
| --------------- | ------ | -------- | -------------------------------------- |
| `name`          | string | No       | New space name                         |
| `defaultPrompt` | string | No       | New default prompt (or null to remove) |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "clx1a2b3c4d5e6f7g8h9i0j1",
    "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
    "name": "Updated Work Projects",
    "defaultPrompt": "You are an expert software architect.",
    "createdAt": "2025-01-10T10:30:00.000Z",
    "updatedAt": "2025-01-15T15:45:00.000Z"
  }
}
```

### Error Responses

**404 Not Found**

```json
{
  "success": false,
  "message": "Space not found"
}
```

**403 Forbidden**

```json
{
  "success": false,
  "message": "Access denied"
}
```

### Example Request

```javascript
const spaceId = "clx1a2b3c4d5e6f7g8h9i0j1";
const response = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Updated Work Projects",
      defaultPrompt: "You are an expert software architect.",
    }),
  }
);
const data = await response.json();
```

---

## 5. Delete Space

Delete a space. **Note:** Conversations within the space are retained but detached (their `spaceId` is set to null).

### Endpoint

```
DELETE /api/chat/spaces/:id
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### URL Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `id`      | string | Yes      | Space ID    |

### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Space deleted"
}
```

### Error Responses

**404 Not Found**

```json
{
  "success": false,
  "message": "Space not found"
}
```

**403 Forbidden**

```json
{
  "success": false,
  "message": "Access denied"
}
```

### Example Request

```javascript
const spaceId = "clx1a2b3c4d5e6f7g8h9i0j1";
const response = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
const data = await response.json();
```

---

## 6. List Conversations in Space

Get all conversations within a specific space.

### Endpoint

```
GET /api/chat/spaces/:id/conversations
```

### Headers

```
Authorization: Bearer <jwt_token>
```

### URL Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `id`      | string | Yes      | Space ID    |

### Query Parameters

| Parameter | Type    | Required | Default | Description    |
| --------- | ------- | -------- | ------- | -------------- |
| `page`    | integer | No       | 1       | Page number    |
| `limit`   | integer | No       | 20      | Items per page |

### Success Response (200 OK)

```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "clx3c4d5e6f7g8h9i0j1k2l3",
        "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
        "title": "API Design Discussion",
        "spaceId": "clx1a2b3c4d5e6f7g8h9i0j1",
        "createdAt": "2025-01-14T11:20:00.000Z",
        "updatedAt": "2025-01-15T09:30:00.000Z",
        "_count": {
          "messages": 8
        }
      },
      {
        "id": "clx4d5e6f7g8h9i0j1k2l3m4",
        "userId": "clx9z8y7x6w5v4u3t2s1r0q9",
        "title": "Database Schema Review",
        "spaceId": "clx1a2b3c4d5e6f7g8h9i0j1",
        "createdAt": "2025-01-13T14:15:00.000Z",
        "updatedAt": "2025-01-14T16:45:00.000Z",
        "_count": {
          "messages": 12
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "pages": 1
    }
  }
}
```

### Error Responses

**404 Not Found**

```json
{
  "success": false,
  "message": "Space not found"
}
```

**403 Forbidden**

```json
{
  "success": false,
  "message": "Access denied"
}
```

### Example Request

```javascript
const spaceId = "clx1a2b3c4d5e6f7g8h9i0j1";
const response = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}/conversations?page=1&limit=20`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
const data = await response.json();
```

---

## 7. Create Conversation in Space

When creating a new conversation or streaming chat, you can associate it with a space by including the `spaceId` parameter.

### Endpoint

```
POST /api/chat/stream
```

### Headers

```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Request Body

```json
{
  "prompt": "How do I implement authentication in Node.js?",
  "spaceId": "clx1a2b3c4d5e6f7g8h9i0j1",
  "thinkMode": false
}
```

| Field            | Type    | Required | Description                             |
| ---------------- | ------- | -------- | --------------------------------------- |
| `prompt`         | string  | Yes      | User message                            |
| `spaceId`        | string  | No       | Space ID to associate conversation with |
| `conversationId` | string  | No       | Existing conversation ID (to continue)  |
| `thinkMode`      | boolean | No       | Use GPT-5 for advanced reasoning        |

### Success Response

Stream of Server-Sent Events (SSE) with conversation details including the `spaceId`.

### Important Notes

- If a `spaceId` is provided when creating a conversation, that conversation will:
  - Be listed in the space's conversations
  - Use the space's default prompt if set (prepended to conversation)
  - Be accessible via the space's conversation list endpoint
- When deleting a space, conversations are retained but their `spaceId` is set to `null`
- You can also use `/api/chat/ask` endpoint with `spaceId` parameter

### Example Request

```javascript
const response = await fetch("http://3.138.200.50:3000/api/chat/stream", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "How do I implement authentication in Node.js?",
    spaceId: "clx1a2b3c4d5e6f7g8h9i0j1",
    thinkMode: false,
  }),
});

// Handle SSE stream
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  // Process SSE chunks
}
```

---

## Common Error Responses

### 401 Unauthorized

```json
{
  "success": false,
  "message": "Authentication required"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "message": "Failed to [action]",
  "error": "Error details here"
}
```

---

## Usage Flow Example

### 1. Create a Space for Work Projects

```javascript
// Create space
const createSpace = await fetch("http://3.138.200.50:3000/api/chat/spaces", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Work Projects",
    defaultPrompt: "You are a professional software development assistant.",
  }),
});
const { data: space } = await createSpace.json();
const spaceId = space.id;
```

### 2. Create Conversations in That Space

```javascript
// Start a conversation in the space
const chat = await fetch("http://3.138.200.50:3000/api/chat/stream", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "Help me design a REST API",
    spaceId: spaceId,
  }),
});
```

### 3. List All Conversations in the Space

```javascript
// Get conversations in space
const conversations = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}/conversations`,
  {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
const { data } = await conversations.json();
```

### 4. Update Space Details

```javascript
// Update space
const updateSpace = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Backend Development",
      defaultPrompt: "You are an expert backend developer.",
    }),
  }
);
```

### 5. Delete Space (Conversations are Retained)

```javascript
// Delete space
const deleteSpace = await fetch(
  `http://3.138.200.50:3000/api/chat/spaces/${spaceId}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  }
);
```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- Space names must be unique per user
- Deleting a space does NOT delete conversations - they are just detached
- Default prompts are optional but useful for maintaining consistent AI behavior within a space
- The `_count` field shows the number of related items (conversations, messages)
- Pagination is available on list endpoints for better performance
