const prisma = require("../config/database");

class Session {
  // Create a new session
  static async create(sessionData) {
    const { userId, refreshToken, deviceInfo, ipAddress, expiresAt } =
      sessionData;

    return await prisma.session.create({
      data: {
        userId,
        refreshToken,
        deviceInfo,
        ipAddress,
        expiresAt,
      },
    });
  }

  // Find session by refresh token
  static async findByRefreshToken(refreshToken) {
    return await prisma.session.findUnique({
      where: { refreshToken },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
            isVerified: true,
            searchHistory: true,
            preferences: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  // Find all sessions for a user
  static async findByUserId(userId) {
    return await prisma.session.findMany({
      where: {
        userId,
        expiresAt: {
          gt: new Date(), // Only return non-expired sessions
        },
      },
      orderBy: {
        lastActive: "desc",
      },
    });
  }

  // Update last active time
  static async updateLastActive(id) {
    return await prisma.session.update({
      where: { id },
      data: { lastActive: new Date() },
    });
  }

  // Delete a specific session (logout from one device)
  static async delete(id) {
    return await prisma.session.delete({
      where: { id },
    });
  }

  // Delete session by refresh token
  static async deleteByRefreshToken(refreshToken) {
    return await prisma.session.delete({
      where: { refreshToken },
    });
  }

  // Delete all sessions for a user (logout from all devices)
  static async deleteAllByUserId(userId) {
    return await prisma.session.deleteMany({
      where: { userId },
    });
  }

  // Clean up expired sessions (can be run periodically)
  static async deleteExpired() {
    return await prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }

  // Validate if session exists and is not expired
  static async isValid(refreshToken) {
    const session = await this.findByRefreshToken(refreshToken);

    if (!session) {
      return false;
    }

    // Check if session has expired
    if (session.expiresAt < new Date()) {
      // Delete expired session
      await this.delete(session.id);
      return false;
    }

    return true;
  }
}

module.exports = Session;
