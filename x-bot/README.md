# Twitter/X Bot for ChatGPT Integration

This bot monitors Twitter/X mentions and automatically replies using your ChatGPT endpoint.

## Features

- ✅ Monitors mentions of your bot account in real-time
- ✅ Sends mention text to ChatGPT endpoint
- ✅ Automatically replies with AI-generated responses
- ✅ Prevents duplicate processing
- ✅ Handles rate limits gracefully
- ✅ Truncates long responses to fit Twitter's character limit

## Setup

### 1. Install Dependencies

```bash
npm install axios oauth-1.0a
```

### 2. Get Twitter API Credentials

1. Go to [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Create a new app (or use existing one)
3. Generate API keys and tokens:
   - API Key
   - API Secret Key
   - Bearer Token
   - Access Token
   - Access Token Secret

**Important:** Enable OAuth 1.0a and set permissions to "Read and Write"

### 3. Create Bot User Account

1. Register or login to your backend at `/api/auth/register` or `/api/auth/login`
2. Copy the JWT token from the response
3. This will be your `BOT_JWT_TOKEN`

### 4. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cd x-bot
cp .env.example .env
```

Edit `.env`:

```env
TWITTER_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAABcde...
TWITTER_API_KEY=abcde123456789
TWITTER_API_SECRET=xyz789xyz789xyz789
TWITTER_ACCESS_TOKEN=1234567890-Abc123
TWITTER_ACCESS_SECRET=def456def456def456
BOT_JWT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
BACKEND_URL=http://localhost:3000
TWITTER_POLL_INTERVAL=60000
```

### 5. Run the Bot

**Development:**

```bash
node x-bot.js
```

**Production (with PM2):**

```bash
npm install -g pm2
pm2 start x-bot.js --name twitter-bot
pm2 save
pm2 startup
```

## Usage

1. Start the bot
2. Mention your bot's Twitter account in a tweet
3. The bot will:
   - Detect the mention
   - Extract the text
   - Send it to ChatGPT
   - Reply to your tweet with the AI response

### Example

**You tweet:**

```
@YourBotHandle What's the capital of France?
```

**Bot replies:**

```
@YourUsername The capital of France is Paris. It's known for the Eiffel Tower, the Louvre Museum, and its rich cultural heritage.
```

## Configuration Options

| Variable                | Default               | Description                                        |
| ----------------------- | --------------------- | -------------------------------------------------- |
| `TWITTER_POLL_INTERVAL` | 60000 (1 min)         | How often to check for new mentions (milliseconds) |
| `BACKEND_URL`           | http://localhost:3000 | Your backend API URL                               |

## Monitoring

The bot logs all activities:

- 🔍 Checking for mentions
- 📬 New mentions detected
- ✅ Successful replies
- ❌ Errors

### Using PM2 (Recommended for Production)

```bash
# View logs
pm2 logs twitter-bot

# Monitor status
pm2 monit

# Restart bot
pm2 restart twitter-bot

# Stop bot
pm2 stop twitter-bot
```

## Rate Limits

Twitter API v2 rate limits:

- **Mentions lookup**: 450 requests per 15 minutes (User Auth)
- **Tweet creation**: 300 requests per 3 hours

The bot handles rate limits by:

- Polling at configurable intervals (default: 1 minute)
- Adding delays between replies (2 seconds)
- Skipping already processed tweets

## Troubleshooting

### "Missing Twitter API credentials"

- Check that all required environment variables are set in `.env`

### "Missing BOT_JWT_TOKEN"

- Create a user account on your backend
- Login and copy the JWT token
- Add it to `.env`

### "Error posting reply"

- Ensure your Twitter app has "Read and Write" permissions
- Regenerate Access Token and Secret after changing permissions

### "Error getting ChatGPT response"

- Verify `BACKEND_URL` is correct
- Check that your backend is running
- Ensure `BOT_JWT_TOKEN` is valid (not expired)

### Bot not detecting mentions

- Check that `TWITTER_BEARER_TOKEN` is valid
- Verify the bot account has been mentioned
- Check logs for errors

## Security Notes

⚠️ **Important:**

- Never commit `.env` file to version control
- Keep API credentials secure
- Rotate credentials regularly
- Monitor bot activity for abuse

## Advanced Usage

### Custom Response Processing

Edit the `getChatGPTResponse` function to:

- Use different models
- Add custom prompts
- Format responses differently

### Multiple Bots

Run multiple instances with different:

- Twitter accounts
- JWT tokens
- Configuration

### Webhook Alternative

For production, consider using Twitter webhooks instead of polling:

- More efficient
- Real-time responses
- Lower API usage

## License

MIT
