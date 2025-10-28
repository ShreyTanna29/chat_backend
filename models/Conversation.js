const prisma = require("../config/database");

class Conversation {
  /**
   * Create a new conversation
   * @param {Object} data - Conversation data
   * @returns {Promise<Object>} Created conversation
   */
  static async create(data) {
    const { userId, title = "New Chat" } = data;

    return await prisma.conversation.create({
      data: {
        userId,
        title,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
  }

  /**
   * Find conversation by ID
   * @param {string} id - Conversation ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Conversation or null
   */
  static async findById(id, options = {}) {
    const { includeMessages = true } = options;

    return await prisma.conversation.findUnique({
      where: { id },
      include: {
        messages: includeMessages
          ? {
              orderBy: {
                createdAt: "asc",
              },
            }
          : false,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Get all conversations for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of conversations
   */
  static async findByUserId(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      includeMessages = false,
      orderBy = "updatedAt",
      orderDir = "desc",
    } = options;

    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where: { userId },
        skip,
        take: parseInt(limit),
        orderBy: {
          [orderBy]: orderDir,
        },
        include: {
          messages: includeMessages
            ? {
                orderBy: {
                  createdAt: "asc",
                },
              }
            : {
                take: 1,
                orderBy: {
                  createdAt: "asc",
                },
                select: {
                  content: true,
                  createdAt: true,
                },
              },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      }),
      prisma.conversation.count({
        where: { userId },
      }),
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

  /**
   * Update conversation
   * @param {string} id - Conversation ID
   * @param {Object} data - Update data
   * @returns {Promise<Object>} Updated conversation
   */
  static async update(id, data) {
    return await prisma.conversation.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });
  }

  /**
   * Delete conversation
   * @param {string} id - Conversation ID
   * @returns {Promise<Object>} Deleted conversation
   */
  static async delete(id) {
    return await prisma.conversation.delete({
      where: { id },
    });
  }

  /**
   * Delete all conversations for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Delete result
   */
  static async deleteAllByUserId(userId) {
    return await prisma.conversation.deleteMany({
      where: { userId },
    });
  }

  /**
   * Add message to conversation
   * @param {string} conversationId - Conversation ID
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} Created message
   */
  static async addMessage(conversationId, messageData) {
    const { role, content, metadata = {} } = messageData;

    // Update conversation's updatedAt timestamp
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return await prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        metadata,
      },
    });
  }

  /**
   * Get messages for a conversation
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} List of messages
   */
  static async getMessages(conversationId, options = {}) {
    const { limit, offset = 0 } = options;

    return await prisma.message.findMany({
      where: { conversationId },
      orderBy: {
        createdAt: "asc",
      },
      skip: offset,
      take: limit,
    });
  }

  /**
   * Search conversations by title or content
   * @param {string} userId - User ID
   * @param {string} query - Search query
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Matching conversations
   */
  static async search(userId, query, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    // Search in conversation titles and message content
    const conversations = await prisma.conversation.findMany({
      where: {
        userId,
        OR: [
          {
            title: {
              contains: query,
              mode: "insensitive",
            },
          },
          {
            messages: {
              some: {
                content: {
                  contains: query,
                  mode: "insensitive",
                },
              },
            },
          },
        ],
      },
      skip,
      take: parseInt(limit),
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        messages: {
          take: 1,
          orderBy: {
            createdAt: "asc",
          },
        },
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    return conversations;
  }

  /**
   * Generate conversation title from first message
   * @param {string} firstMessage - First user message
   * @returns {string} Generated title
   */
  static generateTitle(firstMessage) {
    // Take first 50 characters and remove newlines
    const cleaned = firstMessage.replace(/\n/g, " ").trim();
    return cleaned.length > 50 ? cleaned.substring(0, 47) + "..." : cleaned;
  }

  /**
   * Auto-generate and update conversation title
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Updated conversation
   */
  static async autoGenerateTitle(conversationId) {
    const conversation = await this.findById(conversationId);

    if (!conversation || conversation.messages.length === 0) {
      return conversation;
    }

    // Find first user message
    const firstUserMessage = conversation.messages.find(
      (m) => m.role === "user"
    );

    if (!firstUserMessage) {
      return conversation;
    }

    const title = this.generateTitle(firstUserMessage.content);

    return await this.update(conversationId, { title });
  }
}

module.exports = Conversation;
