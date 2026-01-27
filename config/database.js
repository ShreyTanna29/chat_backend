const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  // Connection pool settings for better performance
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Warm up the connection pool on startup
(async () => {
  try {
    await prisma.$connect();
    console.log("[DATABASE] ✓ Connected and connection pool warmed up");
  } catch (error) {
    console.error("[DATABASE] ❌ Failed to connect:", error.message);
  }
})();

// Handle graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

module.exports = prisma;
