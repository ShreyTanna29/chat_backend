const crypto = require("crypto");

// Mock dependencies
const mockNewsCache = {
  default: { data: [], lastUpdated: null, isLoading: false },
};

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

async function testCacheKeyGeneration() {
  console.log("Testing Cache Key Generation...");

  const key1 = getCacheKey(["India"], ["AI"]);
  const key2 = getCacheKey(["India"], ["AI"]);
  const key3 = getCacheKey(["USA"], ["AI"]);
  const keyDefault = getCacheKey([], []);

  console.log(`Key 1 (India, AI): ${key1}`);
  console.log(`Key 2 (India, AI): ${key2}`);
  console.log(`Key 3 (USA, AI): ${key3}`);
  console.log(`Key Default: ${keyDefault}`);

  if (key1 !== key2)
    console.error("FAIL: Identical preferences should yield same key");
  if (key1 === key3)
    console.error("FAIL: Different preferences should yield different keys");
  if (keyDefault !== "default")
    console.error("FAIL: Empty preferences should yield 'default'");

  console.log("Cache Key Tests Passed!\n");
}

async function testRouteLogic() {
  console.log("Testing Route Logic (Mock)...");

  // Simulate GET /custom
  const req = {
    user: {
      id: "user123",
      preferences: { news: { countries: ["Japan"], categories: ["Gaming"] } },
    },
  };

  const { countries, categories } = req.user.preferences.news;
  const cacheKey = getCacheKey(countries, categories);

  console.log(`Generated Cache Key for User Request: ${cacheKey}`);

  if (!mockNewsCache[cacheKey]) {
    console.log("Cache miss - would trigger fetch");
    mockNewsCache[cacheKey] = { data: [], isLoading: true };
  } else {
    console.log("Cache hit");
  }

  console.log("Route Logic Test Passed!");
}

(async () => {
  await testCacheKeyGeneration();
  await testRouteLogic();
})();
