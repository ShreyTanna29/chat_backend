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
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",
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
      openaiWs.send(
        JSON.stringify({
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
            },
            temperature: 0.8,
            max_response_output_tokens: 4096,
          },
        })
      );

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
          // Binary data - forward directly to OpenAI
          console.log(
            `[VOICE-REALTIME] Forwarding binary data (${data.length} bytes)`
          );
          openaiWs.send(data);
          return;
        }

        // Try to parse as JSON
        const message = JSON.parse(data.toString());
        console.log(`[VOICE-REALTIME] Client message type: ${message.type}`);

        // Handle audio data - convert from 3GP to PCM16
        if (message.type === "input_audio_buffer.append" && message.audio) {
          console.log(
            `[VOICE-REALTIME] Received 3GP audio data length: ${message.audio.length} chars (base64)`
          );

          try {
            // Convert 3GP/AAC audio to PCM16 WAV at 24kHz
            console.log('[VOICE-REALTIME] Converting 3GP audio to PCM16...');
            const pcm16Audio = await convertBase64ToPCM16(message.audio);
            
            // Replace the audio data with converted PCM16
            message.audio = pcm16Audio;
            
            console.log(
              `[VOICE-REALTIME] Converted audio length: ${pcm16Audio.length} chars (base64)`
            );
            
            // Validate converted audio
            const audioBuffer = Buffer.from(pcm16Audio, "base64");
            console.log(
              `[VOICE-REALTIME] Converted PCM16 size: ${audioBuffer.length} bytes`
            );

            // PCM16 should be even number of bytes (2 bytes per sample)
            if (audioBuffer.length % 2 !== 0) {
              console.warn(
                `[VOICE-REALTIME] WARNING: Audio buffer size is odd - may not be valid PCM16`
              );
            }
          } catch (e) {
            console.error(
              `[VOICE-REALTIME] Audio conversion error:`,
              e.message
            );
            clientWs.send(
              JSON.stringify({
                type: "error",
                error: {
                  message: "Audio conversion failed",
                  details: e.message,
                },
              })
            );
            return;
          }
        }

        // Forward all message types to OpenAI
        // The OpenAI Realtime API will handle all message types appropriately
        openaiWs.send(JSON.stringify(message));
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
          message.type === "response.audio_transcript.delta"
        ) {
          // Don't log every audio chunk to avoid spam
        } else if (message.type === "error") {
          console.error(
            `[VOICE-REALTIME] OpenAI Error:`,
            JSON.stringify(message, null, 2)
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
