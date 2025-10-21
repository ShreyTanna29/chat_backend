/**
 * Real-time Voice Chat Client Example
 *
 * This example shows how to connect to the WebSocket voice chat endpoint
 * and stream audio bidirectionally with the AI.
 */

// Example 1: Browser-based implementation using Web Audio API
class RealtimeVoiceChat {
  constructor(authToken) {
    this.authToken = authToken;
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.isRecording = false;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect() {
    const wsUrl = `ws://localhost:3000/api/chat/voice-realtime?token=${this.authToken}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Connected to voice chat");
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      console.log("Disconnected from voice chat");
      this.cleanup();
    };
  }

  /**
   * Handle incoming messages from the server
   */
  handleMessage(message) {
    switch (message.type) {
      case "session.created":
        console.log("Session created:", message.sessionId);
        break;

      case "response.audio.delta":
        // Receive audio chunk from AI
        this.playAudio(message.delta);
        break;

      case "response.audio_transcript.delta":
        // Receive transcript of AI response
        console.log("AI says:", message.delta);
        break;

      case "input_audio_buffer.speech_started":
        console.log("User started speaking");
        break;

      case "input_audio_buffer.speech_stopped":
        console.log("User stopped speaking");
        break;

      case "response.done":
        console.log("Response completed");
        break;

      case "error":
        console.error("Error:", message.error);
        break;

      default:
        console.log("Message:", message.type);
    }
  }

  /**
   * Start recording audio from microphone
   */
  async startRecording() {
    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Create audio context
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 24000,
      });

      const source = this.audioContext.createMediaStreamSource(
        this.mediaStream
      );

      // Create script processor for audio data
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (PCM16)
        const pcm16 = this.floatTo16BitPCM(inputData);

        // Send audio data to server
        this.sendAudio(pcm16);
      };

      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.isRecording = true;
      console.log("Recording started");
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  }

  /**
   * Stop recording audio
   */
  stopRecording() {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log("Recording stopped");
  }

  /**
   * Send audio data to the server
   */
  sendAudio(pcm16Data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Convert to base64
      const base64Audio = this.arrayBufferToBase64(pcm16Data.buffer);

      this.ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64Audio,
        })
      );
    }
  }

  /**
   * Play received audio from AI
   */
  playAudio(base64Audio) {
    // Decode base64 to array buffer
    const audioData = this.base64ToArrayBuffer(base64Audio);

    // Convert PCM16 to Float32
    const float32Data = this.pcm16ToFloat32(new Int16Array(audioData));

    // Create audio buffer and play
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: 24000,
      });
    }

    const audioBuffer = this.audioContext.createBuffer(
      1,
      float32Data.length,
      24000
    );
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start();
  }

  /**
   * Convert Float32Array to Int16Array (PCM16)
   */
  floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  /**
   * Convert Int16Array (PCM16) to Float32Array
   */
  pcm16ToFloat32(int16Array) {
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32Array;
  }

  /**
   * Convert ArrayBuffer to base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Send a text message (optional - can also just use audio)
   */
  sendTextMessage(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: text,
              },
            ],
          },
        })
      );

      // Request response
      this.ws.send(
        JSON.stringify({
          type: "response.create",
        })
      );
    }
  }

  /**
   * Cancel ongoing AI response
   */
  cancelResponse() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "response.cancel",
        })
      );
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopRecording();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    this.cleanup();
  }
}

// Example usage:
/*
const authToken = 'your-jwt-token-here';
const voiceChat = new RealtimeVoiceChat(authToken);

// Connect to server
await voiceChat.connect();

// Start recording and streaming audio
await voiceChat.startRecording();

// Stop recording
// voiceChat.stopRecording();

// Send text message (alternative to audio)
// voiceChat.sendTextMessage('Hello, how are you?');

// Disconnect
// voiceChat.disconnect();
*/

// Example 2: Node.js client using WebSocket
/*
const WebSocket = require('ws');
const fs = require('fs');

const authToken = 'your-jwt-token-here';
const ws = new WebSocket(`ws://localhost:3000/api/chat/voice-realtime?token=${authToken}`);

ws.on('open', () => {
  console.log('Connected to voice chat');

  // Send audio file (for testing)
  const audioBuffer = fs.readFileSync('test-audio.pcm');
  const base64Audio = audioBuffer.toString('base64');
  
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.append',
    audio: base64Audio
  }));

  // Commit the audio buffer
  ws.send(JSON.stringify({
    type: 'input_audio_buffer.commit'
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message.type);
  
  if (message.type === 'response.audio.delta') {
    // Save or play audio
    const audioBuffer = Buffer.from(message.delta, 'base64');
    fs.appendFileSync('response-audio.pcm', audioBuffer);
  }
});

ws.on('error', (error) => {
  console.error('Error:', error);
});

ws.on('close', () => {
  console.log('Disconnected');
});
*/

module.exports = RealtimeVoiceChat;
