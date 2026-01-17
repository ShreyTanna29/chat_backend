# Authentication API Documentation

Base URL: `/api/auth`

## Overview

The authentication system supports:

- Email/Password Login & Signup
- Google OAuth
- Apple Sign In
- JWT-based session management (Access Token + Refresh Token)

## Endpoints

### 1. Google Authentication

**POST** `/google`

Exchanges a Google ID token for an app session (Access + Refresh Token).

**Request Body:**

```json
{
  "token": "GOOGLE_ID_TOKEN_FROM_CLIENT"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Google login successful",
  "data": {
    "user": {
      "id": "cuid...",
      "email": "user@gmail.com",
      "name": "User Name",
      "avatar": "https://lh3.googleusercontent.com/...",
      "googleId": "12345...",
      "isVerified": true
    },
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

### 2. Apple Authentication

**POST** `/apple`

Exchanges an Apple ID token for an app session.

**Request Body:**

```json
{
  "idToken": "APPLE_ID_TOKEN_FROM_CLIENT",
  "name": {
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

_Note: The `name` field is optional and only provided by Apple on the very first sign-in. The client should send it if available._

**Response:**

```json
{
  "success": true,
  "message": "Apple login successful",
  "data": {
    "user": {
      "id": "cuid...",
      "email": "user@privaterelay.appleid.com",
      "name": "John Doe",
      "appleId": "000...",
      "isVerified": true
    },
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

### 3. Email Signup

**POST** `/signup`

Registers a new user with email and password.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "Password123",
  "name": "John Doe"
}
```

### 4. Email Login

**POST** `/login`

Logs in a user with email and password.

**Request Body:**

```json
{
  "email": "user@example.com",
  "password": "Password123"
}
```

### 5. Refresh Token

**POST** `/refresh`

Obtains a new access token using a valid refresh token.

**Request Body:**

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "accessToken": "new_jwt_access_token"
  }
}
```

### 6. Logout

**POST** `/logout`

Invalidates the user's refresh token. Requires Authentication header.

**Headers:**
`x-auth-token: <access_token>`

**Response:**

```json
{
  "success": true,
  "message": "Logout successful"
}
```

### 7. Get Profile

**GET** `/profile`

Returns the current user's profile. Requires Authentication header.

**Headers:**
`x-auth-token: <access_token>`

### 8. Update Profile

**PUT** `/profile`

Updates user profile details. Requires Authentication header.

**Request Body:**

```json
{
  "name": "New Name",
  "preferences": {
    "theme": "dark"
  }
}
```

## Notes on Logout

For Google and Apple users, the `/logout` endpoint works identically to email users. It invalidates the backend session (refresh token).

- **Client-Side Action**: The frontend should also discard the stored tokens.
- **Provider Session**: This does **not** log the user out of their Google or Apple account on the device, nor does it revoke the OAuth grant. If you wish to revoke the grant, you must call the respective provider's revocation API from the client or backend, but typically just clearing the local session is sufficient for "logging out" of the app.
