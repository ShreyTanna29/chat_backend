const express = require("express");
const auth = require("../middleware/auth");
const Reminder = require("../models/Reminder");
const { parseReminderPrompt, isValidCron } = require("../utils/reminderParser");
const {
  scheduleReminder,
  unscheduleReminder,
  refreshScheduler,
  getSchedulerStats,
} = require("../utils/reminderScheduler");
const { body, validationResult } = require("express-validator");

const router = express.Router();

/**
 * Create a new reminder from natural language
 * POST /api/reminders
 */
router.post(
  "/",
  auth,
  [
    body("prompt")
      .trim()
      .notEmpty()
      .withMessage("Prompt is required")
      .isLength({ min: 10, max: 500 })
      .withMessage("Prompt must be between 10 and 500 characters"),
    body("timezone")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Invalid timezone"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { prompt, timezone } = req.body;
      const userId = req.user.id;

      // Parse the natural language reminder
      const parsed = await parseReminderPrompt(prompt, timezone || "UTC");

      // Create the reminder
      const reminder = await Reminder.create(userId, {
        title: parsed.title,
        prompt: prompt,
        aiPrompt: parsed.aiPrompt,
        schedule: parsed.schedule,
        timezone: timezone || "UTC",
        metadata: {
          frequency: parsed.frequency,
        },
      });

      // Schedule the reminder
      scheduleReminder(reminder);

      res.status(201).json({
        success: true,
        message: "Reminder created successfully",
        data: {
          reminder: {
            id: reminder.id,
            title: reminder.title,
            prompt: reminder.prompt,
            schedule: reminder.schedule,
            frequency: parsed.frequency,
            timezone: reminder.timezone,
            isActive: reminder.isActive,
            createdAt: reminder.createdAt,
          },
        },
      });
    } catch (error) {
      console.error("Error creating reminder:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create reminder",
      });
    }
  }
);

/**
 * Create a reminder with custom cron expression
 * POST /api/reminders/custom
 */
router.post(
  "/custom",
  auth,
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("aiPrompt").trim().notEmpty().withMessage("AI prompt is required"),
    body("schedule")
      .trim()
      .notEmpty()
      .withMessage("Schedule (cron expression) is required")
      .custom((value) => {
        if (!isValidCron(value)) {
          throw new Error("Invalid cron expression");
        }
        return true;
      }),
    body("timezone").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { title, aiPrompt, schedule, timezone, prompt } = req.body;
      const userId = req.user.id;

      const reminder = await Reminder.create(userId, {
        title,
        prompt: prompt || aiPrompt,
        aiPrompt,
        schedule,
        timezone: timezone || "UTC",
      });

      // Schedule the reminder
      scheduleReminder(reminder);

      res.status(201).json({
        success: true,
        message: "Custom reminder created successfully",
        data: { reminder },
      });
    } catch (error) {
      console.error("Error creating custom reminder:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create custom reminder",
      });
    }
  }
);

/**
 * Get all reminders for the authenticated user
 * GET /api/reminders
 */
router.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const activeOnly = req.query.active === "true";

    const reminders = await Reminder.findByUserId(userId, activeOnly);

    res.json({
      success: true,
      data: {
        reminders,
        count: reminders.length,
      },
    });
  } catch (error) {
    console.error("Error fetching reminders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reminders",
    });
  }
});

/**
 * Get a specific reminder
 * GET /api/reminders/:id
 */
router.get("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const reminder = await Reminder.findById(id, userId);

    if (!reminder) {
      return res.status(404).json({
        success: false,
        message: "Reminder not found",
      });
    }

    res.json({
      success: true,
      data: { reminder },
    });
  } catch (error) {
    console.error("Error fetching reminder:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reminder",
    });
  }
});

/**
 * Update a reminder
 * PUT /api/reminders/:id
 */
router.put("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    // Validate cron if schedule is being updated
    if (updates.schedule && !isValidCron(updates.schedule)) {
      return res.status(400).json({
        success: false,
        message: "Invalid cron expression",
      });
    }

    const reminder = await Reminder.update(id, userId, updates);

    // Reschedule if schedule or active status changed
    if (updates.schedule || updates.isActive !== undefined) {
      unscheduleReminder(id);
      if (reminder.isActive) {
        scheduleReminder(reminder);
      }
    }

    res.json({
      success: true,
      message: "Reminder updated successfully",
      data: { reminder },
    });
  } catch (error) {
    console.error("Error updating reminder:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update reminder",
    });
  }
});

/**
 * Toggle reminder active status
 * PATCH /api/reminders/:id/toggle
 */
router.patch("/:id/toggle", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const reminder = await Reminder.toggleActive(id, userId);

    // Schedule or unschedule based on new status
    if (reminder.isActive) {
      scheduleReminder(reminder);
    } else {
      unscheduleReminder(id);
    }

    res.json({
      success: true,
      message: `Reminder ${
        reminder.isActive ? "activated" : "deactivated"
      } successfully`,
      data: { reminder },
    });
  } catch (error) {
    console.error("Error toggling reminder:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle reminder",
    });
  }
});

/**
 * Delete a reminder
 * DELETE /api/reminders/:id
 */
router.delete("/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Unschedule first
    unscheduleReminder(id);

    await Reminder.delete(id, userId);

    res.json({
      success: true,
      message: "Reminder deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting reminder:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to delete reminder",
    });
  }
});

/**
 * Get scheduler stats (admin/debug)
 * GET /api/reminders/system/stats
 */
router.get("/system/stats", auth, async (req, res) => {
  try {
    const stats = getSchedulerStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error fetching scheduler stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch scheduler stats",
    });
  }
});

/**
 * Refresh scheduler (reload all reminders)
 * POST /api/reminders/system/refresh
 */
router.post("/system/refresh", auth, async (req, res) => {
  try {
    await refreshScheduler();
    res.json({
      success: true,
      message: "Scheduler refreshed successfully",
    });
  } catch (error) {
    console.error("Error refreshing scheduler:", error);
    res.status(500).json({
      success: false,
      message: "Failed to refresh scheduler",
    });
  }
});

module.exports = router;
