const prisma = require("../config/database");

class Reminder {
  /**
   * Create a new reminder
   */
  static async create(userId, reminderData) {
    const { title, prompt, aiPrompt, schedule, timezone, metadata } =
      reminderData;

    const reminder = await prisma.reminder.create({
      data: {
        userId,
        title,
        prompt,
        aiPrompt,
        schedule,
        timezone: timezone || "UTC",
        metadata: metadata || {},
        isActive: true,
      },
    });

    return reminder;
  }

  /**
   * Get all reminders for a user
   */
  static async findByUserId(userId, activeOnly = false) {
    const where = { userId };
    if (activeOnly) {
      where.isActive = true;
    }

    return await prisma.reminder.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get a specific reminder by ID
   */
  static async findById(reminderId, userId = null) {
    const where = { id: reminderId };
    if (userId) {
      where.userId = userId;
    }

    return await prisma.reminder.findUnique({ where });
  }

  /**
   * Update a reminder
   */
  static async update(reminderId, userId, updates) {
    const allowedUpdates = [
      "title",
      "prompt",
      "aiPrompt",
      "schedule",
      "timezone",
      "isActive",
      "metadata",
    ];

    const data = {};
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        data[key] = updates[key];
      }
    }

    data.updatedAt = new Date();

    return await prisma.reminder.update({
      where: {
        id: reminderId,
        userId,
      },
      data,
    });
  }

  /**
   * Delete a reminder
   */
  static async delete(reminderId, userId) {
    return await prisma.reminder.delete({
      where: {
        id: reminderId,
        userId,
      },
    });
  }

  /**
   * Toggle reminder active status
   */
  static async toggleActive(reminderId, userId) {
    const reminder = await this.findById(reminderId, userId);
    if (!reminder) {
      throw new Error("Reminder not found");
    }

    return await this.update(reminderId, userId, {
      isActive: !reminder.isActive,
    });
  }

  /**
   * Update last run time
   */
  static async updateLastRun(reminderId, lastRun, nextRun = null) {
    const data = { lastRun };
    if (nextRun) {
      data.nextRun = nextRun;
    }

    return await prisma.reminder.update({
      where: { id: reminderId },
      data,
    });
  }

  /**
   * Get all active reminders (for scheduler)
   */
  static async getActiveReminders() {
    return await prisma.reminder.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Get reminders due for execution
   */
  static async getDueReminders() {
    const now = new Date();
    return await prisma.reminder.findMany({
      where: {
        isActive: true,
        OR: [
          { nextRun: null }, // Never run before
          { nextRun: { lte: now } }, // Due now
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });
  }
}

module.exports = Reminder;
