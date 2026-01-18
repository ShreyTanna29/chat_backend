# Discover API Documentation

The Discover API provides endpoints for fetching curated technology news articles. It supports both global/default news and personalized news based on user preferences.

## Base URL

```
/api/discover
```

---

## Endpoints Overview

| Method | Endpoint       | Access  | Description                                   |
| ------ | -------------- | ------- | --------------------------------------------- |
| `GET`  | `/`            | Public  | Get default/global tech news                  |
| `GET`  | `/custom`      | Private | Get customized news based on user preferences |
| `POST` | `/preferences` | Private | Update user news preferences                  |

---

## 1. Get Default Tech News

Retrieves cached global technology news articles.

### Request

```http
GET /api/discover
```

**Authentication:** Not required

### Response

#### Success Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "id": "news-1",
      "title": "AI Breakthrough: New Model Achieves Human-Level Performance",
      "description": "Comprehensive description of the news article (400-600 words)...",
      "source": "TechCrunch",
      "imageUrl": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop",
      "category": "AI",
      "publishedAt": "2026-01-19T00:00:00.000Z"
    }
  ],
  "lastUpdated": "2026-01-19T06:00:00.000Z",
  "count": 20
}
```

#### Loading Response (200 OK)

When news is currently being refreshed:

```json
{
  "success": true,
  "message": "News is being refreshed, please try again shortly",
  "data": [],
  "lastUpdated": null,
  "count": 0,
  "isLoading": true
}
```

#### Stale Cache Response (200 OK)

When refresh fails but cached data exists:

```json
{
  "success": true,
  "message": "Returning cached data (refresh failed)",
  "data": [...],
  "lastUpdated": "2026-01-18T06:00:00.000Z",
  "count": 20
}
```

#### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "message": "Failed to fetch tech news",
  "error": "Error message details"
}
```

### Response Fields

| Field         | Type              | Description                                             |
| ------------- | ----------------- | ------------------------------------------------------- |
| `success`     | boolean           | Indicates if the request was successful                 |
| `data`        | array             | Array of news article objects                           |
| `lastUpdated` | string (ISO 8601) | Timestamp of when the cache was last refreshed          |
| `count`       | number            | Total number of news articles returned                  |
| `isLoading`   | boolean           | (Optional) Indicates if news is currently being fetched |
| `message`     | string            | (Optional) Additional status message                    |

---

## 2. Get Customized Tech News

Retrieves personalized technology news based on user's saved preferences (countries and categories).

### Request

```http
GET /api/discover/custom
```

**Authentication:** Required (Bearer Token)

### Headers

```
Authorization: Bearer <jwt_token>
```

### Response

#### Success Response (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "id": "news-1",
      "title": "India's Tech Sector Sees Major Growth in AI Investment",
      "description": "Comprehensive description tailored to user preferences...",
      "source": "Economic Times",
      "imageUrl": "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800&h=600&fit=crop",
      "category": "AI",
      "publishedAt": "2026-01-19T00:00:00.000Z"
    }
  ],
  "lastUpdated": "2026-01-19T06:00:00.000Z",
  "count": 20,
  "isLoading": false
}
```

#### Fallback Response (200 OK)

When custom news fetch fails and no cached data exists:

```json
{
  "success": true,
  "message": "Could not fetch custom news, showing default",
  "data": [...],
  "isFallback": true
}
```

#### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "message": "Failed to fetch custom news",
  "error": "Error message details"
}
```

---

## 3. Update News Preferences

Updates the authenticated user's news preferences for personalized news.

### Request

```http
POST /api/discover/preferences
```

**Authentication:** Required (Bearer Token)

### Headers

```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

### Request Body

```json
{
  "countries": ["India", "USA", "UK"],
  "categories": ["AI", "Startups", "Cybersecurity"]
}
```

### Request Body Parameters

| Parameter    | Type  | Required | Description                          |
| ------------ | ----- | -------- | ------------------------------------ |
| `countries`  | array | No       | List of countries for localized news |
| `categories` | array | No       | List of technology categories        |

### Available Categories

| Category        | Description                                  |
| --------------- | -------------------------------------------- |
| `AI`            | Artificial Intelligence and Machine Learning |
| `Software`      | Software development and updates             |
| `Hardware`      | Hardware innovations and releases            |
| `Startups`      | Startup news and funding                     |
| `Cybersecurity` | Security threats and solutions               |
| `Cloud`         | Cloud computing and services                 |
| `Mobile`        | Mobile technology and apps                   |
| `Gaming`        | Gaming industry news                         |
| `Science`       | Scientific discoveries and research          |
| `Business`      | Tech business and market news                |

### Response

#### Success Response (200 OK)

```json
{
  "success": true,
  "message": "Preferences updated successfully",
  "preferences": {
    "countries": ["India", "USA", "UK"],
    "categories": ["AI", "Startups", "Cybersecurity"]
  }
}
```

#### Error Response (500 Internal Server Error)

```json
{
  "success": false,
  "message": "Failed to update preferences",
  "error": "Error message details"
}
```

---

## News Article Object

Each news article in the response contains the following fields:

| Field         | Type   | Description                                       |
| ------------- | ------ | ------------------------------------------------- |
| `id`          | string | Unique identifier (e.g., "news-1")                |
| `title`       | string | News headline/title                               |
| `description` | string | Comprehensive article description (400-600 words) |
| `source`      | string | Name of the news source                           |
| `imageUrl`    | string | URL to the article's image                        |
| `category`    | string | Technology category (AI, Software, etc.)          |
| `publishedAt` | string | ISO 8601 timestamp of publication                 |

---

## Caching Behavior

- **Cache Duration:** 24 hours
- **Automatic Refresh:** Daily at 6:00 AM
- **Startup Behavior:** If cache is stale on server startup, news is fetched immediately
- **Custom Preferences:** Each unique combination of countries and categories has its own cache entry

---

## Rate Limiting & Performance

- News is fetched using web search (Tavily API) combined with LLM curation (GPT-4o)
- Each fetch retrieves up to 20 unique, deduplicated news articles
- Multiple fetch rounds are performed if needed to reach the target count
- Image URLs are validated; invalid or missing images are replaced with category-appropriate fallbacks

---

## Example Usage

### Get Default News (No Auth Required)

```bash
curl -X GET "https://your-api.com/api/discover"
```

### Get Customized News

```bash
curl -X GET "https://your-api.com/api/discover/custom" \
  -H "Authorization: Bearer <your_jwt_token>"
```

### Update Preferences

```bash
curl -X POST "https://your-api.com/api/discover/preferences" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_jwt_token>" \
  -d '{
    "countries": ["India", "USA"],
    "categories": ["AI", "Startups"]
  }'
```

---

## Error Codes

| Status Code | Description                             |
| ----------- | --------------------------------------- |
| `200`       | Success                                 |
| `401`       | Unauthorized (missing or invalid token) |
| `500`       | Internal Server Error                   |

---

## Fallback Images by Category

When a valid image URL is not available, the API uses high-quality Unsplash fallback images based on the article category:

| Category             | Fallback Image Theme            |
| -------------------- | ------------------------------- |
| AI                   | AI/Neural network visualization |
| Software             | Code/Development environment    |
| Hardware             | Circuit boards/Electronics      |
| Startups             | Office/Business meeting         |
| Cybersecurity        | Security/Shield visualization   |
| Cloud                | Cloud servers/Data center       |
| Mobile               | Smartphones/Mobile devices      |
| Gaming               | Gaming setup/Controllers        |
| Science              | Laboratory/Research             |
| Business             | Corporate buildings/Finance     |
| Technology (default) | General technology workspace    |
