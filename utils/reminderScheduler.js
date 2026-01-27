const cron = require("node-cron");
const OpenAI = require("openai");
const Reminder = require("../models/Reminder");
const prisma = require("../config/database");

// Store active cron jobs
const activeJobs = new Map();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Execute a reminder by generating AI response and storing it
 */
async function executeReminder(reminder) {
  try {
    console.log(
      `[REMINDER] Executing reminder ${reminder.id}: ${reminder.title}`
    );

    // Generate AI response for the reminder
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant providing scheduled updates and reminders. Be concise, informative, and helpful.",
        },
        {
          role: "user",
          content: reminder.aiPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const aiResponse = response.choices[0].message.content;

    // Create a system message/notification for the user
    // You can store this in a new notifications table or create a conversation
    await createReminderNotification(reminder, aiResponse);

    // Update last run time
    const nextRun = calculateNextRun(reminder.schedule);
    await Reminder.updateLastRun(reminder.id, new Date(), nextRun);

    console.log(`[REMINDER] Successfully executed reminder ${reminder.id}`);
    return { success: true, response: aiResponse };
  } catch (error) {
    console.error(`[REMINDER] Error executing reminder ${reminder.id}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a notification for the reminder execution
 * This creates a new conversation with the AI response
 */
async function createReminderNotification(reminder, aiResponse) {
  try {
    // Create a new conversation for this reminder
    const conversation = await prisma.conversation.create({
      data: {
        userId: reminder.userId,
        title: `🔔 ${reminder.title}`,
      },
    });

    // Add the reminder prompt as user message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: reminder.prompt,
        metadata: {
          isReminder: true,
          reminderId: reminder.id,
          scheduledTime: new Date().toISOString(),
        },
      },
    });

    // Add the AI response as assistant message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: aiResponse,
        metadata: {
          isReminder: true,
          reminderId: reminder.id,
        },
      },
    });

    console.log(
      `[REMINDER] Created conversation ${conversation.id} for reminder ${reminder.id}`
    );
    return conversation;
  } catch (error) {
    console.error("[REMINDER] Error creating notification:", error);
    throw error;
  }
}

/**
 * Calculate next run time based on cron schedule
 */
function calculateNextRun(cronExpression) {
  // This is a simplified version
  // For production, use a proper cron parser library like 'cron-parser'
  const now = new Date();

  // For simplicity, we'll add 24 hours for daily schedules
  // In production, properly parse the cron expression
  const parts = cronExpression.split(" ");
  const hour = parseInt(parts[1]) || 0;
  const minute = parseInt(parts[0]) || 0;

  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);

  // If time has passed today, schedule for tomorrow
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

/**
 * Schedule a reminder with cron
 */
function scheduleReminder(reminder) {
  // If already scheduled, skip
  if (activeJobs.has(reminder.id)) {
    console.log(`[REMINDER] Reminder ${reminder.id} already scheduled`);
    return;
  }

  // Validate cron expression
  if (!cron.validate(reminder.schedule)) {
    console.error(
      `[REMINDER] Invalid cron expression for reminder ${reminder.id}: ${reminder.schedule}`
    );
    return;
  }

  try {
    // Schedule the cron job
    const job = cron.schedule(
      reminder.schedule,
      async () => {
        await executeReminder(reminder);
      },
      {
        scheduled: true,
        timezone: reminder.timezone || "UTC",
      }
    );

    activeJobs.set(reminder.id, job);
    console.log(
      `[REMINDER] Scheduled reminder ${reminder.id}: ${reminder.title} (${reminder.schedule})`
    );
  } catch (error) {
    console.error(
      `[REMINDER] Error scheduling reminder ${reminder.id}:`,
      error
    );
  }
}

/**
 * Unschedule a reminder
 */
function unscheduleReminder(reminderId) {
  const job = activeJobs.get(reminderId);
  if (job) {
    job.stop();
    activeJobs.delete(reminderId);
    console.log(`[REMINDER] Unscheduled reminder ${reminderId}`);
  }
}

/**
 * Initialize the reminder scheduler
 * Load all active reminders and schedule them
 */
async function initializeScheduler() {
  try {
    console.log("[REMINDER] Initializing reminder scheduler...");

    // Clear any existing jobs
    activeJobs.forEach((job) => job.stop());
    activeJobs.clear();

    // Load all active reminders
    const reminders = await Reminder.getActiveReminders();
    console.log(`[REMINDER] Found ${reminders.length} active reminders`);

    // Schedule each reminder
    for (const reminder of reminders) {
      scheduleReminder(reminder);
    }

    console.log(
      `[REMINDER] Scheduler initialized with ${activeJobs.size} scheduled reminders`
    );
  } catch (error) {
    console.error("[REMINDER] Error initializing scheduler:", error);
  }
}

/**
 * Refresh scheduler (reload all reminders)
 */
async function refreshScheduler() {
  console.log("[REMINDER] Refreshing scheduler...");
  await initializeScheduler();
}

/**
 * Stop all scheduled reminders
 */
function stopAllReminders() {
  console.log("[REMINDER] Stopping all reminders...");
  activeJobs.forEach((job) => job.stop());
  activeJobs.clear();
}

/**
 * Get scheduler stats
 */
function getSchedulerStats() {
  return {
    activeJobs: activeJobs.size,
    jobs: Array.from(activeJobs.keys()),
  };
}

module.exports = {
  executeReminder,
  scheduleReminder,
  unscheduleReminder,
  initializeScheduler,
  refreshScheduler,
  stopAllReminders,
  getSchedulerStats,
};
