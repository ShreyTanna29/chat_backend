# Real-time Voice Chat Implementation Guide

## Overview

The real-time voice chat feature enables live, bidirectional voice conversations between users and AI using WebSocket and OpenAI's Realtime API. This provides a natural, low-latency conversation experience similar to talking with another person.

## Architecture

### Components

1. **WebSocket Server** (`routes/voiceChat.js`)

   - Handles WebSocket connections
   - Authenticates users via JWT
   - Manages sessions between client and OpenAI

2. **OpenAI Realtime API**

   - Model: `gpt-4o-realtime-preview-2024-10-01`
   - Supports bidirectional audio streaming
   - Built-in Voice Activity Detection (VAD)
   - Real-time transcription

3. **Client Library** (`examples/voiceChatClient.js`)
   - Browser-based implementation
   - Uses Web Audio API for audio capture/playback
   - Handles audio format conversion

## How It Works

```
User Microphone → Web Audio API → PCM16 → Base64 → WebSocket
                                                      ↓
                                            Server (Auth & Proxy)
                                                      ↓
                                              OpenAI Realtime API
                                                      ↓
AI Response (Audio) ← PCM16 ← Base64 ← WebSocket ← Server
       ↓
  Audio Playback
```

### Flow

1. **Connection**

   - Client connects to WebSocket with JWT token
   - Server validates token and creates session
   - Server establishes connection to OpenAI Realtime API
   - Both connections remain open for bidirectional streaming

2. **Audio Streaming (User → AI)**

   - Client captures audio from microphone (Web Audio API)
   - Audio converted to PCM16 format
   - Encoded as base64 and sent via WebSocket
   - Server forwards to OpenAI
   - OpenAI's VAD detects speech start/stop
   - OpenAI processes and generates response

3. **Audio Streaming (AI → User)**
   - OpenAI generates audio response in real-time
   - Server receives base64 PCM16 audio chunks
   - Server forwards chunks to client
   - Client decodes and plays audio immediately
   - Provides transcript alongside audio

## Setup

### Prerequisites

- Node.js 14+
- WebSocket support (`ws` package - already installed)
- OpenAI API key with Realtime API access
- HTTPS in production (required for microphone access)

### Environment Variables

Add to `.env`:

```env
OPENAI_API_KEY=your_openai_api_key_here
JWT_SECRET=your_jwt_secret_here
```

### Server Configuration

The WebSocket server is automatically initialized in `index.js`:

```javascript
const { initVoiceChat, closeAllSessions } = require("./routes/voiceChat");

// Initialize WebSocket server
initVoiceChat(server);

// Cleanup on shutdown
process.on("SIGINT", async () => {
  closeAllSessions();
  await prisma.$disconnect();
  process.exit(0);
});
```

## Usage

### Client-Side Implementation

#### 1. Basic Connection

```javascript
const RealtimeVoiceChat = require("./examples/voiceChatClient");

const authToken = "your-jwt-token";
const voiceChat = new RealtimeVoiceChat(authToken);

// Connect to server
await voiceChat.connect();
```

#### 2. Start Recording

```javascript
// Start streaming audio from microphone
await voiceChat.startRecording();

// AI will respond automatically as you speak
```

#### 3. Stop Recording

```javascript
voiceChat.stopRecording();
```

#### 4. Handle Events

```javascript
voiceChat.handleMessage = (message) => {
  switch (message.type) {
    case "session.created":
      console.log("Connected!");
      break;

    case "response.audio.delta":
      // AI is speaking (audio chunk received)
      break;

    case "response.audio_transcript.delta":
      console.log("AI says:", message.delta);
      break;

    case "input_audio_buffer.speech_started":
      console.log("User started speaking");
      break;

    case "input_audio_buffer.speech_stopped":
      console.log("User stopped speaking");
      break;

    case "response.done":
      console.log("AI finished responding");
      break;

    case "error":
      console.error("Error:", message.error);
      break;
  }
};
```

#### 5. Disconnect

```javascript
voiceChat.disconnect();
```

### Testing with Demo Page

1. Start the server:

   ```bash
   npm run dev
   ```

2. Get a JWT token (login via `/api/auth/login`)

3. Open `examples/voiceChatDemo.html` in a browser

4. Enter your JWT token and click "Connect"

5. Click "Start Recording" and speak naturally

6. The AI will respond in real-time!

## Audio Format

### Input (User → AI)

- **Format**: PCM16 (16-bit Linear PCM)
- **Sample Rate**: 24000 Hz
- **Channels**: Mono (1 channel)
- **Encoding**: Base64 over WebSocket

### Output (AI → User)

- **Format**: PCM16 (16-bit Linear PCM)
- **Sample Rate**: 24000 Hz
- **Channels**: Mono (1 channel)
- **Encoding**: Base64 over WebSocket

## Message Protocol

### Client → Server Messages

#### 1. Append Audio Buffer

```json
{
  "type": "input_audio_buffer.append",
  "audio": "<base64_pcm16_audio>"
}
```

#### 2. Commit Audio Buffer

```json
{
  "type": "input_audio_buffer.commit"
}
```

#### 3. Send Text Message (Alternative)

```json
{
  "type": "conversation.item.create",
  "item": {
    "type": "message",
    "role": "user",
    "content": [
      {
        "type": "input_text",
        "text": "Hello, how are you?"
      }
    ]
  }
}
```

#### 4. Request Response

```json
{
  "type": "response.create"
}
```

#### 5. Cancel Response

```json
{
  "type": "response.cancel"
}
```

### Server → Client Messages

#### 1. Session Created

```json
{
  "type": "session.created",
  "sessionId": "user123-1234567890",
  "message": "Connected to AI voice chat"
}
```

#### 2. Audio Delta (AI Speaking)

```json
{
  "type": "response.audio.delta",
  "delta": "<base64_pcm16_audio>",
  "response_id": "resp_123",
  "item_id": "item_456",
  "output_index": 0,
  "content_index": 0
}
```

#### 3. Audio Transcript Delta

```json
{
  "type": "response.audio_transcript.delta",
  "delta": "Hello, how can I help you today?",
  "response_id": "resp_123",
  "item_id": "item_456",
  "output_index": 0,
  "content_index": 0
}
```

#### 4. Speech Started

```json
{
  "type": "input_audio_buffer.speech_started",
  "audio_start_ms": 1500,
  "item_id": "item_789"
}
```

#### 5. Speech Stopped

```json
{
  "type": "input_audio_buffer.speech_stopped",
  "audio_end_ms": 3200,
  "item_id": "item_789"
}
```

#### 6. Response Done

```json
{
  "type": "response.done",
  "response": {
    "id": "resp_123",
    "status": "completed",
    "usage": {
      "total_tokens": 150,
      "input_tokens": 50,
      "output_tokens": 100
    }
  }
}
```

#### 7. Error

```json
{
  "type": "error",
  "error": {
    "message": "Error description",
    "details": "Additional details"
  }
}
```

## Session Configuration

Default configuration (set in `routes/voiceChat.js`):

```javascript
{
  modalities: ["text", "audio"],
  instructions: "You are a helpful AI assistant. Respond in a conversational and friendly tone.",
  voice: "alloy",  // Options: alloy, echo, fable, onyx, nova, shimmer
  input_audio_format: "pcm16",
  output_audio_format: "pcm16",
  input_audio_transcription: {
    model: "whisper-1"
  },
  turn_detection: {
    type: "server_vad",      // Voice Activity Detection
    threshold: 0.5,          // 0.0 to 1.0
    prefix_padding_ms: 300,  // Audio before speech
    silence_duration_ms: 500 // Silence to end speech
  },
  temperature: 0.8,
  max_response_output_tokens: 4096
}
```

### Customization

To change voice or other settings, modify the `session.update` message in `routes/voiceChat.js`:

```javascript
openaiWs.send(
  JSON.stringify({
    type: "session.update",
    session: {
      voice: "nova", // Change voice
      temperature: 0.7, // Adjust creativity
      // ... other settings
    },
  })
);
```

## Authentication

Three methods to pass JWT token:

### 1. Query Parameter (Recommended)

```javascript
const ws = new WebSocket(
  "ws://localhost:3000/api/chat/voice-realtime?token=YOUR_JWT_TOKEN"
);
```

### 2. Authorization Header

```javascript
const ws = new WebSocket("ws://localhost:3000/api/chat/voice-realtime", {
  headers: {
    Authorization: "Bearer YOUR_JWT_TOKEN",
  },
});
```

### 3. WebSocket Protocol

```javascript
const ws = new WebSocket(
  "ws://localhost:3000/api/chat/voice-realtime",
  "bearer.YOUR_JWT_TOKEN"
);
```

## Error Handling

### Common Errors

1. **4001 - Authentication Required**

   - No token provided
   - Invalid or expired token
   - Solution: Ensure valid JWT token is sent

2. **OpenAI Connection Error**

   - Invalid API key
   - API rate limit exceeded
   - Network issues
   - Solution: Check API key and network connectivity

3. **Audio Format Error**
   - Incorrect audio format
   - Invalid base64 encoding
   - Solution: Ensure PCM16 format and proper encoding

### Error Recovery

```javascript
ws.onerror = (error) => {
  console.error("WebSocket error:", error);
  // Attempt reconnection after delay
  setTimeout(() => {
    reconnect();
  }, 5000);
};

ws.onclose = (event) => {
  if (event.code === 4001) {
    console.error("Authentication failed");
    // Refresh token and reconnect
  } else {
    // Normal close or unexpected disconnect
    console.log("Connection closed:", event.reason);
  }
};
```

## Best Practices

### 1. Handle Microphone Permissions

```javascript
try {
  await voiceChat.startRecording();
} catch (error) {
  if (error.name === "NotAllowedError") {
    alert("Please allow microphone access");
  }
}
```

### 2. Implement Reconnection Logic

```javascript
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

function reconnect() {
  if (reconnectAttempts < maxReconnectAttempts) {
    reconnectAttempts++;
    console.log(`Reconnecting... Attempt ${reconnectAttempts}`);
    voiceChat.connect();
  }
}
```

### 3. Clean Up Resources

```javascript
window.addEventListener("beforeunload", () => {
  if (voiceChat) {
    voiceChat.disconnect();
  }
});
```

### 4. Monitor Session Health

```javascript
setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN) {
    console.warn("Connection lost, attempting reconnect");
    reconnect();
  }
}, 10000);
```

### 5. Optimize Audio Buffer Size

```javascript
// Adjust buffer size based on latency requirements
this.processor = this.audioContext.createScriptProcessor(
  2048, // Smaller = lower latency, higher CPU
  1, // Input channels
  1 // Output channels
);
```

## Performance Considerations

### Latency

- **Network Latency**: 50-200ms (depends on location)
- **Processing Latency**: 200-500ms (OpenAI API)
- **Total Round-trip**: ~300-700ms

### Bandwidth

- **Upload**: ~24 KB/s (PCM16 @ 24kHz)
- **Download**: ~24 KB/s + overhead
- **Recommended**: 100+ KB/s connection

### Resource Usage

- **CPU**: Moderate (audio processing)
- **Memory**: ~10-50 MB per session
- **Battery**: High (continuous audio processing)

## Production Deployment

### Requirements

1. **HTTPS/WSS**

   ```javascript
   // Production WebSocket URL
   wss://your-domain.com/api/chat/voice-realtime?token=JWT_TOKEN
   ```

2. **SSL Certificate**

   - Required for microphone access in browsers
   - Use Let's Encrypt or commercial certificate

3. **Environment Variables**

   ```env
   NODE_ENV=production
   OPENAI_API_KEY=sk-...
   JWT_SECRET=your-secure-secret
   PORT=443
   ```

4. **Load Balancing**

   - Use sticky sessions for WebSocket
   - Configure nginx/ALB for WebSocket support

5. **Monitoring**
   - Track active sessions
   - Monitor latency and errors
   - Log usage for billing

### Nginx Configuration

```nginx
upstream backend {
    server localhost:3000;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/chat/voice-realtime {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
}
```

## Troubleshooting

### Issue: No audio playback

**Solution:**

1. Check browser console for errors
2. Verify audio format (PCM16, 24kHz)
3. Test audio context creation
4. Check speaker volume/output device

### Issue: AI not responding

**Solution:**

1. Verify OpenAI API key is valid
2. Check API rate limits
3. Ensure audio buffer is committed
4. Review server logs for errors

### Issue: High latency

**Solution:**

1. Reduce audio buffer size
2. Check network connection
3. Use server closer to user
4. Optimize audio processing

### Issue: Choppy audio

**Solution:**

1. Increase buffer size
2. Check CPU usage
3. Reduce other network activity
4. Use wired connection if possible

## Monitoring & Analytics

### Track Active Sessions

```javascript
const { getActiveSessionsCount } = require("./routes/voiceChat");

setInterval(() => {
  console.log("Active sessions:", getActiveSessionsCount());
}, 60000);
```

### Log Usage

```javascript
// In voiceChat.js, add logging
console.log(`[VOICE-REALTIME] Session ${sessionId} started - User: ${userId}`);
console.log(
  `[VOICE-REALTIME] Session ${sessionId} ended - Duration: ${duration}ms`
);
```

## Future Enhancements

- [ ] Multi-language support
- [ ] Custom voice selection per user
- [ ] Conversation history persistence
- [ ] Recording/playback of conversations
- [ ] Screen sharing with voice
- [ ] Multi-party voice chat
- [ ] Sentiment analysis
- [ ] Real-time translation

## Support

For issues or questions:

1. Check OpenAI Realtime API documentation
2. Review server logs
3. Test with demo page
4. Check browser console

## References

- [OpenAI Realtime API Docs](https://platform.openai.com/docs/guides/realtime)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
