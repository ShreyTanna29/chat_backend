# Quick Start - Real-time Voice Chat

Get up and running with real-time voice chat in 5 minutes!

## Prerequisites

- ✅ Server running (`npm run dev`)
- ✅ OpenAI API key with Realtime API access
- ✅ Modern browser (Chrome, Firefox, Safari, Edge)
- ✅ Microphone access
- ✅ JWT authentication token

## Step 1: Start the Server

```bash
# Install dependencies (if not already done)
npm install

# Start development server
npm run dev
```

You should see:

```
Server is running on port 3000
WebSocket voice chat available at ws://localhost:3000/api/chat/voice-realtime
[VOICE-REALTIME] WebSocket server initialized at /api/chat/voice-realtime
```

## Step 2: Get Authentication Token

### Option A: Using existing user

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "yourpassword"
  }'
```

### Option B: Create new user

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test User",
    "email": "test@example.com",
    "password": "Test123"
  }'
```

Copy the `accessToken` from the response.

## Step 3: Test with Demo Page

1. Open `examples/voiceChatDemo.html` in your browser:

   ```bash
   # If using VS Code
   open examples/voiceChatDemo.html

   # Or just drag and drop the file into your browser
   ```

2. Paste your JWT token in the input field

3. Click **"Connect"**

4. Allow microphone access when prompted

5. Click **"Start Recording"**

6. **Speak naturally** - The AI will respond in real-time!

## Step 4: See It in Action

### Expected Flow:

1. **You**: "Hello, how are you today?"

   - Status shows: 🎤 Listening...
   - Your speech is transcribed and shown

2. **AI**: Responds immediately with voice

   - You hear the AI speaking
   - AI's response is transcribed and shown

3. **Continue** - Just keep talking naturally!
   - No need to press buttons
   - AI detects when you stop speaking
   - Responds automatically

## Using in Your Own Code

### Browser/Frontend

```javascript
// Import the client library
const RealtimeVoiceChat = require("./examples/voiceChatClient");

// Initialize with your JWT token
const voiceChat = new RealtimeVoiceChat("your-jwt-token-here");

// Connect to server
await voiceChat.connect();

// Start recording
await voiceChat.startRecording();

// Listen for AI responses
voiceChat.handleMessage = (message) => {
  if (message.type === "response.audio_transcript.delta") {
    console.log("AI says:", message.delta);
  }
};

// Stop when done
voiceChat.disconnect();
```

### Node.js

```javascript
const WebSocket = require("ws");

const token = "your-jwt-token";
const ws = new WebSocket(
  `ws://localhost:3000/api/chat/voice-realtime?token=${token}`
);

ws.on("open", () => {
  console.log("Connected!");
});

ws.on("message", (data) => {
  const message = JSON.parse(data);
  console.log("Received:", message.type);

  if (message.type === "response.audio_transcript.delta") {
    console.log("AI:", message.delta);
  }
});
```

## Troubleshooting

### Issue: Connection fails with 4001

**Problem**: Invalid or missing JWT token

**Solution**:

- Get a fresh token from `/api/auth/login`
- Ensure token is not expired (default: 1 hour)
- Check token format: Should be a long string starting with `eyJ...`

### Issue: No microphone access

**Problem**: Browser blocked microphone

**Solution**:

- Click the 🔒 icon in browser address bar
- Allow microphone access
- Refresh the page and try again
- Check browser console for permission errors

### Issue: AI not responding

**Problem**: OpenAI API key or connection issue

**Solution**:

- Verify `OPENAI_API_KEY` in `.env`
- Check server logs for errors
- Ensure API key has Realtime API access
- Check OpenAI API status

### Issue: Choppy audio

**Problem**: Network or performance issue

**Solution**:

- Check internet connection
- Close other browser tabs
- Use wired connection if possible
- Check CPU usage

## Testing Tips

### 1. Test Questions

Try these to verify it's working:

- "What's the weather like today?"
- "Tell me a joke"
- "Explain quantum computing in simple terms"
- "What can you help me with?"

### 2. Check Console Logs

Browser console should show:

```
Connected to voice chat
[VOICE-REALTIME] User started speaking
[VOICE-REALTIME] User stopped speaking
[VOICE-REALTIME] AI says: [transcript]
```

Server logs should show:

```
[VOICE-REALTIME] New client connection attempt
[VOICE-REALTIME] User 123 authenticated
[VOICE-REALTIME] Connected to OpenAI for session user123-1234567890
```

### 3. Monitor Network

- Open browser DevTools → Network → WS tab
- Should see persistent WebSocket connection
- Messages flowing bidirectionally

## What's Next?

### Customize AI Behavior

Edit `routes/voiceChat.js` to change:

```javascript
session: {
  instructions: "Custom instructions here...",
  voice: "nova",  // alloy, echo, fable, onyx, nova, shimmer
  temperature: 0.7,
  // ... other settings
}
```

### Integrate into Your App

1. Use the client library in your frontend
2. Style the UI to match your app
3. Add conversation history
4. Implement custom event handlers

### Read the Docs

- **Full Guide**: `VOICE_CHAT_GUIDE.md`
- **Summary**: `REALTIME_VOICE_SUMMARY.md`
- **README**: Updated with WebSocket endpoint docs

## Common Use Cases

### 1. Voice Assistant

```javascript
// Set instructions for assistant mode
instructions: "You are a helpful personal assistant. Be concise and actionable.";
```

### 2. Language Tutor

```javascript
// Configure for language learning
instructions: "You are a friendly language tutor. Correct pronunciation gently and encourage practice.";
```

### 3. Customer Support

```javascript
// Set up for support
instructions: "You are a customer support agent. Be helpful, patient, and professional.";
```

### 4. Interview Coach

```javascript
// Configure for interview practice
instructions: "You are an interview coach. Ask relevant questions and provide constructive feedback.";
```

## Performance Benchmarks

### Expected Latency (Good Connection)

- **Network**: 50-100ms
- **Processing**: 200-400ms
- **Total**: ~300-500ms

### Resource Usage

- **Bandwidth**: ~50 KB/s (upload + download)
- **Memory**: ~20-30 MB per session
- **CPU**: 5-15% (one session)

## Production Deployment

See `VOICE_CHAT_GUIDE.md` for:

- HTTPS/WSS configuration
- SSL certificate setup
- Load balancer configuration
- Nginx proxy setup
- Monitoring and logging

## Support & Resources

- 📖 **Full Documentation**: `VOICE_CHAT_GUIDE.md`
- 📝 **Implementation Summary**: `REALTIME_VOICE_SUMMARY.md`
- 💻 **Client Library**: `examples/voiceChatClient.js`
- 🎨 **Demo Page**: `examples/voiceChatDemo.html`
- 🔧 **Server Code**: `routes/voiceChat.js`

## Need Help?

1. Check browser console for errors
2. Check server logs for issues
3. Review `VOICE_CHAT_GUIDE.md` troubleshooting
4. Test with the demo page first
5. Verify all prerequisites are met

## Enjoy! 🎉

You now have a fully functional real-time voice chat system. Talk naturally with AI and experience the future of human-AI interaction!

---

**Pro Tip**: Keep the browser console open during testing to see real-time logs and debug any issues quickly.
