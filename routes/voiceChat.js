const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { convertBase64ToPCM16 } = require("../utils/audioConverter");

/**
 * Real-time Voice Chat WebSocket Handler
 * Streams audio bidirectionally between user and OpenAI Realtime API
 */

// Store active sessions
const activeSessions = new Map();

/**
 * Handle client messages and forward to OpenAI
 * @param {Object} message - Parsed JSON message from client
 * @param {WebSocket} openaiWs - WebSocket connection to OpenAI
 * @param {WebSocket} clientWs - WebSocket connection to client
 */
async function handleClientMessage(message, openaiWs, clientWs) {
  // Handle audio data - convert from 3GP/AAC to PCM16 if needed
  if (message.type === "input_audio_buffer.append" && message.audio) {
    console.log(
      `[VOICE-REALTIME] Received audio data length: ${message.audio.length} chars (base64)`
    );

    try {
      // Decode base64 to check the audio format
      const audioBuffer = Buffer.from(message.audio, "base64");
      console.log(
        `[VOICE-REALTIME] Audio buffer size: ${audioBuffer.length} bytes`
      );

      // Check if this looks like it needs conversion (3GP/AAC typically starts with specific bytes)
      // 3GP files start with "ftyp" at offset 4, AAC/M4A similar
      const needsConversion =
        audioBuffer.length > 8 &&
        (audioBuffer.toString("ascii", 4, 8) === "ftyp" ||
          audioBuffer.toString("ascii", 4, 8) === "mdat" ||
          // Check for ADTS AAC header (0xFF 0xF0-0xFF)
          (audioBuffer[0] === 0xff && (audioBuffer[1] & 0xf0) === 0xf0));

      if (needsConversion) {
        console.log("[VOICE-REALTIME] Detected non-PCM16 audio, converting...");
        const pcm16Audio = await convertBase64ToPCM16(message.audio);
        message.audio = pcm16Audio;
        console.log(
          `[VOICE-REALTIME] Converted audio length: ${pcm16Audio.length} chars (base64)`
        );
      } else {
        // Assume it's already PCM16 or compatible format
        console.log(
          "[VOICE-REALTIME] Audio appears to be PCM16, forwarding directly"
        );
      }

      // Validate PCM16 format (should be even number of bytes)
      const finalBuffer = Buffer.from(message.audio, "base64");
      if (finalBuffer.length % 2 !== 0) {
        console.warn(
          `[VOICE-REALTIME] WARNING: Audio buffer size is odd (${finalBuffer.length} bytes) - may not be valid PCM16`
        );
      }
    } catch (e) {
      console.error(`[VOICE-REALTIME] Audio processing error:`, e.message);
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: {
            message: "Audio processing failed",
            details: e.message,
          },
        })
      );
      return;
    }
  }

  // Forward the message to OpenAI
  if (openaiWs.readyState === WebSocket.OPEN) {
    openaiWs.send(JSON.stringify(message));
  } else {
    console.error(
      "[VOICE-REALTIME] OpenAI WebSocket not open, cannot forward message"
    );
    clientWs.send(
      JSON.stringify({
        type: "error",
        error: {
          message: "Connection to AI not ready",
          details: "Please wait for connection to be established",
        },
      })
    );
  }
}

/**
 * Initialize WebSocket server for real-time voice chat
 * @param {http.Server} server - HTTP server instance
 */
function initVoiceChat(server) {
  const wss = new WebSocket.Server({
    server,
    path: "/api/chat/voice-realtime",
  });

  wss.on("connection", async (clientWs, req) => {
    console.log("[VOICE-REALTIME] New client connection attempt");

    // Extract and verify JWT token from query params or headers
    const token = extractToken(req);
    if (!token) {
      console.log("[VOICE-REALTIME] No token provided");
      clientWs.close(4001, "Authentication required");
      return;
    }

    let userId;
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
      console.log(`[VOICE-REALTIME] User ${userId} authenticated`);
    } catch (error) {
      console.log("[VOICE-REALTIME] Invalid token");
      clientWs.close(4001, "Invalid token");
      return;
    }

    // Create session ID
    const sessionId = `${userId}-${Date.now()}`;

    // Connect to OpenAI Realtime API
    const openaiWs = new WebSocket(
      "wss://api.openai.com/v1/realtime?model=gpt-realtime-mini-2025-12-15",
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      }
    );

    // Store session
    activeSessions.set(sessionId, {
      clientWs,
      openaiWs,
      userId,
      startTime: Date.now(),
    });

    // Handle OpenAI WebSocket connection
    openaiWs.on("open", () => {
      console.log(
        `[VOICE-REALTIME] Connected to OpenAI for session ${sessionId}`
      );

      // Configure the session
      // Using the format compatible with gpt-realtime-mini-2025-12-15
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions:
            "You are a helpful AI assistant. Respond in a conversational and friendly tone. Keep responses concise and natural for voice conversation.",
          voice: "alloy",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
          },
          temperature: 0.8,
        },
      };

      console.log(
        `[VOICE-REALTIME] Sending session config:`,
        JSON.stringify(sessionConfig, null, 2)
      );
      openaiWs.send(JSON.stringify(sessionConfig));

      // Send connection success to client
      clientWs.send(
        JSON.stringify({
          type: "session.created",
          sessionId,
          message: "Connected to AI voice chat",
        })
      );
    });

    // Forward messages from client to OpenAI
    clientWs.on("message", async (data) => {
      try {
        // Check if data is binary (Buffer) or text
        if (Buffer.isBuffer(data)) {
          // Binary data - OpenAI Realtime API expects JSON messages, not raw binary
          // Try to decode as UTF-8 and parse as JSON
          try {
            const textData = data.toString("utf8");
            const message = JSON.parse(textData);
            console.log(
              `[VOICE-REALTIME] Parsed binary as JSON message type: ${message.type}`
            );
            // Process the message normally (fall through to JSON handling below)
            await handleClientMessage(message, openaiWs, clientWs);
            return;
          } catch (parseError) {
            // If we can't parse as JSON, it might be raw audio data
            // Convert to base64 and send as input_audio_buffer.append
            console.log(
              `[VOICE-REALTIME] Received binary data (${data.length} bytes) - converting to audio append event`
            );

            // Only process if it looks like valid audio data (more than a few bytes)
            if (data.length > 100) {
              const base64Audio = data.toString("base64");
              const audioEvent = {
                type: "input_audio_buffer.append",
                audio: base64Audio,
              };
              openaiWs.send(JSON.stringify(audioEvent));
            } else {
              console.warn(
                `[VOICE-REALTIME] Ignoring small binary data (${data.length} bytes) - likely not valid audio`
              );
            }
            return;
          }
        }

        // Try to parse as JSON
        const message = JSON.parse(data.toString());
        console.log(`[VOICE-REALTIME] Client message type: ${message.type}`);
        await handleClientMessage(message, openaiWs, clientWs);
      } catch (error) {
        console.error("[VOICE-REALTIME] Error handling client message:", error);
        console.error(
          "[VOICE-REALTIME] Data preview:",
          data.toString().substring(0, 200)
        );
        clientWs.send(
          JSON.stringify({
            type: "error",
            error: {
              message: "Invalid message format",
              details: error.message,
            },
          })
        );
      }
    });

    // Forward messages from OpenAI to client
    openaiWs.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Log important events
        if (
          message.type === "response.audio.delta" ||
          message.type === "response.audio_transcript.delta" ||
          message.type === "response.output_audio.delta"
        ) {
          // Don't log every audio chunk to avoid spam
        } else if (message.type === "error") {
          console.error(
            `[VOICE-REALTIME] OpenAI Error:`,
            JSON.stringify(message, null, 2)
          );
        } else if (
          message.type === "session.created" ||
          message.type === "session.updated"
        ) {
          console.log(`[VOICE-REALTIME] Session event: ${message.type}`);
          console.log(
            `[VOICE-REALTIME] Session config:`,
            JSON.stringify(message.session || message, null, 2)
          );
        } else {
          console.log(`[VOICE-REALTIME] OpenAI message type: ${message.type}`);
        }

        // Forward to client
        clientWs.send(data.toString());
      } catch (error) {
        console.error(
          "[VOICE-REALTIME] Error forwarding OpenAI message:",
          error
        );
      }
    });

    // Handle OpenAI WebSocket errors
    openaiWs.on("error", (error) => {
      console.error(
        `[VOICE-REALTIME] OpenAI WebSocket error for session ${sessionId}:`,
        error
      );
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: {
            message: "OpenAI connection error",
            details: error.message,
          },
        })
      );
    });

    // Handle OpenAI WebSocket close
    openaiWs.on("close", (code, reason) => {
      console.log(
        `[VOICE-REALTIME] OpenAI WebSocket closed for session ${sessionId}: ${code} - ${reason}`
      );
      clientWs.close(1000, "AI connection closed");
      activeSessions.delete(sessionId);
    });

    // Handle client WebSocket errors
    clientWs.on("error", (error) => {
      console.error(
        `[VOICE-REALTIME] Client WebSocket error for session ${sessionId}:`,
        error
      );
    });

    // Handle client WebSocket close
    clientWs.on("close", (code, reason) => {
      console.log(
        `[VOICE-REALTIME] Client disconnected from session ${sessionId}: ${code} - ${reason}`
      );
      if (openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close(1000, "Client disconnected");
      }
      activeSessions.delete(sessionId);
    });
  });

  console.log(
    "[VOICE-REALTIME] WebSocket server initialized at /api/chat/voice-realtime"
  );
  return wss;
}

/**
 * Extract JWT token from request
 * @param {http.IncomingMessage} req - HTTP request
 * @returns {string|null} JWT token or null
 */
function extractToken(req) {
  // Try query parameter first
  const url = new URL(req.url, `http://${req.headers.host}`);
  const tokenFromQuery = url.searchParams.get("token");
  if (tokenFromQuery) {
    console.log(
      "[VOICE-REALTIME][extractToken] Token from query param:",
      tokenFromQuery
    );
    return tokenFromQuery;
  }

  // Try authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    console.log(
      "[VOICE-REALTIME][extractToken] Token from Authorization header:",
      token
    );
    return token;
  }

  // Try sec-websocket-protocol header (some clients use this)
  const protocol = req.headers["sec-websocket-protocol"];
  if (protocol) {
    const protocols = protocol.split(",").map((p) => p.trim());
    for (const p of protocols) {
      if (p.startsWith("bearer.")) {
        const token = p.substring(7);
        console.log(
          "[VOICE-REALTIME][extractToken] Token from sec-websocket-protocol:",
          token
        );
        return token;
      }
    }
  }

  console.log("[VOICE-REALTIME][extractToken] No token found in request");
  return null;
}

/**
 * Get active sessions count
 * @returns {number} Number of active sessions
 */
function getActiveSessionsCount() {
  return activeSessions.size;
}

/**
 * Close all active sessions
 */
function closeAllSessions() {
  console.log(
    `[VOICE-REALTIME] Closing ${activeSessions.size} active sessions`
  );
  for (const [sessionId, session] of activeSessions) {
    session.clientWs.close(1001, "Server shutting down");
    session.openaiWs.close(1001, "Server shutting down");
  }
  activeSessions.clear();
}

module.exports = {
  initVoiceChat,
  getActiveSessionsCount,
  closeAllSessions,
};
