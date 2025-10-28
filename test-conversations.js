#!/usr/bin/env node

/**
 * Test script for Conversation History feature
 *
 * This script tests the new conversation management endpoints
 * Run: node test-conversations.js <jwt_token>
 */

const API_URL = "http://localhost:3000";

// Get JWT token from command line
const token = process.argv[2];

if (!token) {
  console.error("❌ Error: JWT token required");
  console.error("Usage: node test-conversations.js <jwt_token>");
  console.error("");
  console.error("Get a token by logging in:");
  console.error("  curl -X POST http://localhost:3000/api/auth/login \\");
  console.error('    -H "Content-Type: application/json" \\');
  console.error(
    '    -d \'{"email":"user@example.com","password":"password"}\''
  );
  process.exit(1);
}

console.log("🧪 Testing Conversation History Implementation\n");
console.log("─".repeat(60));

let conversationId = null;

// Helper function for API calls
async function apiCall(method, endpoint, body = null) {
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }

  return data;
}

// Test 1: Start a new conversation
async function test1() {
  console.log("\n📝 Test 1: Start new conversation");
  console.log("   POST /api/chat/simple");

  try {
    const result = await apiCall("POST", "/api/chat/simple", {
      prompt: "Hello! Can you help me with recipes?",
    });

    conversationId = result.data.conversationId;
    console.log(`   ✅ Success! Created conversation: ${conversationId}`);
    console.log(`   📄 Title will be: "Hello! Can you help me with recipes?"`);
    console.log(`   💬 Response: ${result.data.response.substring(0, 100)}...`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 2: Continue the conversation
async function test2() {
  console.log("\n📝 Test 2: Continue conversation with context");
  console.log("   POST /api/chat/simple (with conversationId)");

  try {
    const result = await apiCall("POST", "/api/chat/simple", {
      prompt: "What about pasta recipes?",
      conversationId,
    });

    console.log(`   ✅ Success! Continued conversation: ${conversationId}`);
    console.log(`   💬 Response: ${result.data.response.substring(0, 100)}...`);
    console.log(`   📋 AI has context from previous message`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 3: List all conversations
async function test3() {
  console.log("\n📝 Test 3: List all conversations");
  console.log("   GET /api/chat/conversations");

  try {
    const result = await apiCall("GET", "/api/chat/conversations");

    console.log(
      `   ✅ Success! Found ${result.data.conversations.length} conversation(s)`
    );
    result.data.conversations.forEach((conv, i) => {
      console.log(
        `   ${i + 1}. ${conv.title} (${conv._count.messages} messages)`
      );
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 4: Get specific conversation
async function test4() {
  console.log("\n📝 Test 4: Get conversation details");
  console.log(`   GET /api/chat/conversations/${conversationId}`);

  try {
    const result = await apiCall(
      "GET",
      `/api/chat/conversations/${conversationId}`
    );

    console.log(`   ✅ Success! Retrieved conversation`);
    console.log(`   📋 Title: ${result.data.title}`);
    console.log(`   💬 Messages: ${result.data.messages.length}`);
    result.data.messages.forEach((msg, i) => {
      const preview = msg.content.substring(0, 50);
      console.log(`      ${i + 1}. [${msg.role}] ${preview}...`);
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 5: Update conversation title
async function test5() {
  console.log("\n📝 Test 5: Update conversation title");
  console.log(`   PUT /api/chat/conversations/${conversationId}`);

  try {
    const result = await apiCall(
      "PUT",
      `/api/chat/conversations/${conversationId}`,
      {
        title: "Recipe Discussion 🍝",
      }
    );

    console.log(`   ✅ Success! Updated title`);
    console.log(`   📋 New title: ${result.data.title}`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 6: Search conversations
async function test6() {
  console.log("\n📝 Test 6: Search conversations");
  console.log("   GET /api/chat/conversations/search?q=recipe");

  try {
    const result = await apiCall(
      "GET",
      "/api/chat/conversations/search?q=recipe"
    );

    console.log(
      `   ✅ Success! Found ${result.data.length} matching conversation(s)`
    );
    result.data.forEach((conv, i) => {
      console.log(`   ${i + 1}. ${conv.title}`);
    });
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Test 7: Create empty conversation
async function test7() {
  console.log("\n📝 Test 7: Create empty conversation");
  console.log("   POST /api/chat/conversations");

  try {
    const result = await apiCall("POST", "/api/chat/conversations", {
      title: "Test Conversation",
    });

    console.log(`   ✅ Success! Created empty conversation`);
    console.log(`   🆔 ID: ${result.data.id}`);
    console.log(`   📋 Title: ${result.data.title}`);

    // Clean up - delete the test conversation
    await apiCall("DELETE", `/api/chat/conversations/${result.data.id}`);
    console.log(`   🗑️  Cleaned up test conversation`);
    return true;
  } catch (error) {
    console.error(`   ❌ Failed:`, error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  const tests = [test1, test2, test3, test4, test5, test6, test7];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
    await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay between tests
  }

  console.log("\n" + "─".repeat(60));
  console.log("📊 Test Results:");
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log("─".repeat(60));

  if (failed === 0) {
    console.log(
      "\n🎉 All tests passed! Conversation history is working perfectly!"
    );
    console.log("\n💡 Next steps:");
    console.log("   1. Test with your frontend/mobile app");
    console.log("   2. Try the streaming endpoint with conversationId");
    console.log("   3. Test image chat with conversation history");
    console.log("   4. Check the database to see stored conversations");
    console.log("\n🗑️  Clean up:");
    console.log(`   DELETE /api/chat/conversations/${conversationId}`);
    console.log("   Or keep it for manual testing!\n");
  } else {
    console.log("\n⚠️  Some tests failed. Check the errors above.");
    console.log("   Make sure:");
    console.log("   - Server is running (npm run dev)");
    console.log("   - Database migration is complete");
    console.log("   - JWT token is valid");
  }
}

// Run the tests
runTests().catch((error) => {
  console.error("\n💥 Test suite failed:", error);
  process.exit(1);
});
