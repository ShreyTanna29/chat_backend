# Profile Picture API Documentation

This document details the profile picture functionality in the authentication system.

---

## 1. Profile Picture Upload Endpoint

### `POST /api/auth/profile/picture`

Allows authenticated users to upload a custom profile picture.

**Authentication:** Required (Bearer token)

**Headers:**

```
Authorization: Bearer <access_token>
Content-Type: multipart/form-data
```

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profilePic` | File | Yes | Image file (JPEG, PNG, GIF, etc.) |

**Constraints:**

- Max file size: **5MB**
- Allowed types: Images only (`image/*`)

**Success Response (200):**

```json
{
  "success": true,
  "message": "Profile picture uploaded successfully",
  "data": {
    "user": {
      "id": "cuid...",
      "email": "user@example.com",
      "name": "John Doe",
      "avatar": "https://res.cloudinary.com/...",
      "isVerified": true,
      "searchHistory": [],
      "preferences": {},
      "createdAt": "2026-01-20T00:00:00.000Z",
      "updatedAt": "2026-01-20T00:00:00.000Z"
    },
    "imageUrl": "https://res.cloudinary.com/.../image.jpg",
    "publicId": "perplex/profile_pictures/abc123"
  }
}
```

**Error Responses:**

| Status | Message                          |
| ------ | -------------------------------- |
| 400    | No image file provided           |
| 400    | Only image files are allowed     |
| 400    | File size exceeds the 5MB limit  |
| 401    | Not authenticated                |
| 500    | Failed to upload profile picture |

---

## 2. Social Login Profile Pictures

### Google Login (`POST /api/auth/google`)

Google Sign-In automatically captures the user's Google profile picture.

**Behavior:**

- **New users:** Avatar is set from Google profile picture
- **Existing users (by email):** Links Google ID and updates avatar if provided by Google
- **Returning Google users:** Avatar is refreshed on each login (in case the user changed their Google profile picture)

The `avatar` field is included in the user object returned on successful login.

### Apple Login (`POST /api/auth/apple`)

> [!NOTE]
> Apple Sign-In does **not** provide profile pictures. This is an Apple platform limitation.

Users who sign in with Apple will have a `null` avatar initially. They can upload a custom profile picture using the upload endpoint above.

---

## 3. Storage

All profile pictures are stored in **Cloudinary** under the folder:

```
perplex/profile_pictures/
```

---

## 4. Example Usage

### Upload Profile Picture (cURL)

```bash
curl -X POST https://your-api.com/api/auth/profile/picture \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "profilePic=@/path/to/image.jpg"
```

### Upload Profile Picture (JavaScript/Fetch)

```javascript
const formData = new FormData();
formData.append("profilePic", imageFile);

const response = await fetch("/api/auth/profile/picture", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
  body: formData,
});

const result = await response.json();
console.log(result.data.user.avatar); // New avatar URL
```

---

## 5. Related Endpoints

| Endpoint                    | Method | Description                                |
| --------------------------- | ------ | ------------------------------------------ |
| `/api/auth/profile`         | GET    | Get current user profile (includes avatar) |
| `/api/auth/profile`         | PUT    | Update profile (name, preferences)         |
| `/api/auth/profile/picture` | POST   | Upload profile picture                     |
| `/api/auth/google`          | POST   | Google login (auto-fetches avatar)         |
| `/api/auth/apple`           | POST   | Apple login (no avatar provided)           |
