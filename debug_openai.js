require("dotenv").config();
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function test() {
  console.log("Checking for 'responses' API...");
  const useResponsesApi = !!client.responses;
  console.log("client.responses available:", useResponsesApi);

  if (useResponsesApi) {
    console.log("\nTesting client.responses.create streaming...");
    try {
      const stream = await client.responses.create({
        model: "gpt-4o", // Using a known model for test, or try "gpt-5-mini-2025-08-07" if available
        input: "Hello, say 'test' and nothing else.",
        tools: [{ type: "web_search" }],
        stream: true,
      });

      console.log("Stream started. Listening for chunks...");
      for await (const chunk of stream) {
        console.log("Chunk received:", JSON.stringify(chunk, null, 2));
      }
      console.log("Stream finished.");
    } catch (e) {
      console.error("Error with responses API:", e);
    }
  } else {
    console.log("Responses API not available. Skipping test.");
  }

  console.log(
    "\nTesting client.chat.completions.create streaming (Fallback)...",
  );
  try {
    const stream = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Hello, say 'test' and nothing else." },
      ],
      stream: true,
    });

    console.log("Stream started. Listening for chunks...");
    let count = 0;
    for await (const chunk of stream) {
      count++;
      if (count <= 3) {
        console.log("Chunk received:", JSON.stringify(chunk, null, 2));
      }
    }
    console.log("Stream finished.");
  } catch (e) {
    console.error("Error with chat completions:", e);
  }
}

test();
