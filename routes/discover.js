const express = require("express");
const OpenAI = require("openai");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("../middleware/auth");
const User = require("../models/User");
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
// In-memory cache
// Structure: { "cacheKey": { data: [], lastUpdated: Date, isLoading: boolean } }
let newsCache = {
  default: {
    data: [],
    lastUpdated: null,
    isLoading: false,
  },
};

// Generate cache key from preferences
function getCacheKey(countries = [], categories = []) {
  if (
    (!countries || countries.length === 0) &&
    (!categories || categories.length === 0)
  ) {
    return "default";
  }
  const str = JSON.stringify({
    countries: countries ? countries.sort() : [],
    categories: categories ? categories.sort() : [],
  });
  return crypto.createHash("md5").update(str).digest("hex");
}

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
      // Migrate old cache format if needed
      if (parsed.data && Array.isArray(parsed.data)) {
        newsCache = {
          default: {
            data: parsed.data,
            lastUpdated: parsed.lastUpdated
              ? new Date(parsed.lastUpdated)
              : null,
            isLoading: false,
          },
        };
      } else {
        // Load new format, converting date strings back to Date objects
        newsCache = parsed;
        for (const key in newsCache) {
          if (newsCache[key].lastUpdated) {
            newsCache[key].lastUpdated = new Date(newsCache[key].lastUpdated);
          }
          newsCache[key].isLoading = false; // Reset loading state on restart
        }
      }
      console.log(
        "[DISCOVER] Cache loaded from file. Keys:",
        Object.keys(newsCache).length
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
    const cacheData = {};
    for (const key in newsCache) {
      cacheData[key] = {
        data: newsCache[key].data,
        lastUpdated: newsCache[key].lastUpdated?.toISOString() || null,
      };
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(cacheData, null, 2));
    console.log("[DISCOVER] Cache saved to file");
  } catch (error) {
    console.error("[DISCOVER] Error saving cache to file:", error.message);
  }
}

const axios = require("axios");

// Category-based fallback images (high-quality Unsplash images)
const CATEGORY_FALLBACK_IMAGES = {
  AI: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop",
  Software:
    "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=800&h=600&fit=crop",
  Hardware:
    "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=600&fit=crop",
  Startups:
    "https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop",
  Cybersecurity:
    "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=800&h=600&fit=crop",
  Cloud:
    "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&h=600&fit=crop",
  Mobile:
    "https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&h=600&fit=crop",
  Gaming:
    "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&h=600&fit=crop",
  Science:
    "https://images.unsplash.com/photo-1507413245164-6160d8298b31?w=800&h=600&fit=crop",
  Business:
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800&h=600&fit=crop",
  Technology:
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop",
  default:
    "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop",
};

// Validate if a URL is a valid image URL
function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Must start with http/https
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;

  // Reject placeholder URLs
  if (url.includes("placehold") || url.includes("placeholder")) return false;

  // Reject obviously fake/generic URLs
  if (url.includes("example.com") || url.includes("test.com")) return false;

  // Reject data URLs (too long, not real images)
  if (url.startsWith("data:")) return false;

  // Reject very short URLs (likely invalid)
  if (url.length < 20) return false;

  // Check for common image extensions or image hosting domains
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
  ];
  const imageHostDomains = [
    "images.unsplash.com",
    "cdn.",
    "img.",
    "image.",
    "media.",
    "static.",
    "assets.",
    "photos.",
    "i.imgur.com",
    "pbs.twimg.com",
    "techcrunch.com",
    "theverge.com",
    "wired.com",
    "arstechnica.com",
    "cnet.com",
    "zdnet.com",
    "engadget.com",
    "mashable.com",
    "cloudfront.net",
    "amazonaws.com",
    "googleusercontent.com",
  ];

  const hasImageExtension = imageExtensions.some((ext) =>
    url.toLowerCase().includes(ext)
  );
  const isFromImageHost = imageHostDomains.some((domain) =>
    url.toLowerCase().includes(domain)
  );

  return hasImageExtension || isFromImageHost;
}

// Get fallback image based on category
function getFallbackImage(category) {
  return CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES.default;
}

// Validate and fix image URL, with category fallback
function validateAndFixImageUrl(url, category) {
  if (isValidImageUrl(url)) {
    return url;
  }
  return getFallbackImage(category);
}

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

    // Extract and validate images from results
    const extractedImages = [];

    // Get images from the images array
    if (data.images && Array.isArray(data.images)) {
      data.images.forEach((img) => {
        const imgUrl = typeof img === "string" ? img : img?.url;
        if (isValidImageUrl(imgUrl)) {
          extractedImages.push(imgUrl);
        }
      });
    }

    // Also extract images from result items
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach((result) => {
        if (result.image && isValidImageUrl(result.image)) {
          extractedImages.push(result.image);
        }
        if (result.thumbnail && isValidImageUrl(result.thumbnail)) {
          extractedImages.push(result.thumbnail);
        }
      });
    }

    console.log(`[DISCOVER] Extracted ${extractedImages.length} valid images`);

    return {
      results: data.results || [],
      images: extractedImages,
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
async function parseNewsWithRetry(
  searchData,
  today,
  countries = [],
  categories = [],
  maxRetries = 3
) {
  const targetCount = 20;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[DISCOVER] Parsing attempt ${attempt}/${maxRetries}...`);

      // Create a mapping of images to help LLM assign them
      const imageList =
        searchData.images.length > 0
          ? searchData.images.map((img, i) => `${i + 1}. ${img}`).join("\n")
          : "No validated images available - use SKIP_IMAGE as placeholder";

      const countryText =
        countries && countries.length > 0
          ? `specific to ${countries.join(", ")}`
          : "global";
      const categoryText =
        categories && categories.length > 0
          ? `focused on ${categories.join(", ")}`
          : "covering all tech sectors";

      const prompt = `You are a tech news curator. I have performed a web search for today's top tech news (${today}).
The user is interested in news ${countryText} and ${categoryText}.

Here are the search results:
${JSON.stringify(
  searchData.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content?.substring(0, 300),
    image: r.image || null,
  })),
  null,
  2
)}

Here are VALIDATED image URLs you can use (these are confirmed to be real, working images):
${imageList}

Your task is to curate a list of the top ${targetCount} most important and trending technology news stories that match the user's preferences (${countryText}, ${categoryText}).

CRITICAL IMAGE RULES:
1. ONLY use image URLs from the "VALIDATED image URLs" list above OR from the search result's "image" field if present
2. DO NOT invent, guess, or fabricate any image URLs
3. DO NOT use placeholder URLs like placehold.co or placeholder.com
4. If you cannot find a real image for a news item, set imageUrl to "SKIP_IMAGE" (we will replace it with a category-appropriate image later)
5. Each image should only be used ONCE across all news items

For each news item provide:
- A compelling headline/title
- A COMPREHENSIVE, DETAILED description (400-600 words, approximately 2-3 minutes reading time). The description should:
  * Provide thorough background and context about the story
  * Explain the significance and implications of the news
  * Include relevant technical details where appropriate
  * Discuss potential impact on the industry, users, or market
  * Mention any key stakeholders, companies, or individuals involved
  * Cover different perspectives or reactions if available
  * Conclude with what this means for the future or next steps
- The source name (derive from URL domain)
- A REAL image URL from the validated list, or "SKIP_IMAGE" if none available
- A category: AI, Software, Hardware, Startups, Cybersecurity, Cloud, Mobile, Gaming, Science, or Business

Return as a JSON object with a "news" array containing ${targetCount} objects:
{
  "news": [
    {
      "id": "news-1",
      "title": "...",
      "description": "...",
      "source": "...",
      "imageUrl": "<real URL from list or SKIP_IMAGE>",
      "category": "...",
      "publishedAt": "${new Date().toISOString()}"
    }
  ]
}

IMPORTANT: Make sure all ${targetCount} items are UNIQUE. Never fabricate image URLs. Each description MUST be 400-600 words long for a proper 2-3 minute read.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a tech news curator that returns responses in valid JSON format only. Always aim to return exactly 20 unique news items with comprehensive, detailed descriptions (400-600 words each).",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 15000,
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
// Fetch tech news using Web Search + LLM with retry and deduplication
async function fetchTechNewsFromLLM(countries = [], categories = []) {
  const cacheKey = getCacheKey(countries, categories);

  // Initialize cache entry if not exists
  if (!newsCache[cacheKey]) {
    newsCache[cacheKey] = {
      data: [],
      lastUpdated: null,
      isLoading: false,
    };
  }

  console.log(
    `[DISCOVER] Fetching tech news for key: ${cacheKey} (Countries: ${countries}, Categories: ${categories})...`
  );
  newsCache[cacheKey].isLoading = true;

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
    // Different search queries to get diverse results
    const countryStr =
      countries && countries.length > 0 ? `in ${countries.join(" ")}` : "";
    const categoryStr =
      categories && categories.length > 0 ? categories.join(" ") : "technology";

    const searchQueries = [
      `top ${categoryStr} news headlines and stories ${countryStr} ${today}`,
      `latest ${categoryStr} industry news ${countryStr} ${today}`,
      `breaking ${categoryStr} news ${countryStr} ${today}`,
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
        const newsItems = await parseNewsWithRetry(
          searchData,
          today,
          countries,
          categories,
          3
        );

        // Step 3: Normalize and add to collection with image validation
        const normalizedItems = newsItems.map((item, index) => {
          const category = item.category || "Technology";
          let imageUrl = item.imageUrl;

          // Replace SKIP_IMAGE or invalid URLs with category fallback
          if (
            !imageUrl ||
            imageUrl === "SKIP_IMAGE" ||
            !isValidImageUrl(imageUrl)
          ) {
            imageUrl = getFallbackImage(category);
            console.log(
              `[DISCOVER] Using fallback image for: ${item.title?.substring(
                0,
                50
              )}...`
            );
          }

          return {
            id: item.id || `news-${allNewsItems.length + index + 1}`,
            title: item.title || "Untitled",
            description: item.description || item.summary || "",
            source: item.source || "Unknown",
            imageUrl: imageUrl,
            category: category,
            publishedAt: item.publishedAt || new Date().toISOString(),
          };
        });

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
    newsCache[cacheKey].data = allNewsItems;
    newsCache[cacheKey].lastUpdated = new Date();
    newsCache[cacheKey].isLoading = false;

    saveCacheToFile();
    console.log(
      "[DISCOVER] Successfully fetched and cached",
      newsCache[cacheKey].data.length,
      "unique news items for key:",
      cacheKey
    );
    return newsCache[cacheKey].data;
  } catch (error) {
    console.error("[DISCOVER] Error fetching news:", error.message);
    if (newsCache[cacheKey]) {
      newsCache[cacheKey].isLoading = false;
    }
    throw error;
  }
}

// Check if cache needs refresh (older than 24 hours or empty)
// Check if cache needs refresh (older than 24 hours or empty)
function isCacheStale(key = "default") {
  const cacheEntry = newsCache[key];
  if (!cacheEntry || !cacheEntry.lastUpdated || cacheEntry.data.length === 0) {
    return true;
  }
  const now = new Date();
  const lastUpdate = new Date(cacheEntry.lastUpdated);
  const hoursDiff = (now - lastUpdate) / (1000 * 60 * 60);
  return hoursDiff >= 24;
}

// @route   GET /api/discover
// @desc    Get cached tech news
// @access  Public
// @route   GET /api/discover
// @desc    Get cached tech news (default/global)
// @access  Public
router.get("/", async (req, res) => {
  try {
    console.log("[DISCOVER] GET request received (default)");
    const cacheKey = "default";

    // If cache is empty and stale, fetch new data
    if (isCacheStale(cacheKey) && !newsCache[cacheKey]?.isLoading) {
      console.log("[DISCOVER] Cache is stale or empty, fetching fresh data...");
      try {
        await fetchTechNewsFromLLM([], []);
      } catch (fetchError) {
        // If we have old data, return it with a warning
        if (newsCache[cacheKey]?.data?.length > 0) {
          console.log("[DISCOVER] Using stale cache after fetch failure");
          return res.json({
            success: true,
            message: "Returning cached data (refresh failed)",
            data: newsCache[cacheKey].data,
            lastUpdated: newsCache[cacheKey].lastUpdated,
            count: newsCache[cacheKey].data.length,
          });
        }
        throw fetchError;
      }
    }

    // If currently loading, wait a bit and return what we have
    if (newsCache[cacheKey]?.isLoading) {
      console.log("[DISCOVER] News is currently being fetched...");
      return res.json({
        success: true,
        message: "News is being refreshed, please try again shortly",
        data: newsCache[cacheKey]?.data || [],
        lastUpdated: newsCache[cacheKey]?.lastUpdated,
        count: newsCache[cacheKey]?.data?.length || 0,
        isLoading: true,
      });
    }

    res.json({
      success: true,
      data: newsCache[cacheKey]?.data || [],
      lastUpdated: newsCache[cacheKey]?.lastUpdated,
      count: newsCache[cacheKey]?.data?.length || 0,
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

// @route   POST /api/discover/preferences
// @desc    Update user news preferences
// @access  Private
router.post("/preferences", auth, async (req, res) => {
  try {
    const { countries, categories } = req.body;
    const userId = req.user.id;

    // Get current preferences
    const user = await User.findById(userId);
    let preferences = user.preferences || {};

    // Update news preferences
    preferences.news = {
      countries: Array.isArray(countries) ? countries : [],
      categories: Array.isArray(categories) ? categories : [],
    };

    // Save updated preferences
    await User.update(userId, { preferences });

    res.json({
      success: true,
      message: "Preferences updated successfully",
      preferences: preferences.news,
    });
  } catch (error) {
    console.error("[DISCOVER] Error updating preferences:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update preferences",
      error: error.message,
    });
  }
});

// @route   GET /api/discover/custom
// @desc    Get customized news based on user preferences
// @access  Private
router.get("/custom", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    const preferences = user.preferences?.news || {};
    const { countries = [], categories = [] } = preferences;

    console.log(
      `[DISCOVER] GET custom request for user ${userId}. Countries: ${countries}, Categories: ${categories}`
    );

    const cacheKey = getCacheKey(countries, categories);

    // Initialize cache entry if needed
    if (!newsCache[cacheKey]) {
      newsCache[cacheKey] = {
        data: [],
        lastUpdated: null,
        isLoading: false,
      };
    }

    // Check if we need to fetch
    if (isCacheStale(cacheKey) && !newsCache[cacheKey].isLoading) {
      console.log(
        `[DISCOVER] Custom cache stale for key ${cacheKey}, fetching...`
      );
      // Don't await this if you want background fetching, but for first load user probably wants to wait
      // Or we can return empty/stale and let client poll?
      // For now, let's await it so the user gets data immediately
      try {
        await fetchTechNewsFromLLM(countries, categories);
      } catch (err) {
        console.error("[DISCOVER] Failed to fetch custom news:", err.message);
        // Fallback to default if custom fails and we have no data
        if (newsCache[cacheKey].data.length === 0) {
          console.log("[DISCOVER] Falling back to default news");
          return res.json({
            success: true,
            message: "Could not fetch custom news, showing default",
            data: newsCache["default"]?.data || [],
            isFallback: true,
          });
        }
      }
    }

    res.json({
      success: true,
      data: newsCache[cacheKey].data,
      lastUpdated: newsCache[cacheKey].lastUpdated,
      count: newsCache[cacheKey].data.length,
      isLoading: newsCache[cacheKey].isLoading,
    });
  } catch (error) {
    console.error("[DISCOVER] Error fetching custom news:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch custom news",
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
      // Refresh default news
      await fetchTechNewsFromLLM([], []);

      // Note: We could also refresh active custom preferences here if we tracked them

      console.log("[DISCOVER] Daily refresh completed successfully");
    } catch (error) {
      console.error("[DISCOVER] Daily refresh failed:", error.message);
    }
  });

  console.log("[DISCOVER] Cron job scheduled for 6:00 AM daily");

  // If cache is empty or stale on startup, fetch immediately (default only)
  if (isCacheStale("default")) {
    console.log(
      "[DISCOVER] Cache is stale on startup, fetching initial data..."
    );
    fetchTechNewsFromLLM([], []).catch((error) => {
      console.error("[DISCOVER] Initial fetch failed:", error.message);
    });
  }
}

module.exports = router;
module.exports.initDiscoverCron = initDiscoverCron;
