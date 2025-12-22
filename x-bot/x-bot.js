require("dotenv").config();
const axios = require("axios");

/**
 * Twitter/X Bot that listens for mentions and replies using ChatGPT
 *
 * This bot uses Twitter API v2 to:
 * 1. Monitor mentions of the bot's account
 * 2. Send the tweet text to the ChatGPT endpoint
 * 3. Reply to the tweet with the AI response
 */

// Configuration
const TWITTER_API_BASE = "https://api.twitter.com/2";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const POLL_INTERVAL = parseInt(process.env.TWITTER_POLL_INTERVAL) || 60000; // 60 seconds

// Twitter API credentials (from environment variables)
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;

// Bot credentials for ChatGPT endpoint
const BOT_JWT_TOKEN = process.env.BOT_JWT_TOKEN;

// Twitter Client setup
const OAuth = require("oauth-1.0a");
const crypto = require("crypto");

const oauth = OAuth({
  consumer: {
    key: TWITTER_API_KEY,
    secret: TWITTER_API_SECRET,
  },
  signature_method: "HMAC-SHA1",
  hash_function(base_string, key) {
    return crypto.createHmac("sha1", key).update(base_string).digest("base64");
  },
});

const token = {
  key: TWITTER_ACCESS_TOKEN,
  secret: TWITTER_ACCESS_SECRET,
};

// Store last seen tweet ID to avoid duplicates
let lastSeenId = null;
let processedTweets = new Set();

/**
 * Get bot's user ID using OAuth 1.0a
 */
async function getBotUserId() {
  try {
    const requestData = {
      url: `${TWITTER_API_BASE}/users/me`,
      method: "GET",
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

    const response = await axios.get(requestData.url, {
      headers: {
        ...authHeader,
      },
    });

    return response.data.data.id;
  } catch (error) {
    console.error(
      "[X-BOT] Error getting bot user ID:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Get mentions of the bot using OAuth 1.0a
 */
async function getMentions(userId, sinceId = null) {
  try {
    const params = {
      "tweet.fields": "author_id,created_at,conversation_id",
      expansions: "author_id,referenced_tweets.id",
      "user.fields": "username",
      max_results: 10,
    };

    if (sinceId) {
      params.since_id = sinceId;
    }

    // Build URL with query parameters
    const url = new URL(`${TWITTER_API_BASE}/users/${userId}/mentions`);
    Object.keys(params).forEach((key) =>
      url.searchParams.append(key, params[key])
    );

    const requestData = {
      url: url.toString(),
      method: "GET",
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

    const response = await axios.get(requestData.url, {
      headers: {
        ...authHeader,
      },
    });

    return response.data;
  } catch (error) {
    console.error(
      "[X-BOT] Error fetching mentions:",
      error.response?.data || error.message
    );
    return null;
  }
}

/**
 * Send request to ChatGPT endpoint
 */
async function getChatGPTResponse(prompt) {
  try {
    console.log(`[X-BOT] Sending to ChatGPT: "${prompt.substring(0, 100)}..."`);

    const response = await axios.post(
      `${BACKEND_URL}/api/chat/simple`,
      {
        prompt: prompt,
        model: "gpt-4.1-mini",
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_JWT_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const aiResponse = response.data.data.response;
    console.log(
      `[X-BOT] ChatGPT response (${
        aiResponse.length
      } chars): "${aiResponse.substring(0, 100)}..."`
    );

    return aiResponse;
  } catch (error) {
    console.error(
      "[X-BOT] Error getting ChatGPT response:",
      error.response?.data || error.message
    );
    return "Sorry, I encountered an error processing your request. Please try again later.";
  }
}

/**
 * Post a reply tweet
 */
async function replyToTweet(tweetId, text, authorUsername) {
  try {
    // Truncate response if too long (Twitter limit is 280 chars)
    let replyText = text;
    if (replyText.length > 270) {
      replyText = replyText.substring(0, 267) + "...";
    }

    // Add @mention at the start
    replyText = `@${authorUsername} ${replyText}`;

    const requestData = {
      url: `${TWITTER_API_BASE}/tweets`,
      method: "POST",
    };

    const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

    const response = await axios.post(
      requestData.url,
      {
        text: replyText,
        reply: {
          in_reply_to_tweet_id: tweetId,
        },
      },
      {
        headers: {
          ...authHeader,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`[X-BOT] ✅ Replied to tweet ${tweetId}`);
    return response.data;
  } catch (error) {
    console.error(
      "[X-BOT] ❌ Error posting reply:",
      error.response?.data || error.message
    );
    throw error;
  }
}

/**
 * Process a mention
 */
async function processMention(tweet, author) {
  const tweetId = tweet.id;
  const tweetText = tweet.text;
  const authorUsername = author.username;

  console.log(`[X-BOT] 📬 New mention from @${authorUsername}: "${tweetText}"`);

  // Skip if already processed
  if (processedTweets.has(tweetId)) {
    console.log(`[X-BOT] ⏭️  Already processed tweet ${tweetId}`);
    return;
  }

  // Remove bot mention from the text to get the actual query
  const botMentionRegex = /@\w+/g;
  let cleanedText = tweetText.replace(botMentionRegex, "").trim();

  if (!cleanedText) {
    cleanedText = "Hello! How can I help you?";
  }

  try {
    // Get ChatGPT response
    const aiResponse = await getChatGPTResponse(cleanedText);

    // Reply to the tweet
    await replyToTweet(tweetId, aiResponse, authorUsername);

    // Mark as processed
    processedTweets.add(tweetId);

    // Limit the set size to prevent memory issues
    if (processedTweets.size > 1000) {
      const firstItem = processedTweets.values().next().value;
      processedTweets.delete(firstItem);
    }
  } catch (error) {
    console.error(
      `[X-BOT] Error processing mention ${tweetId}:`,
      error.message
    );
  }
}

/**
 * Main polling loop
 */
async function pollMentions(botUserId) {
  try {
    console.log(
      `[X-BOT] 🔍 Checking for new mentions... (lastSeenId: ${
        lastSeenId || "none"
      })`
    );

    const data = await getMentions(botUserId, lastSeenId);

    if (!data || !data.data || data.data.length === 0) {
      console.log("[X-BOT] No new mentions found.");
      return;
    }

    const mentions = data.data;
    const users = data.includes?.users || [];

    console.log(`[X-BOT] Found ${mentions.length} new mention(s)`);

    // Update lastSeenId to the most recent tweet
    if (mentions.length > 0) {
      lastSeenId = mentions[0].id;
    }

    // Process each mention (in reverse order, oldest first)
    for (let i = mentions.length - 1; i >= 0; i--) {
      const mention = mentions[i];
      const author = users.find((u) => u.id === mention.author_id);

      if (author) {
        await processMention(mention, author);
        // Add a small delay between processing tweets to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    console.error("[X-BOT] Error in polling loop:", error.message);
  }
}

/**
 * Start the bot
 */
async function startBot() {
  console.log("========================================");
  console.log("🤖 Twitter/X Bot Starting...");
  console.log("========================================");

  // Validate environment variables
  if (
    !TWITTER_API_KEY ||
    !TWITTER_API_SECRET ||
    !TWITTER_ACCESS_TOKEN ||
    !TWITTER_ACCESS_SECRET
  ) {
    console.error(
      "❌ Missing Twitter API credentials in environment variables"
    );
    console.error(
      "Required: TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET"
    );
    process.exit(1);
  }

  if (!BOT_JWT_TOKEN) {
    console.error("❌ Missing BOT_JWT_TOKEN in environment variables");
    process.exit(1);
  }

  try {
    // Get bot's user ID
    const botUserId = await getBotUserId();
    console.log(`✅ Bot authenticated. User ID: ${botUserId}`);
    console.log(`🔄 Polling interval: ${POLL_INTERVAL / 1000} seconds`);
    console.log(`🌐 Backend URL: ${BACKEND_URL}`);
    console.log("========================================\n");

    // Start polling
    setInterval(() => pollMentions(botUserId), POLL_INTERVAL);

    // Initial poll
    await pollMentions(botUserId);
  } catch (error) {
    console.error("❌ Failed to start bot:", error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Bot shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Bot shutting down gracefully...");
  process.exit(0);
});

// Start the bot
if (require.main === module) {
  startBot();
}

module.exports = { startBot };
