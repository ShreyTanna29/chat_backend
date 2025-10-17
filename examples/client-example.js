// Example usage of the streaming chat API from Node.js/JavaScript

const EventSource = require("eventsource"); // npm install eventsource

class PerplexChatClient {
  constructor(baseURL = "http://localhost:3000", authToken = null) {
    this.baseURL = baseURL;
    this.authToken = authToken;
  }

  // Login to get auth token
  async login(email, password) {
    try {
      const response = await fetch(`${this.baseURL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        this.authToken = data.data.accessToken;
        return data.data.user;
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  // Stream chat response
  async streamChat(prompt, options = {}) {
    if (!this.authToken) {
      throw new Error("Authentication required. Please login first.");
    }

    const {
      model = "gpt-3.5-turbo",
      temperature = 0.7,
      maxTokens = 1000,
      onChunk = () => {},
      onComplete = () => {},
      onError = () => {},
    } = options;

    return new Promise((resolve, reject) => {
      const requestBody = JSON.stringify({
        prompt,
        model,
        temperature,
        maxTokens,
      });

      // Using fetch for streaming
      fetch(`${this.baseURL}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: requestBody,
      })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullResponse = "";

          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6));

                  switch (data.type) {
                    case "connected":
                      console.log("Stream connected");
                      break;

                    case "chunk":
                      fullResponse += data.content;
                      onChunk(data.content, fullResponse);
                      break;

                    case "done":
                      onComplete(fullResponse, data);
                      resolve(fullResponse);
                      return;

                    case "error":
                      const error = new Error(data.message);
                      onError(error);
                      reject(error);
                      return;
                  }
                } catch (e) {
                  // Ignore invalid JSON
                }
              }
            }
          }
        })
        .catch((error) => {
          onError(error);
          reject(error);
        });
    });
  }

  // Get simple (non-streaming) response
  async getSimpleResponse(prompt, options = {}) {
    if (!this.authToken) {
      throw new Error("Authentication required. Please login first.");
    }

    const {
      model = "gpt-3.5-turbo",
      temperature = 0.7,
      maxTokens = 1000,
    } = options;

    try {
      const response = await fetch(`${this.baseURL}/api/chat/simple`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({
          prompt,
          model,
          temperature,
          maxTokens,
        }),
      });

      const data = await response.json();

      if (data.success) {
        return data.data;
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      throw new Error(`Chat request failed: ${error.message}`);
    }
  }

  // Get chat history
  async getChatHistory(page = 1, limit = 20) {
    if (!this.authToken) {
      throw new Error("Authentication required. Please login first.");
    }

    try {
      const response = await fetch(
        `${this.baseURL}/api/chat/history?page=${page}&limit=${limit}`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
          },
        }
      );

      const data = await response.json();

      if (data.success) {
        return data.data;
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      throw new Error(`Failed to fetch history: ${error.message}`);
    }
  }

  // Clear chat history
  async clearHistory() {
    if (!this.authToken) {
      throw new Error("Authentication required. Please login first.");
    }

    try {
      const response = await fetch(`${this.baseURL}/api/chat/history`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        return true;
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      throw new Error(`Failed to clear history: ${error.message}`);
    }
  }
}

// Example usage
async function example() {
  const client = new PerplexChatClient();

  try {
    // Login
    const user = await client.login("test@example.com", "password123");
    console.log("Logged in as:", user.name);

    // Stream a chat response
    console.log("\n--- Streaming Response ---");
    const prompt = "Explain quantum computing in simple terms";

    await client.streamChat(prompt, {
      onChunk: (chunk, fullResponse) => {
        process.stdout.write(chunk); // Print each chunk as it arrives
      },
      onComplete: (fullResponse, data) => {
        console.log("\n\n--- Stream Complete ---");
        console.log("Finish reason:", data.finish_reason);
      },
      onError: (error) => {
        console.error("Stream error:", error.message);
      },
    });

    // Get chat history
    console.log("\n--- Chat History ---");
    const history = await client.getChatHistory();
    console.log(`Found ${history.history.length} queries in history`);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Uncomment to run example
// example();

module.exports = PerplexChatClient;
