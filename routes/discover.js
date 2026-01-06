const express = require("express");
const OpenAI = require("openai");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Cache configuration
const CACHE_FILE_PATH = path.join(
  __dirname,
  "..",
  "data",
  "discover-cache.json"
);
const CACHE_DIR = path.join(__dirname, "..", "data");

// In-memory cache
let newsCache = {
  data: [],
  lastUpdated: null,
  isLoading: false,
};

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// Load cache from file on startup
function loadCacheFromFile() {
  try {
    ensureDataDir();
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const fileContent = fs.readFileSync(CACHE_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileContent);
      newsCache = {
        data: parsed.data || [],
        lastUpdated: parsed.lastUpdated ? new Date(parsed.lastUpdated) : null,
        isLoading: false,
      };
      console.log(
        "[DISCOVER] Cache loaded from file. Items:",
        newsCache.data.length
      );
    }
  } catch (error) {
    console.error("[DISCOVER] Error loading cache from file:", error.message);
  }
}

// Save cache to file
function saveCacheToFile() {
  try {
    ensureDataDir();
    const cacheData = {
      data: newsCache.data,
      lastUpdated: newsCache.lastUpdated?.toISOString() || null,
    };
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));
    console.log("[DISCOVER] Cache saved to file");
  } catch (error) {
    console.error("[DISCOVER] Error saving cache to file:", error.message);
  }
}

// Fetch tech news from OpenAI
async function fetchTechNewsFromLLM() {
  console.log("[DISCOVER] Fetching tech news from LLM...");
  newsCache.isLoading = true;

  try {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const prompt = `You are a tech news curator. Generate a list of the top 20 most important and trending technology news stories for today (${today}).

For each news item, provide:
1. A compelling headline/title
2. A brief summary (2-3 sentences)
3. The source name (use real, well-known tech news sources like TechCrunch, The Verge, Wired, Ars Technica, MIT Technology Review, etc.)
4. A relevant public image URL from Unsplash that relates to the topic. Use the format: https://source.unsplash.com/800x600/?keyword where keyword is a relevant search term for that news item (e.g., "artificial-intelligence", "smartphone", "cybersecurity", etc.)
5. A category (one of: AI, Software, Hardware, Startups, Cybersecurity, Cloud, Mobile, Gaming, Science, Business)

Focus on recent developments in:
- Artificial Intelligence and Machine Learning
- Major tech company announcements
- Software and app releases
- Hardware and gadgets
- Cybersecurity
- Startups and funding
- Cloud computing
- Mobile technology
- Gaming and entertainment tech
- Science and research breakthroughs

Return the response as a valid JSON array with exactly 20 objects. Each object should have these fields:
- "id": a unique string identifier (use format "news-1", "news-2", etc.)
- "title": the headline
- "summary": the brief description
- "source": the news source name
- "imageUrl": the Unsplash image URL
- "category": the category
- "publishedAt": today's date in ISO format

IMPORTANT: Return ONLY the JSON array, no additional text or markdown formatting.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a tech news curator that returns responses in valid JSON format only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response content from LLM");
    }

    // Parse the JSON response
    let newsItems;
    try {
      // Try to extract JSON from the response (in case of markdown wrapping)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        newsItems = JSON.parse(jsonMatch[0]);
      } else {
        newsItems = JSON.parse(content);
      }
    } catch (parseError) {
      console.error(
        "[DISCOVER] Failed to parse LLM response:",
        parseError.message
      );
      console.error("[DISCOVER] Raw content:", content.substring(0, 500));
      throw new Error("Failed to parse news data from LLM");
    }

    // Validate and normalize the news items
    if (!Array.isArray(newsItems) || newsItems.length === 0) {
      throw new Error("Invalid news data structure from LLM");
    }

    // Update cache
    newsCache.data = newsItems.slice(0, 20).map((item, index) => ({
      id: item.id || `news-${index + 1}`,
      title: item.title || "Untitled",
      summary: item.summary || "",
      source: item.source || "Unknown",
      imageUrl:
        item.imageUrl || `https://source.unsplash.com/800x600/?technology`,
      category: item.category || "Technology",
      publishedAt: item.publishedAt || new Date().toISOString(),
    }));
    newsCache.lastUpdated = new Date();
    newsCache.isLoading = false;

    // Save to file for persistence
    saveCacheToFile();

    console.log(
      "[DISCOVER] Successfully fetched and cached",
      newsCache.data.length,
      "news items"
    );
    return newsCache.data;
  } catch (error) {
    console.error("[DISCOVER] Error fetching news from LLM:", error.message);
    newsCache.isLoading = false;
    throw error;
  }
}

// Check if cache needs refresh (older than 24 hours or empty)
function isCacheStale() {
  if (!newsCache.lastUpdated || newsCache.data.length === 0) {
    return true;
  }
  const now = new Date();
  const lastUpdate = new Date(newsCache.lastUpdated);
  const hoursDiff = (now - lastUpdate) / (1000 * 60 * 60);
  return hoursDiff >= 24;
}

// @route   GET /api/discover
// @desc    Get cached tech news
// @access  Public
router.get("/", async (req, res) => {
  try {
    console.log("[DISCOVER] GET request received");

    // If cache is empty and stale, fetch new data
    if (isCacheStale() && !newsCache.isLoading) {
      console.log("[DISCOVER] Cache is stale or empty, fetching fresh data...");
      try {
        await fetchTechNewsFromLLM();
      } catch (fetchError) {
        // If we have old data, return it with a warning
        if (newsCache.data.length > 0) {
          console.log("[DISCOVER] Using stale cache after fetch failure");
          return res.json({
            success: true,
            message: "Returning cached data (refresh failed)",
            data: newsCache.data,
            lastUpdated: newsCache.lastUpdated,
            count: newsCache.data.length,
          });
        }
        throw fetchError;
      }
    }

    // If currently loading, wait a bit and return what we have
    if (newsCache.isLoading) {
      console.log("[DISCOVER] News is currently being fetched...");
      return res.json({
        success: true,
        message: "News is being refreshed, please try again shortly",
        data: newsCache.data,
        lastUpdated: newsCache.lastUpdated,
        count: newsCache.data.length,
        isLoading: true,
      });
    }

    res.json({
      success: true,
      data: newsCache.data,
      lastUpdated: newsCache.lastUpdated,
      count: newsCache.data.length,
    });
  } catch (error) {
    console.error("[DISCOVER] Error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tech news",
      error: error.message,
    });
  }
});

// Schedule daily refresh at 6:00 AM
function initDiscoverCron() {
  // Load existing cache from file
  loadCacheFromFile();

  // Schedule daily refresh at 6:00 AM
  cron.schedule("0 6 * * *", async () => {
    console.log("[DISCOVER] Running scheduled daily refresh at 6:00 AM");
    try {
      await fetchTechNewsFromLLM();
      console.log("[DISCOVER] Daily refresh completed successfully");
    } catch (error) {
      console.error("[DISCOVER] Daily refresh failed:", error.message);
    }
  });

  console.log("[DISCOVER] Cron job scheduled for 6:00 AM daily");

  // If cache is empty or stale on startup, fetch immediately
  if (isCacheStale()) {
    console.log(
      "[DISCOVER] Cache is stale on startup, fetching initial data..."
    );
    fetchTechNewsFromLLM().catch((error) => {
      console.error("[DISCOVER] Initial fetch failed:", error.message);
    });
  }
}

module.exports = router;
module.exports.initDiscoverCron = initDiscoverCron;
