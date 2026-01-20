const express = require("express");
const { validationResult } = require("express-validator");
const multer = require("multer");
const User = require("../models/User");
const auth = require("../middleware/auth");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const {
  signupValidation,
  loginValidation,
  refreshTokenValidation,
  googleAuthValidation,
  appleAuthValidation,
} = require("../utils/validation");
const { OAuth2Client } = require("google-auth-library");
const appleSignin = require("apple-signin-auth");
const crypto = require("crypto");
const sendEmail = require("../utils/email");
const { uploadToCloudinary } = require("../utils/cloudinary");

// Configure multer for profile picture uploads
const profilePicUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID_WEB);

const router = express.Router();

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post("/signup", signupValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email",
      });
    }

    // Create new user
    const user = await User.create({
      email,
      password,
      name,
    });

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token to user
    await User.updateRefreshToken(user.id, refreshToken);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post("/login", loginValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { email, password } = req.body;

    // Find user by email (include password for comparison)
    const user = await User.findByEmail(email, { includePassword: true });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check password
    const isMatch = await User.comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token to user
    await User.updateRefreshToken(user.id, refreshToken);

    // Remove password from response
    delete user.password;

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   POST /api/auth/google
// @desc    Google login/signup
// @access  Public
router.post("/google", googleAuthValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { token } = req.body;

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: [
        process.env.GOOGLE_CLIENT_ID_WEB,
        process.env.GOOGLE_CLIENT_ID_IOS,
        process.env.GOOGLE_CLIENT_ID_ANDROID,
      ],
    });
    const payload = ticket.getPayload();
    const { email, name, sub: googleId, picture: avatar } = payload;

    // Check if user exists by Google ID
    let user = await User.findByGoogleId(googleId);

    if (!user) {
      // Check if user exists by email
      user = await User.findByEmail(email);

      if (user) {
        // Link Google ID to existing user and update avatar
        user = await User.update(user.id, {
          googleId,
          avatar: avatar || user.avatar,
        });
      } else {
        // Create new user
        user = await User.create({
          email,
          name,
          googleId,
          avatar,
          isVerified: true, // Google emails are verified
        });
      }
    } else {
      // Update avatar for returning Google users (profile picture may have changed)
      if (avatar && avatar !== user.avatar) {
        user = await User.update(user.id, {
          avatar,
        });
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token to user
    await User.updateRefreshToken(user.id, refreshToken);

    res.json({
      success: true,
      message: "Google login successful",
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid Google token",
    });
  }
});

// @route   POST /api/auth/apple
// @desc    Apple login/signup
// @access  Public
router.post("/apple", appleAuthValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { idToken, name } = req.body;

    // Verify Apple token
    const { email, sub: appleId } = await appleSignin.verifyIdToken(idToken, {
      audience: [
        process.env.APPLE_CLIENT_ID_WEB,
        process.env.APPLE_CLIENT_ID_MOBILE,
      ],
      ignoreExpiration: true, // Sometimes useful for testing, but be careful in prod
    });

    // Check if user exists by Apple ID
    let user = await User.findByAppleId(appleId);

    if (!user) {
      // Check if user exists by email
      user = await User.findByEmail(email);

      if (user) {
        // Link Apple ID to existing user
        user = await User.update(user.id, { appleId });
      } else {
        // Create new user
        // Note: Apple only sends name on first login. Frontend should send it if available.
        // If not provided, we might default to "Apple User" or similar if name is missing.
        const userName = name
          ? `${name.firstName} ${name.lastName}`.trim()
          : "Apple User";

        user = await User.create({
          email,
          name: userName,
          appleId,
          isVerified: true, // Apple emails are verified
        });
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token to user
    await User.updateRefreshToken(user.id, refreshToken);

    res.json({
      success: true,
      message: "Apple login successful",
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("Apple auth error:", error);
    res.status(401).json({
      success: false,
      message: "Invalid Apple token",
    });
  }
});

// @route   POST /api/auth/apple/callback
// @desc    Apple login callback (for form_post)
// @access  Public
router.post("/apple/callback", async (req, res) => {
  try {
    const { id_token, user: userStr } = req.body;

    // Verify Apple token
    const { email, sub: appleId } = await appleSignin.verifyIdToken(id_token, {
      audience: [
        process.env.APPLE_CLIENT_ID_WEB,
        process.env.APPLE_CLIENT_ID_MOBILE,
      ],
      ignoreExpiration: true,
    });

    // Check if user exists by Apple ID
    let user = await User.findByAppleId(appleId);

    if (!user) {
      // Check if user exists by email
      user = await User.findByEmail(email);

      if (user) {
        // Link Apple ID to existing user
        user = await User.update(user.id, { appleId });
      } else {
        // Create new user
        // Apple only sends name on first login in the 'user' field
        let userName = "Apple User";
        if (userStr) {
          try {
            const userData = JSON.parse(userStr);
            if (userData.name) {
              userName =
                `${userData.name.firstName} ${userData.name.lastName}`.trim();
            }
          } catch (e) {
            console.error("Error parsing user data from Apple:", e);
          }
        }

        user = await User.create({
          email,
          name: userName,
          appleId,
          isVerified: true,
        });
      }
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    // Save refresh token to user
    await User.updateRefreshToken(user.id, refreshToken);

    // Redirect to frontend with tokens
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  } catch (error) {
    console.error("Apple callback error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    res.redirect(`${frontendUrl}/auth/callback?error=auth_failed`);
  }
});

// @route   POST /api/auth/refresh
// @desc    Refresh access token
// @access  Public
router.post("/refresh", refreshTokenValidation, async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: errors.array(),
      });
    }

    const { refreshToken } = req.body;

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    // Find user and check if refresh token matches
    const user = await User.findById(decoded.userId, {
      excludePassword: false,
    });
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user.id);

    res.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post("/logout", auth, async (req, res) => {
  try {
    // Clear refresh token
    await User.updateRefreshToken(req.user.id, null);

    res.json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   GET /api/auth/profile
// @desc    Get user profile
// @access  Private
router.get("/profile", auth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put("/profile", auth, async (req, res) => {
  try {
    const { name, preferences } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (preferences) {
      const currentUser = await User.findById(req.user.id);
      updateData.preferences = { ...currentUser.preferences, ...preferences };
    }

    const user = await User.update(req.user.id, updateData);

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   POST /api/auth/profile/picture
// @desc    Upload user profile picture
// @access  Private
router.post(
  "/profile/picture",
  auth,
  profilePicUpload.single("profilePic"),
  async (req, res) => {
    try {
      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image file provided",
        });
      }

      console.log("[PROFILE] Uploading profile picture for user:", req.user.id);

      // Upload to Cloudinary
      const result = await uploadToCloudinary(
        req.file.buffer,
        "perplex/profile_pictures",
        "image",
      );

      console.log("[PROFILE] Cloudinary upload successful:", result.secure_url);

      // Update user's avatar in database
      const updatedUser = await User.update(req.user.id, {
        avatar: result.secure_url,
      });

      res.json({
        success: true,
        message: "Profile picture uploaded successfully",
        data: {
          user: updatedUser,
          imageUrl: result.secure_url,
          publicId: result.public_id,
        },
      });
    } catch (error) {
      console.error("Profile picture upload error:", error);

      // Handle multer errors
      if (error.message === "Only image files are allowed") {
        return res.status(400).json({
          success: false,
          message: "Only image files are allowed",
        });
      }

      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File size exceeds the 5MB limit",
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to upload profile picture",
      });
    }
  },
);

// @route   POST /api/auth/forgot-password
// @desc    Forgot password
// @access  Public
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate OTP
    const resetToken = crypto.randomInt(100000, 999999).toString();
    // Token expires in 10 minutes
    const resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);

    await User.update(user.id, {
      resetPasswordToken: resetToken,
      resetPasswordExpires,
    });

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please use the following OTP to reset your password: \n\n ${resetToken}`;

    try {
      await sendEmail({
        email: user.email,
        subject: "Password Reset Token",
        message,
      });

      res.status(200).json({
        success: true,
        message: "Email sent",
      });
    } catch (error) {
      await User.update(user.id, {
        resetPasswordToken: null,
        resetPasswordExpires: null,
      });
      return res.status(500).json({
        success: false,
        message: "Email could not be sent",
      });
    }
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password
// @access  Public
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    const user = await User.findByEmail(email, { includeResetToken: true });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (
      user.resetPasswordToken !== otp ||
      new Date(user.resetPasswordExpires) < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    await User.update(user.id, {
      password,
      resetPasswordToken: null,
      resetPasswordExpires: null,
    });

    res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
