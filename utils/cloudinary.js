const cloudinary = require("cloudinary").v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a file buffer to Cloudinary
 * @param {Buffer} buffer - The file buffer
 * @param {string} folder - The folder to upload to
 * @param {string} resourceType - 'image', 'video', 'raw', or 'auto'
 * @param {Object} options - Additional upload options
 * @returns {Promise<Object>} - The Cloudinary upload result
 */
const uploadToCloudinary = (
  buffer,
  folder = "perplex/uploads",
  resourceType = "auto",
  options = {}
) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: resourceType,
        type: "upload", // Ensures the file is publicly accessible
        access_mode: "public", // Explicitly set public access
        ...options,
      },
      (error, result) => {
        if (error) {
          console.error("[CLOUDINARY] Upload error:", error);
          return reject(error);
        }
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
};
