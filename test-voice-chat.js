#!/usr/bin/env node

/**
 * Test script for Real-time Voice Chat
 *
 * This script tests the WebSocket voice chat endpoint
 * Run: node test-voice-chat.js <jwt_token>
 */

const WebSocket = require("ws");

// Get JWT token from command line argument
const token = process.argv[2];

if (!token) {
  console.error("❌ Error: JWT token required");
  console.error("Usage: node test-voice-chat.js <jwt_token>");
  console.error("");
  console.error("Get a token by logging in:");
  console.error("  curl -X POST http://localhost:3000/api/auth/login \\");
  console.error('    -H "Content-Type: application/json" \\');
  console.error(
    '    -d \'{"email":"user@example.com","password":"password"}\''
  );
  process.exit(1);
}

// Configuration
const WS_URL = `ws://localhost:3000/api/chat/voice-realtime?token=${token}`;
const TEST_DURATION = 30000; // 30 seconds

console.log("🎙️  Real-time Voice Chat - Test Script\n");
console.log("─".repeat(50));
console.log(`📡 Connecting to: ${WS_URL}`);
console.log("⏱️  Test duration: 30 seconds");
console.log("─".repeat(50));
console.log("");

// Statistics
const stats = {
  connected: false,
  messagesReceived: 0,
  audioChunksReceived: 0,
  transcriptChunks: 0,
  errors: 0,
  startTime: Date.now(),
};

// Create WebSocket connection
const ws = new WebSocket(WS_URL);

// Connection opened
ws.on("open", () => {
  stats.connected = true;
  console.log("✅ Connected to WebSocket server");
  console.log("⏳ Waiting for session to be created...");
});

// Message received
ws.on("message", (data) => {
  try {
    const message = JSON.parse(data.toString());
    stats.messagesReceived++;

    // Handle different message types
    switch (message.type) {
      case "session.created":
        console.log("✅ Session created:", message.sessionId);
        console.log("📝 You can now send audio or text messages");
        console.log("");
        console.log("Test Commands:");
        console.log("  - Send text message");
        console.log("  - Send audio buffer");
        console.log("  - Request response");
        console.log("");

        // Send a test text message
        console.log('📤 Sending test message: "Hello"');
        ws.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: "Hello, can you hear me?",
                },
              ],
            },
          })
        );

        // Request response
        setTimeout(() => {
          console.log("📤 Requesting AI response...");
          ws.send(
            JSON.stringify({
              type: "response.create",
            })
          );
        }, 500);
        break;

      case "response.audio.delta":
        stats.audioChunksReceived++;
        if (stats.audioChunksReceived === 1) {
          console.log("🔊 Receiving audio from AI...");
        }
        break;

      case "response.audio_transcript.delta":
        stats.transcriptChunks++;
        process.stdout.write(`🤖 AI: ${message.delta}`);
        break;

      case "response.audio_transcript.done":
        console.log("\n✅ AI transcript complete");
        break;

      case "response.done":
        console.log("✅ Response completed");
        console.log("📊 Response stats:", {
          status: message.response?.status,
          tokens: message.response?.usage?.total_tokens,
        });
        console.log("");
        break;

      case "input_audio_buffer.speech_started":
        console.log("🎤 Speech detected (started)");
        break;

      case "input_audio_buffer.speech_stopped":
        console.log("⏸️  Speech detected (stopped)");
        break;

      case "error":
        stats.errors++;
        console.error("❌ Error:", message.error.message);
        if (message.error.details) {
          console.error("   Details:", message.error.details);
        }
        break;

      case "session.updated":
        console.log("✅ Session updated");
        break;

      default:
        console.log(`📨 Message type: ${message.type}`);
    }
  } catch (error) {
    console.error("❌ Error parsing message:", error.message);
    stats.errors++;
  }
});

// Error occurred
ws.on("error", (error) => {
  console.error("❌ WebSocket error:", error.message);
  stats.errors++;
});

// Connection closed
ws.on("close", (code, reason) => {
  const duration = Date.now() - stats.startTime;

  console.log("");
  console.log("─".repeat(50));
  console.log("🔌 Connection closed");
  console.log(`   Code: ${code}`);
  console.log(`   Reason: ${reason || "None"}`);
  console.log("");
  console.log("📊 Test Statistics:");
  console.log("─".repeat(50));
  console.log(`⏱️  Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`📨 Messages received: ${stats.messagesReceived}`);
  console.log(`🔊 Audio chunks: ${stats.audioChunksReceived}`);
  console.log(`📝 Transcript chunks: ${stats.transcriptChunks}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log("─".repeat(50));

  // Exit with appropriate code
  if (code === 1000) {
    console.log("✅ Test completed successfully!");
    process.exit(0);
  } else if (code === 4001) {
    console.error("❌ Authentication failed - check your JWT token");
    process.exit(1);
  } else {
    console.error(`❌ Test failed with code ${code}`);
    process.exit(1);
  }
});

// Auto-close after test duration
setTimeout(() => {
  if (ws.readyState === WebSocket.OPEN) {
    console.log("\n⏰ Test duration reached, closing connection...");
    ws.close(1000, "Test completed");
  }
}, TEST_DURATION);

// Handle process termination
process.on("SIGINT", () => {
  console.log("\n\n⚠️  Test interrupted by user");
  if (ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "User interrupted");
  }
  process.exit(0);
});

// Print instructions
console.log("💡 Tips:");
console.log('  - This test sends a text message "Hello, can you hear me?"');
console.log("  - The AI should respond with voice + transcript");
console.log("  - Press Ctrl+C to stop the test early");
console.log("  - Check server logs for additional debugging info");
console.log("");
