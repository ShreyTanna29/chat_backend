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

const axios = require("axios");

// Perform web search via Tavily
async function performWebSearch(query) {
  console.log("[DISCOVER] Starting web search for query:", query);
  try {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      console.error("[DISCOVER] ❌ TAVILY_API_KEY not configured!");
      throw new Error("TAVILY_API_KEY not configured");
    }

    console.log("[DISCOVER] Making request to Tavily API...");
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: apiKey,
        query,
        include_answer: true,
        include_images: true, // Request images
        max_results: 10, // Get enough results to filter
        search_depth: "advanced",
        topic: "news", // Optimize for news
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    const data = response.data;
    console.log(
      "[DISCOVER] ✓ Received",
      data.results?.length || 0,
      "results and",
      data.images?.length || 0,
      "images"
    );

    return {
      results: data.results || [],
      images: data.images || [],
    };
  } catch (err) {
    console.error("[DISCOVER] ❌ Web search failed:", err.message);
    if (err.response) {
      console.error("[DISCOVER] Error details:", err.response.data);
    }
    throw err;
  }
}

// Helper function to remove duplicate news based on title similarity
function removeDuplicateNews(newsItems) {
  const seen = new Set();
  const unique = [];

  for (const item of newsItems) {
    // Normalize title for comparison (lowercase, remove extra spaces/punctuation)
    const normalizedTitle = item.title
      ?.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalizedTitle || seen.has(normalizedTitle)) {
      continue;
    }

    // Also check for very similar titles (first 50 chars match)
    const titlePrefix = normalizedTitle.substring(0, 50);
    let isDuplicate = false;
    for (const seenTitle of seen) {
      if (
        seenTitle.startsWith(titlePrefix) ||
        titlePrefix.startsWith(seenTitle.substring(0, 50))
      ) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      seen.add(normalizedTitle);
      unique.push(item);
    }
  }

  return unique;
}

// Helper function to parse LLM response with retry
async function parseNewsWithRetry(searchData, today, maxRetries = 3) {
  const targetCount = 20;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DISCOVER] Parsing attempt ${attempt}/${maxRetries}...`);

      const prompt = `You are a tech news curator. I have performed a web search for today's top tech news (${today}).
Here are the search results:
${JSON.stringify(searchData.results, null, 2)}

Here are some related images found:
${JSON.stringify(searchData.images, null, 2)}

Your task is to curate a list of the top ${targetCount} most important and trending technology news stories based on these results.

For each news item, provide:
1. A compelling headline/title
2. A brief summary (2-3 sentences)
3. The source name (e.g., TechCrunch, The Verge, etc. - derive from the search result URL or title if possible)
4. A relevant image URL. 
   - PRIORITY: Use a valid image URL from the 'images' list provided above if it matches the news topic.
   - SECONDARY: If the search result item itself has an image URL, use that.
   - FALLBACK: If no real image is available, use a placeholder: https://placehold.co/800x600?text=Tech+News
5. A category (AI, Software, Hardware, Startups, Cybersecurity, Cloud, Mobile, Gaming, Science, Business)

Return the response as a valid JSON array with exactly ${targetCount} objects (or fewer if not enough unique stories found, but aim for ${targetCount}).
Each object must have:
- "id": "news-1", "news-2", etc.
- "title"
- "summary"
- "source"
- "imageUrl"
- "category"
- "publishedAt": "${new Date().toISOString()}"

IMPORTANT: Return ONLY the JSON array. Make sure all ${targetCount} items are UNIQUE with different headlines.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a tech news curator that returns responses in valid JSON format only. Always aim to return exactly 20 unique news items.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 5000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response content from LLM");
      }

      console.log("[DISCOVER] Raw LLM Response length:", content.length);

      // Parse JSON
      const parsedResponse = JSON.parse(content);

      // Handle different JSON structures (array vs object with key)
      let newsItems = [];
      if (Array.isArray(parsedResponse)) {
        newsItems = parsedResponse;
      } else if (parsedResponse.news && Array.isArray(parsedResponse.news)) {
        newsItems = parsedResponse.news;
      } else if (parsedResponse.data && Array.isArray(parsedResponse.data)) {
        newsItems = parsedResponse.data;
      } else if (
        parsedResponse.articles &&
        Array.isArray(parsedResponse.articles)
      ) {
        newsItems = parsedResponse.articles;
      } else if (
        parsedResponse.stories &&
        Array.isArray(parsedResponse.stories)
      ) {
        newsItems = parsedResponse.stories;
      } else {
        // Try to find the first array in the object
        const firstArray = Object.values(parsedResponse).find((val) =>
          Array.isArray(val)
        );
        if (firstArray) {
          newsItems = firstArray;
        }
      }

      if (newsItems.length === 0) {
        throw new Error("Could not extract news array from LLM response");
      }

      console.log(
        `[DISCOVER] Parsed ${newsItems.length} news items on attempt ${attempt}`
      );
      return newsItems;
    } catch (parseError) {
      console.error(
        `[DISCOVER] Parse attempt ${attempt} failed:`,
        parseError.message
      );
      if (attempt === maxRetries) {
        throw parseError;
      }
      // Wait a bit before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Fetch tech news using Web Search + LLM with retry and deduplication
async function fetchTechNewsFromLLM() {
  console.log("[DISCOVER] Fetching tech news with Web Search...");
  newsCache.isLoading = true;

  const TARGET_NEWS_COUNT = 20;
  const MAX_FETCH_ROUNDS = 3;

  try {
    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Different search queries to get diverse results
    const searchQueries = [
      `top technology news headlines and stories ${today}`,
      `latest tech industry news AI software ${today}`,
      `breaking technology startup cybersecurity news ${today}`,
    ];

    let allNewsItems = [];
    let fetchRound = 0;

    while (
      allNewsItems.length < TARGET_NEWS_COUNT &&
      fetchRound < MAX_FETCH_ROUNDS
    ) {
      const queryIndex = fetchRound % searchQueries.length;
      const searchQuery = searchQueries[queryIndex];

      console.log(
        `[DISCOVER] Fetch round ${
          fetchRound + 1
        }/${MAX_FETCH_ROUNDS}, current items: ${allNewsItems.length}`
      );

      try {
        // Step 1: Search for news
        const searchData = await performWebSearch(searchQuery);

        if (!searchData.results || searchData.results.length === 0) {
          console.log("[DISCOVER] No search results, trying next query...");
          fetchRound++;
          continue;
        }

        // Step 2: Process with LLM (with retry)
        const newsItems = await parseNewsWithRetry(searchData, today, 3);

        // Step 3: Normalize and add to collection
        const normalizedItems = newsItems.map((item, index) => ({
          id: item.id || `news-${allNewsItems.length + index + 1}`,
          title: item.title || "Untitled",
          summary: item.summary || "",
          source: item.source || "Unknown",
          imageUrl:
            item.imageUrl || "https://placehold.co/800x600?text=Tech+News",
          category: item.category || "Technology",
          publishedAt: item.publishedAt || new Date().toISOString(),
        }));

        allNewsItems = [...allNewsItems, ...normalizedItems];

        // Remove duplicates after each round
        allNewsItems = removeDuplicateNews(allNewsItems);

        console.log(
          `[DISCOVER] After deduplication: ${allNewsItems.length} unique items`
        );
      } catch (roundError) {
        console.error(
          `[DISCOVER] Fetch round ${fetchRound + 1} failed:`,
          roundError.message
        );
      }

      fetchRound++;

      // If we have enough, stop
      if (allNewsItems.length >= TARGET_NEWS_COUNT) {
        break;
      }

      // Small delay between rounds to avoid rate limiting
      if (
        fetchRound < MAX_FETCH_ROUNDS &&
        allNewsItems.length < TARGET_NEWS_COUNT
      ) {
        console.log("[DISCOVER] Need more news, fetching additional batch...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Final deduplication and limiting
    allNewsItems = removeDuplicateNews(allNewsItems);

    // Re-assign IDs sequentially
    allNewsItems = allNewsItems
      .slice(0, TARGET_NEWS_COUNT)
      .map((item, index) => ({
        ...item,
        id: `news-${index + 1}`,
      }));

    if (allNewsItems.length === 0) {
      throw new Error("Failed to fetch any news items after all attempts");
    }

    // Update cache
    newsCache.data = allNewsItems;
    newsCache.lastUpdated = new Date();
    newsCache.isLoading = false;

    saveCacheToFile();
    console.log(
      "[DISCOVER] Successfully fetched and cached",
      newsCache.data.length,
      "unique news items"
    );
    return newsCache.data;
  } catch (error) {
    console.error("[DISCOVER] Error fetching news:", error.message);
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
