# Perplex Backend

A backend API for a Perplexity-like mobile application with user authentication and search capabilities.

## Features

- User registration and authentication
- JWT-based authorization with refresh tokens
- Password hashing with bcrypt
- Input validation
- PostgreSQL database with Sequelize ORM
- RESTful API design
- Error handling middleware

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- npm or yarn

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd perplex-backend
```

2. Install dependencies:

```bash
npm install
```

3. Set up PostgreSQL database:

```sql
-- Connect to PostgreSQL and create database
CREATE DATABASE perplex_backend;
CREATE USER perplex_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE perplex_backend TO perplex_user;
```

4. Set up environment variables:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration:

- Update database connection details (DATABASE*URL or individual DB*\* variables)
- Change the JWT secrets to secure random strings
- Set other configuration as needed

5. Initialize the database:

```bash
npm run db:init
```

6. Start the development server:

```bash
npm run dev
```

## API Endpoints

### Authentication Routes

All authentication routes are prefixed with `/api/auth`

#### POST /api/auth/signup

Register a new user.

**Request Body:**

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:**

```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "isVerified": false,
      "preferences": {
        "theme": "auto",
        "language": "en"
      },
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    },
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

#### POST /api/auth/login

Login with existing credentials.

**Request Body:**

```json
{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "isVerified": false,
      "preferences": {
        "theme": "auto",
        "language": "en"
      },
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    },
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

#### POST /api/auth/refresh

Refresh the access token using a refresh token.

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
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "new_jwt_access_token"
  }
}
```

#### POST /api/auth/logout

Logout user (requires authentication).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "success": true,
  "message": "Logout successful"
}
```

#### GET /api/auth/profile

Get user profile (requires authentication).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "success": true,
  "data": {
    "user": {
      "_id": "user_id",
      "name": "John Doe",
      "email": "john@example.com",
      "isVerified": false,
      "preferences": {
        "theme": "auto",
        "language": "en"
      },
      "searchHistory": [],
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    }
  }
}
```

#### PUT /api/auth/profile

Update user profile (requires authentication).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Request Body:**

```json
{
  "name": "John Smith",
  "preferences": {
    "theme": "dark",
    "language": "es"
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "user": {
      "_id": "user_id",
      "name": "John Smith",
      "email": "john@example.com",
      "isVerified": false,
      "preferences": {
        "theme": "dark",
        "language": "es"
      },
      "searchHistory": [],
      "createdAt": "2023-01-01T00:00:00.000Z",
      "updatedAt": "2023-01-01T00:00:00.000Z"
    }
  }
}
```

### Chat Routes

All chat routes are prefixed with `/api/chat` and require authentication.

#### POST /api/chat/stream

Stream a chat response from ChatGPT (Server-Sent Events).

**Headers:**

```
Authorization: Bearer <access_token>
```

**Request Body:**

```json
{
  "prompt": "Explain quantum computing in simple terms",
  "model": "gpt-3.5-turbo",
  "temperature": 0.7,
  "maxTokens": 1000
}
```

**Response (Server-Sent Events):**

```
data: {"type":"connected","message":"Stream started"}

data: {"type":"chunk","content":"Quantum","timestamp":"2023-01-01T00:00:00.000Z"}

data: {"type":"chunk","content":" computing","timestamp":"2023-01-01T00:00:00.000Z"}

data: {"type":"done","finish_reason":"stop","full_response":"Quantum computing is...","timestamp":"2023-01-01T00:00:00.000Z"}

data: {"type":"close"}
```

#### POST /api/chat/simple

Get a simple (non-streaming) chat response.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Request Body:**

```json
{
  "prompt": "What is machine learning?",
  "model": "gpt-3.5-turbo",
  "temperature": 0.7,
  "maxTokens": 1000
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "prompt": "What is machine learning?",
    "response": "Machine learning is a subset of artificial intelligence...",
    "model": "gpt-3.5-turbo",
    "usage": {
      "prompt_tokens": 5,
      "completion_tokens": 150,
      "total_tokens": 155
    },
    "timestamp": "2023-01-01T00:00:00.000Z"
  }
}
```

#### GET /api/chat/history

Get user's chat/search history with pagination.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Query Parameters:**

- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)

**Response:**

```json
{
  "success": true,
  "data": {
    "history": [
      {
        "query": "What is quantum computing?",
        "timestamp": "2023-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "current_page": 1,
      "per_page": 20,
      "total_items": 1,
      "total_pages": 1
    }
  }
}
```

#### DELETE /api/chat/history

Clear user's chat/search history.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "success": true,
  "message": "Chat history cleared successfully"
}
```

### Health Check

#### GET /health

Check if the server is running.

**Response:**

```json
{
  "message": "Server is running"
}
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error description",
  "errors": [] // Optional, contains validation errors
}
```

Common HTTP status codes:

- `400` - Bad Request (validation errors, user already exists)
- `401` - Unauthorized (invalid credentials, expired token)
- `404` - Not Found (route not found)
- `500` - Internal Server Error

## Password Requirements

- Minimum 6 characters
- Must contain at least one lowercase letter
- Must contain at least one uppercase letter
- Must contain at least one number

## JWT Token Management

- Access tokens expire in 1 hour (configurable)
- Refresh tokens expire in 7 days (configurable)
- Refresh tokens are stored in the user document
- Logout invalidates the refresh token

## Security Features

- Passwords are hashed using bcrypt with salt rounds of 12
- JWT tokens use secure secrets (change in production)
- Input validation using express-validator
- Email normalization
- Sensitive data (password, refresh token) excluded from JSON responses

## Development

To start the development server with hot reload:

```bash
npm run dev
```

To start the production server:

```bash
npm start
```

## Environment Variables

| Variable             | Description                   | Default                                    |
| -------------------- | ----------------------------- | ------------------------------------------ |
| `PORT`               | Server port                   | `3000`                                     |
| `NODE_ENV`           | Environment                   | `development`                              |
| `DATABASE_URL`       | PostgreSQL connection string  | `postgresql://user:pass@localhost:5432/db` |
| `DB_HOST`            | Database host                 | `localhost`                                |
| `DB_PORT`            | Database port                 | `5432`                                     |
| `DB_NAME`            | Database name                 | `perplex_backend`                          |
| `DB_USER`            | Database username             | `postgres`                                 |
| `DB_PASSWORD`        | Database password             | `password`                                 |
| `JWT_SECRET`         | JWT secret for access tokens  | (required)                                 |
| `JWT_EXPIRE`         | Access token expiration       | `1h`                                       |
| `JWT_REFRESH_SECRET` | JWT secret for refresh tokens | (required)                                 |
| `JWT_REFRESH_EXPIRE` | Refresh token expiration      | `7d`                                       |
| `OPENAI_API_KEY`     | OpenAI API key for ChatGPT    | (required)                                 |

## Project Structure

```
perplex-backend/
├── config/
│   └── database.js          # PostgreSQL connection configuration
├── models/
│   └── User.js              # User model with Sequelize schema
├── routes/
│   └── auth.js              # Authentication routes
├── middleware/
│   └── auth.js              # JWT authentication middleware
├── utils/
│   ├── jwt.js               # JWT utility functions
│   └── validation.js        # Input validation schemas
├── scripts/
│   └── init-db.js           # Database initialization script
├── index.js                 # Main server file
├── package.json             # Dependencies and scripts
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Future Enhancements

- Email verification system
- Password reset functionality
- Rate limiting
- API documentation with Swagger
- Unit and integration tests
- Docker containerization
- Search functionality integration
