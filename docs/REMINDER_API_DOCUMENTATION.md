# Reminder API Documentation

## Overview

The Reminder API allows users to create scheduled reminders that automatically generate AI responses at specified times. Users can create reminders using natural language (e.g., "give updates on the stock market daily at 5PM") or custom cron expressions.

## Features

- **Natural Language Processing**: Create reminders using plain English
- **Flexible Scheduling**: Support for daily, weekly, monthly, or custom schedules
- **AI-Powered Responses**: Automatic AI-generated content based on your prompt
- **Timezone Support**: Set reminders in any timezone
- **Conversation Integration**: Reminder responses are saved as conversations
- **Easy Management**: Enable, disable, update, or delete reminders

## Authentication

All reminder endpoints require authentication. Include the JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Create Reminder (Natural Language)

Create a reminder using natural language input.

**Endpoint:** `POST /api/reminders`

**Request Body:**

```json
{
  "prompt": "give updates on the stock market daily at 5PM",
  "timezone": "America/New_York"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Reminder created successfully",
  "data": {
    "reminder": {
      "id": "clxx1234567890",
      "title": "Daily Stock Updates",
      "prompt": "give updates on the stock market daily at 5PM",
      "schedule": "0 17 * * *",
      "frequency": "Every day at 5PM",
      "timezone": "America/New_York",
      "isActive": true,
      "createdAt": "2025-01-28T10:30:00.000Z"
    }
  }
}
```

**Example Prompts:**

- "give updates on the stock market daily at 5PM"
- "remind me to exercise every morning at 7AM"
- "send me tech news every weekday at 9AM"
- "weekly summary of crypto prices every Sunday at 6PM"
- "motivational quote every day at 8AM"
- "weather forecast every morning at 6AM"

---

### 2. Create Custom Reminder

Create a reminder with a custom cron expression for advanced scheduling.

**Endpoint:** `POST /api/reminders/custom`

**Request Body:**

```json
{
  "title": "Hourly Market Check",
  "aiPrompt": "Provide a brief update on major stock indices",
  "schedule": "0 * * * *",
  "timezone": "UTC",
  "prompt": "Check market every hour"
}
```

**Cron Expression Format:**

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-6, Sunday=0)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Common Cron Examples:**

- `0 17 * * *` - Every day at 5PM
- `0 9 * * 1-5` - Every weekday at 9AM
- `*/30 * * * *` - Every 30 minutes
- `0 */6 * * *` - Every 6 hours
- `0 12 * * 0` - Every Sunday at noon
- `0 8 1 * *` - First day of every month at 8AM

**Response:**

```json
{
  "success": true,
  "message": "Custom reminder created successfully",
  "data": {
    "reminder": {
      "id": "clxx1234567891",
      "title": "Hourly Market Check",
      "aiPrompt": "Provide a brief update on major stock indices",
      "schedule": "0 * * * *",
      "timezone": "UTC",
      "isActive": true
    }
  }
}
```

---

### 3. Get All Reminders

Retrieve all reminders for the authenticated user.

**Endpoint:** `GET /api/reminders`

**Query Parameters:**

- `active` (optional): Set to `true` to only get active reminders

**Examples:**

- `GET /api/reminders` - Get all reminders
- `GET /api/reminders?active=true` - Get only active reminders

**Response:**

```json
{
  "success": true,
  "data": {
    "reminders": [
      {
        "id": "clxx1234567890",
        "title": "Daily Stock Updates",
        "prompt": "give updates on the stock market daily at 5PM",
        "aiPrompt": "Provide a comprehensive update...",
        "schedule": "0 17 * * *",
        "timezone": "America/New_York",
        "isActive": true,
        "lastRun": "2025-01-27T17:00:00.000Z",
        "nextRun": "2025-01-28T17:00:00.000Z",
        "createdAt": "2025-01-20T10:00:00.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### 4. Get Single Reminder

Retrieve details of a specific reminder.

**Endpoint:** `GET /api/reminders/:id`

**Response:**

```json
{
  "success": true,
  "data": {
    "reminder": {
      "id": "clxx1234567890",
      "title": "Daily Stock Updates",
      "prompt": "give updates on the stock market daily at 5PM",
      "schedule": "0 17 * * *",
      "isActive": true
    }
  }
}
```

---

### 5. Update Reminder

Update an existing reminder.

**Endpoint:** `PUT /api/reminders/:id`

**Request Body:**

```json
{
  "title": "Updated Title",
  "schedule": "0 18 * * *",
  "isActive": false
}
```

**Updatable Fields:**

- `title` - Reminder title
- `prompt` - Original user prompt
- `aiPrompt` - AI execution prompt
- `schedule` - Cron expression
- `timezone` - Timezone string
- `isActive` - Boolean
- `metadata` - JSON object

**Response:**

```json
{
  "success": true,
  "message": "Reminder updated successfully",
  "data": {
    "reminder": {
      "id": "clxx1234567890",
      "title": "Updated Title",
      "schedule": "0 18 * * *",
      "isActive": false
    }
  }
}
```

---

### 6. Toggle Reminder Status

Quickly activate or deactivate a reminder.

**Endpoint:** `PATCH /api/reminders/:id/toggle`

**Response:**

```json
{
  "success": true,
  "message": "Reminder deactivated successfully",
  "data": {
    "reminder": {
      "id": "clxx1234567890",
      "isActive": false
    }
  }
}
```

---

### 7. Delete Reminder

Permanently delete a reminder.

**Endpoint:** `DELETE /api/reminders/:id`

**Response:**

```json
{
  "success": true,
  "message": "Reminder deleted successfully"
}
```

---

### 8. Get Scheduler Stats

Get statistics about the reminder scheduler (for debugging).

**Endpoint:** `GET /api/reminders/system/stats`

**Response:**

```json
{
  "success": true,
  "data": {
    "activeJobs": 5,
    "jobs": ["clxx1234567890", "clxx1234567891", ...]
  }
}
```

---

### 9. Refresh Scheduler

Manually reload all reminders and reschedule them.

**Endpoint:** `POST /api/reminders/system/refresh`

**Response:**

```json
{
  "success": true,
  "message": "Scheduler refreshed successfully"
}
```

---

## How It Works

### 1. Creating a Reminder

When you create a reminder:

1. Your natural language prompt is sent to AI for parsing
2. AI extracts the schedule, title, and creates an execution prompt
3. The reminder is stored in the database
4. A cron job is scheduled based on the extracted schedule

### 2. Reminder Execution

When a reminder triggers:

1. The scheduler executes the reminder at the scheduled time
2. AI generates a response based on the `aiPrompt`
3. A new conversation is created with the reminder response
4. The conversation appears in your chat history with a 🔔 icon
5. `lastRun` and `nextRun` times are updated

### 3. Conversation Format

Each reminder execution creates a conversation with:

- **Title**: `🔔 [Reminder Title]`
- **User Message**: Your original prompt
- **Assistant Message**: AI-generated response
- **Metadata**: Includes `isReminder: true` and `reminderId`

---

## Use Cases

### 1. Daily Stock Market Updates

```json
{
  "prompt": "give updates on the stock market daily at 5PM",
  "timezone": "America/New_York"
}
```

### 2. Weekly News Digest

```json
{
  "prompt": "send me a summary of tech news every Monday at 9AM",
  "timezone": "UTC"
}
```

### 3. Hourly Crypto Prices

```json
{
  "title": "Crypto Price Check",
  "aiPrompt": "Provide current Bitcoin and Ethereum prices with 24h change",
  "schedule": "0 * * * *",
  "timezone": "UTC"
}
```

### 4. Daily Motivation

```json
{
  "prompt": "send me a motivational quote every morning at 7AM",
  "timezone": "America/Los_Angeles"
}
```

### 5. Weather Updates

```json
{
  "prompt": "give me weather forecast for New York every day at 6AM",
  "timezone": "America/New_York"
}
```

### 6. Exercise Reminders

```json
{
  "prompt": "remind me to exercise every weekday at 6PM with workout suggestions",
  "timezone": "Europe/London"
}
```

---

## Timezone Support

Reminders support all standard timezone identifiers. Common examples:

- `UTC` - Coordinated Universal Time
- `America/New_York` - Eastern Time
- `America/Los_Angeles` - Pacific Time
- `Europe/London` - British Time
- `Asia/Tokyo` - Japan Standard Time
- `Australia/Sydney` - Australian Eastern Time

Full list: [IANA Time Zone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

---

## Error Handling

### Common Error Responses

**400 Bad Request - Invalid Input**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "msg": "Prompt must be between 10 and 500 characters",
      "param": "prompt"
    }
  ]
}
```

**401 Unauthorized**

```json
{
  "success": false,
  "message": "Authentication required"
}
```

**404 Not Found**

```json
{
  "success": false,
  "message": "Reminder not found"
}
```

**500 Server Error**

```json
{
  "success": false,
  "message": "Failed to create reminder"
}
```

---

## Best Practices

1. **Use Descriptive Prompts**: Be specific about what you want

   - ❌ "stock updates"
   - ✅ "give updates on the stock market daily at 5PM"

2. **Set Appropriate Timezones**: Always specify your timezone for accurate scheduling

3. **Avoid Too Frequent Reminders**: Be mindful of API costs

   - ✅ Hourly or daily reminders
   - ❌ Every minute reminders

4. **Deactivate Unused Reminders**: Toggle off reminders you're not using instead of deleting them

5. **Review Conversations**: Check the generated conversations to ensure quality

---

## Database Schema

```prisma
model Reminder {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id])
  title       String
  prompt      String    @db.Text
  aiPrompt    String    @db.Text
  schedule    String    // Cron expression
  timezone    String    @default("UTC")
  isActive    Boolean   @default(true)
  lastRun     DateTime?
  nextRun     DateTime?
  metadata    Json?     @default("{}")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

---

## Migration

To set up the reminder feature on an existing database:

```bash
npm run db:migrate
# or
npx prisma migrate dev --name add_reminders
```

---

## Dependencies

The reminder feature uses:

- `node-cron` - Cron job scheduling
- `OpenAI` - Natural language parsing and content generation
- `Prisma` - Database management

---

## Support

For issues or questions:

1. Check the error message in the response
2. Verify your cron expression syntax
3. Ensure your timezone is valid
4. Check that your API key has sufficient quota

---

## Examples

### Complete Example: Creating and Managing a Reminder

```javascript
// 1. Create a reminder
const createResponse = await fetch("/api/reminders", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_TOKEN",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "give updates on the stock market daily at 5PM",
    timezone: "America/New_York",
  }),
});

const { data } = await createResponse.json();
const reminderId = data.reminder.id;

// 2. Get all reminders
const listResponse = await fetch("/api/reminders", {
  headers: { Authorization: "Bearer YOUR_TOKEN" },
});

// 3. Toggle reminder
await fetch(`/api/reminders/${reminderId}/toggle`, {
  method: "PATCH",
  headers: { Authorization: "Bearer YOUR_TOKEN" },
});

// 4. Update reminder
await fetch(`/api/reminders/${reminderId}`, {
  method: "PUT",
  headers: {
    Authorization: "Bearer YOUR_TOKEN",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    schedule: "0 18 * * *", // Change to 6PM
  }),
});

// 5. Delete reminder
await fetch(`/api/reminders/${reminderId}`, {
  method: "DELETE",
  headers: { Authorization: "Bearer YOUR_TOKEN" },
});
```

---

## Limitations

- Maximum prompt length: 500 characters
- Minimum scheduling interval: 1 minute (though not recommended)
- Reminders are timezone-aware
- AI-generated responses are subject to OpenAI API limitations
- Each reminder execution counts toward your OpenAI API quota

---

## Future Enhancements

Potential future features:

- [ ] Email notifications for reminder executions
- [ ] Webhook support for external integrations
- [ ] Reminder templates
- [ ] Bulk reminder operations
- [ ] Reminder analytics and history
- [ ] Custom AI model selection per reminder
