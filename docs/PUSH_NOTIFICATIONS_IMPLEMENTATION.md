# Push Notifications Implementation Summary

## Changes Made

### Backend Changes

1. **Database Schema** ([prisma/schema.prisma](prisma/schema.prisma))
   - Added `pushToken` field to the `User` model to store Expo push notification tokens

2. **Dependencies** ([package.json](package.json))
   - Installed `expo-server-sdk` package for sending push notifications

3. **New Utility** ([utils/pushNotifications.js](utils/pushNotifications.js))
   - Created comprehensive push notification service with functions:
     - `isValidPushToken()` - Validate Expo push tokens
     - `sendPushNotification()` - Send push notification to a single device
     - `sendBatchPushNotifications()` - Send to multiple devices
     - `sendReminderNotification()` - Specialized function for reminder notifications
     - `validatePushReceipts()` - Check delivery status

4. **API Endpoints** ([routes/auth.js](routes/auth.js))
   - `POST /api/auth/push-token` - Register/update user's push token
   - `DELETE /api/auth/push-token` - Remove user's push token (on logout)

5. **Reminder Scheduler** ([utils/reminderScheduler.js](utils/reminderScheduler.js))
   - Updated `executeReminder()` function to send push notifications when reminders trigger
   - Automatically invalidates push tokens when devices are no longer registered
   - Falls back gracefully if user has no push token

### Documentation

1. **[PUSH_NOTIFICATIONS_SETUP.md](PUSH_NOTIFICATIONS_SETUP.md)** - Comprehensive setup guide including:
   - Backend setup instructions
   - Frontend integration guide (Expo React Native)
   - API documentation
   - Testing procedures
   - Production considerations
   - Troubleshooting tips

2. **[examples/pushNotificationsUtils.js](examples/pushNotificationsUtils.js)** - Ready-to-use frontend utility with:
   - Permission handling
   - Token registration
   - Notification listeners
   - Complete API integration

3. **[examples/ExpoAppExample.js](examples/ExpoAppExample.js)** - Example React Native components showing:
   - App-level integration
   - Login screen integration
   - Settings screen integration
   - Navigation handling

## Next Steps

### 1. Run Database Migration

```bash
npx prisma migrate dev --name add_push_token
```

This will add the `pushToken` field to your `users` table.

### 2. Optional: Add Expo Access Token

For production use, add to your `.env` file:

```env
EXPO_ACCESS_TOKEN=your_expo_access_token_here
```

Get your token from: https://expo.dev/accounts/[account]/settings/access-tokens

> Note: This is optional. Without it, notifications will still work but with lower rate limits.

### 3. Frontend Integration

1. Install required packages in your Expo app:

   ```bash
   npx expo install expo-notifications expo-device expo-constants
   ```

2. Copy [examples/pushNotificationsUtils.js](examples/pushNotificationsUtils.js) to your frontend project

3. Update the `API_URL` constant with your backend URL

4. Follow the integration examples in [examples/ExpoAppExample.js](examples/ExpoAppExample.js)

5. Update your `app.json` with notification configuration (see [PUSH_NOTIFICATIONS_SETUP.md](PUSH_NOTIFICATIONS_SETUP.md))

### 4. Testing

1. **Test on a physical device** (push notifications don't work on simulators)

2. **Create a test reminder:**

   ```bash
   POST /api/reminders
   {
     "prompt": "Test reminder in 2 minutes",
     "timezone": "America/New_York"
   }
   ```

3. **Check backend logs** to verify push notifications are being sent

4. **Verify on device** that you receive the notification

## Environment Variables

Add these to your `.env` file:

```env
# Required (should already exist)
DATABASE_URL=your_database_url
OPENAI_API_KEY=your_openai_key

# Optional - for higher push notification rate limits
EXPO_ACCESS_TOKEN=your_expo_access_token
```

## API Quick Reference

### Register Push Token

```bash
POST /api/auth/push-token
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

### Remove Push Token

```bash
DELETE /api/auth/push-token
Authorization: Bearer <access_token>
```

## How It Works

1. **User Registration/Login:**
   - Frontend requests notification permissions
   - Gets Expo push token from device
   - Sends token to backend via `POST /api/auth/push-token`
   - Backend stores token in user's record

2. **Reminder Execution:**
   - Cron job triggers reminder at scheduled time
   - Backend fetches user's push token
   - Sends push notification via Expo's service
   - Creates conversation with AI-generated reminder content
   - Updates reminder's last run time

3. **User Receives Notification:**
   - Push notification appears on device
   - Tapping notification opens app to relevant screen
   - Conversation with reminder details is already created

4. **Token Cleanup:**
   - If a device is no longer registered (app uninstalled, etc.)
   - Backend automatically invalidates the push token
   - User will need to re-register on next login

## Benefits

✅ **Real-time notifications** - Users get reminded even when app is closed  
✅ **Reliable delivery** - Uses Expo's proven push notification infrastructure  
✅ **Cross-platform** - Works on both iOS and Android  
✅ **Automatic cleanup** - Invalid tokens are automatically removed  
✅ **Production-ready** - Includes error handling, retry logic, and batching  
✅ **Easy integration** - Complete examples and documentation provided

## Troubleshooting

See the [Troubleshooting section](PUSH_NOTIFICATIONS_SETUP.md#troubleshooting) in the setup guide for common issues and solutions.

## Need Help?

- Check [PUSH_NOTIFICATIONS_SETUP.md](PUSH_NOTIFICATIONS_SETUP.md) for detailed documentation
- Review example code in [examples/](examples/) directory
- Check backend logs for push notification errors
- Verify Expo push token format starts with `ExponentPushToken[`
