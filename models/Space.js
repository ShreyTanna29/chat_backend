const prisma = require("../config/database");

class Space {
  /**
   * Create a space
   * @param {{userId: string, name: string, defaultPrompt?: string}} data
   */
  static async create(data) {
    const { userId, name, defaultPrompt } = data;
    return await prisma.space.create({
      data: { userId, name, defaultPrompt },
    });
  }

  /**
   * Get a space by id
   * @param {string} id
   */
  static async findById(id, options = {}) {
    const { includeConversations = false } = options;
    return await prisma.space.findUnique({
      where: { id },
      include: includeConversations
        ? {
            conversations: {
              orderBy: { updatedAt: "desc" },
              include: {
                _count: { select: { messages: true } },
              },
            },
          }
        : undefined,
    });
  }

  /**
   * List spaces for a user
   */
  static async findByUserId(userId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;
    const [spaces, total] = await Promise.all([
      prisma.space.findMany({
        where: { userId },
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { conversations: true } },
        },
      }),
      prisma.space.count({ where: { userId } }),
    ]);

    return {
      spaces,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update a space
   */
  static async update(id, data) {
    const { name, defaultPrompt } = data;
    return await prisma.space.update({
      where: { id },
      data: { name, defaultPrompt, updatedAt: new Date() },
    });
  }

  /**
   * Delete a space (conversations remain with spaceId set null)
   */
  static async delete(id) {
    // Set conversations' spaceId to null before deleting due to SetNull
    await prisma.conversation.updateMany({
      where: { spaceId: id },
      data: { spaceId: null },
    });
    return await prisma.space.delete({ where: { id } });
  }

  /**
   * List conversations inside a space
   */
  static async listConversations(spaceId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;
    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { spaceId },
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { messages: true } },
        },
      }),
      prisma.conversation.count({ where: { spaceId } }),
    ]);

    return {
      conversations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }
}

module.exports = Space;
