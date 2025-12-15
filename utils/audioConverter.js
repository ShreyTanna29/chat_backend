const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const { Readable } = require("stream");

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

/**
 * Convert audio buffer (3GP/AAC/any format) to PCM16 WAV at 24kHz
 * @param {Buffer} inputBuffer - Input audio buffer in any format
 * @returns {Promise<Buffer>} - Output audio buffer in PCM16 WAV format at 24kHz
 */
function convertToPCM16(inputBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    // Create a readable stream from the buffer
    const inputStream = new Readable();
    inputStream.push(inputBuffer);
    inputStream.push(null);

    // Convert audio using ffmpeg
    ffmpeg(inputStream)
      .inputFormat("3gp") // Input format - handles 3GP/AAC
      .audioCodec("pcm_s16le") // PCM 16-bit little-endian
      .audioFrequency(24000) // 24kHz sample rate (required by OpenAI)
      .audioChannels(1) // Mono audio
      .format("wav") // WAV container format
      .on("error", (err) => {
        console.error("[AUDIO-CONVERTER] Conversion error:", err);
        reject(err);
      })
      .on("end", () => {
        const outputBuffer = Buffer.concat(chunks);
        console.log(
          `[AUDIO-CONVERTER] Conversion complete. Output size: ${outputBuffer.length} bytes`
        );
        resolve(outputBuffer);
      })
      .pipe()
      .on("data", (chunk) => {
        chunks.push(chunk);
      })
      .on("error", (err) => {
        console.error("[AUDIO-CONVERTER] Stream error:", err);
        reject(err);
      });
  });
}

/**
 * Convert base64 encoded audio to PCM16 WAV
 * @param {string} base64Audio - Base64 encoded audio data
 * @returns {Promise<string>} - Base64 encoded PCM16 WAV audio
 */
async function convertBase64ToPCM16(base64Audio) {
  try {
    // Decode base64 to buffer
    const inputBuffer = Buffer.from(base64Audio, "base64");
    console.log(
      `[AUDIO-CONVERTER] Input buffer size: ${inputBuffer.length} bytes`
    );

    // Convert to PCM16
    const outputBuffer = await convertToPCM16(inputBuffer);

    // Encode back to base64
    const outputBase64 = outputBuffer.toString("base64");
    console.log(
      `[AUDIO-CONVERTER] Output base64 length: ${outputBase64.length} chars`
    );

    return outputBase64;
  } catch (error) {
    console.error("[AUDIO-CONVERTER] Error converting base64 audio:", error);
    throw error;
  }
}

module.exports = {
  convertToPCM16,
  convertBase64ToPCM16,
};
