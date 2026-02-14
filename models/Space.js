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

  /**
   * Add a member to a space
   * @param {{spaceId: string, userId: string, addedBy: string, role?: string}} data
   */
  static async addMember(data) {
    const { spaceId, userId, addedBy, role = "member" } = data;
    
    // Check if user is already a member
    const existing = await prisma.spaceMember.findUnique({
      where: {
        spaceId_userId: { spaceId, userId },
      },
    });

    if (existing) {
      throw new Error("User is already a member of this space");
    }

    return await prisma.spaceMember.create({
      data: {
        spaceId,
        userId,
        addedBy,
        role,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });
  }

  /**
   * Remove a member from a space
   * @param {{spaceId: string, userId: string}} data
   */
  static async removeMember(data) {
    const { spaceId, userId } = data;
    
    // Don't allow removing the space owner
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
    });

    if (space.userId === userId) {
      throw new Error("Cannot remove the space owner");
    }

    return await prisma.spaceMember.delete({
      where: {
        spaceId_userId: { spaceId, userId },
      },
    });
  }

  /**
   * List all members of a space
   * @param {string} spaceId
   */
  static async listMembers(spaceId) {
    const members = await prisma.spaceMember.findMany({
      where: { spaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: { addedAt: "asc" },
    });

    // Also get the space owner
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // Return owner first, then members
    return {
      owner: {
        ...space.user,
        role: "owner",
        addedAt: space.createdAt,
      },
      members: members.map((m) => ({
        id: m.id,
        ...m.user,
        role: m.role,
        addedAt: m.addedAt,
        addedBy: m.addedBy,
      })),
    };
  }

  /**
   * Check if a user is a member or owner of a space
   * @param {{spaceId: string, userId: string}} data
   */
  static async isMember(data) {
    const { spaceId, userId } = data;
    
    // Check if user is the owner
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
    });

    if (space && space.userId === userId) {
      return { isMember: true, role: "owner" };
    }

    // Check if user is a member
    const member = await prisma.spaceMember.findUnique({
      where: {
        spaceId_userId: { spaceId, userId },
      },
    });

    return {
      isMember: !!member,
      role: member ? member.role : null,
    };
  }

  /**
   * Update a member's role
   * @param {{spaceId: string, userId: string, role: string}} data
   */
  static async updateMemberRole(data) {
    const { spaceId, userId, role } = data;
    
    // Don't allow changing the owner's role
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
    });

    if (space.userId === userId) {
      throw new Error("Cannot change the role of the space owner");
    }

    return await prisma.spaceMember.update({
      where: {
        spaceId_userId: { spaceId, userId },
      },
      data: { role },
    });
  }

  /**
   * Get spaces where user is owner or member
   * @param {string} userId
   */
  static async findAllUserSpaces(userId, { page = 1, limit = 20 } = {}) {
    const skip = (page - 1) * limit;
    
    // Get spaces owned by user
    const ownedSpaces = await prisma.space.findMany({
      where: { userId },
      include: {
        _count: { select: { conversations: true, members: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Get spaces where user is a member
    const memberSpaces = await prisma.spaceMember.findMany({
      where: { userId },
      include: {
        space: {
          include: {
            _count: { select: { conversations: true, members: true } },
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
      },
      orderBy: { addedAt: "desc" },
    });

    const allSpaces = [
      ...ownedSpaces.map((s) => ({ ...s, userRole: "owner" })),
      ...memberSpaces.map((m) => ({ ...m.space, userRole: m.role })),
    ];

    // Sort by updatedAt
    allSpaces.sort((a, b) => b.updatedAt - a.updatedAt);

    const total = allSpaces.length;
    const paginatedSpaces = allSpaces.slice(skip, skip + parseInt(limit));

    return {
      spaces: paginatedSpaces,
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
