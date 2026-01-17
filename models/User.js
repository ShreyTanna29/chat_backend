const bcrypt = require("bcryptjs");
const prisma = require("../config/database");

class User {
  // Hash password before creating user
  static async hashPassword(password) {
    const salt = await bcrypt.genSalt(12);
    return await bcrypt.hash(password, salt);
  }

  // Compare password
  static async comparePassword(candidatePassword, hashedPassword) {
    try {
      return await bcrypt.compare(candidatePassword, hashedPassword);
    } catch (error) {
      throw error;
    }
  }

  // Create user
  static async create(userData) {
    let hashedPassword = null;
    if (userData.password) {
      hashedPassword = await this.hashPassword(userData.password);
    }

    return await prisma.user.create({
      data: {
        ...userData,
        email: userData.email.toLowerCase(),
        name: userData.name.trim(),
        password: hashedPassword,
      },
    });
  }

  // Find user by ID
  static async findById(id, options = {}) {
    const { excludePassword = true } = options;

    return await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        isVerified: true,
        refreshToken: !excludePassword,
        searchHistory: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
        password: !excludePassword,
      },
    });
  }

  // Find user by email
  static async findByEmail(email, options = {}) {
    const { includePassword = false } = options;

    return await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        isVerified: true,
        refreshToken: true,
        googleId: true,
        appleId: true,
        searchHistory: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
        password: includePassword,
      },
    });
  }

  // Find user by Google ID
  static async findByGoogleId(googleId) {
    return await prisma.user.findUnique({
      where: { googleId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        isVerified: true,
        refreshToken: true,
        googleId: true,
        searchHistory: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Find user by Apple ID
  static async findByAppleId(appleId) {
    return await prisma.user.findUnique({
      where: { appleId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        isVerified: true,
        refreshToken: true,
        googleId: true,
        appleId: true,
        searchHistory: true,
        preferences: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Update user
  static async update(id, updateData) {
    // Hash password if it's being updated
    if (updateData.password) {
      updateData.password = await this.hashPassword(updateData.password);
    }

    // Normalize email if it's being updated
    if (updateData.email) {
      updateData.email = updateData.email.toLowerCase();
    }

    // Trim name if it's being updated
    if (updateData.name) {
      updateData.name = updateData.name.trim();
    }

    return await prisma.user.update({
      where: { id },
      data: updateData,
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
    });
  }

  // Add to search history
  static async addToSearchHistory(id, query) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { searchHistory: true },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const history = Array.isArray(user.searchHistory) ? user.searchHistory : [];

    // Add new query to the beginning
    history.unshift({
      query,
      timestamp: new Date().toISOString(),
    });

    // Keep only last 50 searches
    if (history.length > 50) {
      history.splice(50);
    }

    return await prisma.user.update({
      where: { id },
      data: { searchHistory: history },
    });
  }

  // Clear search history
  static async clearSearchHistory(id) {
    return await prisma.user.update({
      where: { id },
      data: { searchHistory: [] },
    });
  }

  // Update refresh token
  static async updateRefreshToken(id, refreshToken) {
    return await prisma.user.update({
      where: { id },
      data: { refreshToken },
    });
  }

  // Delete user
  static async delete(id) {
    return await prisma.user.delete({
      where: { id },
    });
  }

  // Get all users (admin function)
  static async findMany(options = {}) {
    const { skip = 0, take = 10 } = options;

    return await prisma.user.findMany({
      skip,
      take,
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
    });
  }

  // Count users
  static async count() {
    return await prisma.user.count();
  }
}

module.exports = User;

// Instance method to compare password
User.prototype.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Instance method to add search history
User.prototype.addToSearchHistory = async function (query) {
  const history = this.searchHistory || [];
  history.unshift({
    query,
    timestamp: new Date(),
  });

  // Keep only last 50 searches
  if (history.length > 50) {
    history.splice(50);
  }

  this.searchHistory = history;
  await this.save();
};

// Remove sensitive data when converting to JSON
User.prototype.toJSON = function () {
  const user = Object.assign({}, this.get());
  delete user.password;
  delete user.refreshToken;
  return user;
};

module.exports = User;
