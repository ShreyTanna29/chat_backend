/**
 * Test script for /api/chat/upload-audio endpoint
 *
 * Usage:
 * 1. Start the server: node index.js
 * 2. Run this test: node test-upload-audio.js <path-to-audio-file.3gp>
 *
 * Make sure to replace YOUR_JWT_TOKEN with a valid token
 */

const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const fetch = require("node-fetch");

// Configuration
const SERVER_URL = "http://localhost:3000";
const ENDPOINT = "/api/chat/upload-audio";
const JWT_TOKEN = process.env.JWT_TOKEN || "YOUR_JWT_TOKEN_HERE";

async function testUploadAudio(audioFilePath) {
  try {
    console.log("=== Testing Audio Upload Endpoint ===\n");

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      console.error(`Error: File not found at ${audioFilePath}`);
      process.exit(1);
    }

    const fileStats = fs.statSync(audioFilePath);
    console.log(`File: ${audioFilePath}`);
    console.log(`Size: ${fileStats.size} bytes`);
    console.log(`Extension: ${path.extname(audioFilePath)}\n`);

    // Create form data
    const formData = new FormData();
    formData.append("audio", fs.createReadStream(audioFilePath));

    console.log(`Uploading to: ${SERVER_URL}${ENDPOINT}`);
    console.log("Sending request...\n");

    // Make the request
    const response = await fetch(`${SERVER_URL}${ENDPOINT}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JWT_TOKEN}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);

    const result = await response.json();
    console.log("\n=== Response ===");
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log("\n✅ SUCCESS!");
      console.log(`Original Size: ${result.data.originalSize} bytes`);
      console.log(`Converted Size: ${result.data.convertedSize} bytes`);
      console.log(`Format: ${result.data.format}`);
      console.log(
        `PCM16 Audio (base64) length: ${result.data.pcm16Audio.length} characters`
      );
    } else {
      console.log("\n❌ FAILED!");
      console.log(`Error: ${result.message}`);
    }
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error);
    process.exit(1);
  }
}

// Get audio file path from command line argument
const audioFilePath = process.argv[2];

if (!audioFilePath) {
  console.log("Usage: node test-upload-audio.js <path-to-audio-file>");
  console.log("Example: node test-upload-audio.js ./audio-samples/test.3gp");
  process.exit(1);
}

// Run the test
testUploadAudio(audioFilePath);
