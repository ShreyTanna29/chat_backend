const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Parse natural language reminder into structured data
 * Example: "give updates on the stock market daily at 5PM"
 * Returns: { title, aiPrompt, schedule, timezone }
 */
async function parseReminderPrompt(userPrompt, userTimezone = "UTC") {
  try {
    const systemPrompt = `You are a reminder parser. Parse the user's reminder request into a structured format.

Extract:
1. title: A short descriptive title (max 50 chars)
2. aiPrompt: The actual task/prompt to execute (what information to fetch/generate)
3. schedule: A cron expression for when to execute
4. frequency: A human-readable description of frequency

Cron format: minute hour day month dayOfWeek
Examples:
- "0 17 * * *" = Every day at 5PM (17:00)
- "0 9 * * 1-5" = Every weekday at 9AM
- "0 12 * * 0" = Every Sunday at noon
- "0 8 1 * *" = First day of every month at 8AM
- "*/30 * * * *" = Every 30 minutes
- "0 */6 * * *" = Every 6 hours
- "0 20 * * 6" = Every Saturday at 8PM

For the aiPrompt, convert the user's request into a clear instruction for an AI to execute.
Examples:
- "give updates on the stock market daily at 5PM" → "Provide a comprehensive update on today's stock market performance, including major indices, notable movers, and key market news."
- "remind me to exercise every morning" → "Send a motivational reminder to exercise with a quick workout suggestion."
- "send me tech news every weekday at 9am" → "Summarize the top 5 technology news stories from today."

Return ONLY a valid JSON object with these fields:
{
  "title": "string",
  "aiPrompt": "string",
  "schedule": "cron expression",
  "frequency": "human readable frequency"
}

User's timezone: ${userTimezone}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content.trim();

    // Try to extract JSON from the response
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from AI response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields
    if (!parsed.title || !parsed.aiPrompt || !parsed.schedule) {
      throw new Error("Missing required fields in parsed reminder");
    }

    // Validate cron expression (basic check)
    const cronParts = parsed.schedule.split(" ");
    if (cronParts.length !== 5) {
      throw new Error("Invalid cron expression format");
    }

    return {
      title: parsed.title.substring(0, 100), // Limit title length
      aiPrompt: parsed.aiPrompt,
      schedule: parsed.schedule,
      frequency: parsed.frequency || "Custom schedule",
    };
  } catch (error) {
    console.error("Error parsing reminder prompt:", error);
    throw new Error(`Failed to parse reminder: ${error.message}`);
  }
}

/**
 * Validate a cron expression
 */
function isValidCron(cronExpression) {
  const parts = cronExpression.split(" ");
  if (parts.length !== 5) return false;

  const ranges = {
    minute: [0, 59],
    hour: [0, 23],
    day: [1, 31],
    month: [1, 12],
    dayOfWeek: [0, 6],
  };

  const keys = ["minute", "hour", "day", "month", "dayOfWeek"];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const [min, max] = ranges[keys[i]];

    // Handle wildcards
    if (part === "*") continue;

    // Handle step values (e.g., */5)
    if (part.startsWith("*/")) {
      const step = parseInt(part.substring(2));
      if (isNaN(step) || step < 1) return false;
      continue;
    }

    // Handle ranges (e.g., 1-5)
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < min ||
        end > max ||
        start > end
      ) {
        return false;
      }
      continue;
    }

    // Handle lists (e.g., 1,3,5)
    if (part.includes(",")) {
      const values = part.split(",").map(Number);
      if (values.some((v) => isNaN(v) || v < min || v > max)) {
        return false;
      }
      continue;
    }

    // Handle single values
    const value = parseInt(part);
    if (isNaN(value) || value < min || value > max) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate next run time for a cron expression
 */
function getNextRunTime(cronExpression, fromDate = new Date()) {
  const cron = require("node-cron");

  // Validate the expression
  if (!cron.validate(cronExpression)) {
    throw new Error("Invalid cron expression");
  }

  // This is a simplified calculation
  // For production, you might want to use a library like 'cron-parser'
  const now = new Date(fromDate);
  const next = new Date(now.getTime() + 60000); // Start from next minute

  // For simplicity, we'll return an approximate next run
  // In production, use cron-parser for accurate calculation
  return next;
}

module.exports = {
  parseReminderPrompt,
  isValidCron,
  getNextRunTime,
};
