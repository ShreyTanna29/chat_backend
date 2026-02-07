# Push Notifications for Reminders - Setup Guide

This guide explains how to set up push notifications for reminders using Expo's push notification service.

## Backend Setup

### 1. Database Migration

Run the Prisma migration to add the `pushToken` field to the User model:

```bash
npx prisma migrate dev --name add_push_token
```

This adds a `pushToken` field to store each user's Expo push notification token.

### 2. Environment Variables

Add the following optional environment variable to your `.env` file:

```env
# Optional: Expo access token for higher rate limits
EXPO_ACCESS_TOKEN=your_expo_access_token_here
```

> **Note:** The `EXPO_ACCESS_TOKEN` is optional but recommended for production use. Without it, you'll still be able to send notifications but with lower rate limits. Get your access token from https://expo.dev/accounts/[account]/settings/access-tokens

## API Endpoints

### Register Push Token

Register or update a user's push notification token.

**Endpoint:** `POST /api/auth/push-token`

**Headers:**

```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Push token registered successfully"
}
```

### Delete Push Token

Remove a user's push notification token (e.g., on logout).

**Endpoint:** `DELETE /api/auth/push-token`

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "success": true,
  "message": "Push token removed successfully"
}
```

## Frontend Setup (Expo React Native)

### 1. Install Required Packages

```bash
npx expo install expo-notifications expo-device expo-constants
```

### 2. Configure app.json

Add the following to your `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff",
          "sounds": ["./assets/notification-sound.wav"]
        }
      ]
    ],
    "notification": {
      "icon": "./assets/notification-icon.png",
      "color": "#ffffff",
      "androidMode": "default",
      "androidCollapsedTitle": "#{unread_notifications} new reminders"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "useNextNotificationsApi": true
    },
    "ios": {
      "infoPlist": {
        "UIBackgroundModes": ["remote-notification"]
      }
    }
  }
}
```

### 3. Request Permissions and Register Token

Create a utility file for push notifications:

**utils/pushNotifications.js:**

```javascript
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";

// Configure how notifications are displayed when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and get the Expo push token
 */
export async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("reminders", {
      name: "Reminders",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
      sound: "default",
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("Failed to get push token for push notification!");
      return null;
    }

    // Get the token
    token = (
      await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig?.extra?.eas?.projectId,
      })
    ).data;

    console.log("Push token:", token);
  } else {
    console.log("Must use physical device for Push Notifications");
  }

  return token;
}

/**
 * Send the push token to your backend
 */
export async function sendPushTokenToBackend(token, accessToken) {
  try {
    const response = await fetch("YOUR_API_URL/api/auth/push-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ pushToken: token }),
    });

    const data = await response.json();

    if (data.success) {
      console.log("Push token registered successfully");
      return true;
    } else {
      console.error("Failed to register push token:", data.message);
      return false;
    }
  } catch (error) {
    console.error("Error sending push token to backend:", error);
    return false;
  }
}

/**
 * Remove push token from backend (call on logout)
 */
export async function removePushTokenFromBackend(accessToken) {
  try {
    const response = await fetch("YOUR_API_URL/api/auth/push-token", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    return data.success;
  } catch (error) {
    console.error("Error removing push token from backend:", error);
    return false;
  }
}
```

### 4. Integrate in Your App

In your main App component or after user login:

```javascript
import React, { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { registerForPushNotificationsAsync, sendPushTokenToBackend } from './utils/pushNotifications';

export default function App() {
  const notificationListener = useRef();
  const responseListener = useRef();

  useEffect(() => {
    // Register for push notifications
    registerForPushNotificationsAsync().then(token => {
      if (token) {
        // Send token to backend (replace with your auth token)
        sendPushTokenToBackend(token, yourAccessToken);
      }
    });

    // Listen for notifications when app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    // Listen for user interactions with notifications
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);

      const data = response.notification.request.content.data;

      // Handle navigation based on notification data
      if (data.type === 'reminder' && data.reminderId) {
        // Navigate to reminder detail screen
        navigation.navigate('ReminderDetail', { reminderId: data.reminderId });
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  return (
    // Your app components
  );
}
```

### 5. Handle Logout

When the user logs out, remove the push token from the backend:

```javascript
import { removePushTokenFromBackend } from "./utils/pushNotifications";

async function handleLogout() {
  // Remove push token from backend
  await removePushTokenFromBackend(accessToken);

  // Clear local auth data
  // ... your logout logic
}
```

## Notification Payload

When a reminder is triggered, the push notification will contain:

```javascript
{
  title: "🔔 Reminder Title",
  body: "Original reminder prompt",
  data: {
    type: "reminder",
    reminderId: "cuid_of_reminder",
    screen: "ReminderDetail"
  },
  sound: "default",
  priority: "high",
  badge: 1
}
```

## Testing Push Notifications

### 1. Test on Physical Device

Push notifications only work on physical devices, not simulators/emulators.

### 2. Test Reminder Creation

Create a reminder with a schedule that will trigger soon:

```bash
POST /api/reminders
{
  "prompt": "Remind me about the meeting in 2 minutes",
  "timezone": "America/New_York"
}
```

### 3. Monitor Backend Logs

Check your backend logs to see when reminders are executed and push notifications are sent:

```
[REMINDER] Executing reminder xyz123: Daily Stock Updates
[REMINDER] Sending push notification to user abc456
[REMINDER] Push notification sent successfully for reminder xyz123
```

### 4. Check for Errors

Common issues:

- **Invalid push token**: Make sure the token format is correct (starts with `ExponentPushToken[`)
- **Device not registered**: User may have uninstalled the app or revoked permissions
- **Rate limits**: Without `EXPO_ACCESS_TOKEN`, there are stricter rate limits

## Production Considerations

### 1. Set up Expo Access Token

For production, create an access token at https://expo.dev/accounts/[account]/settings/access-tokens and add it to your environment variables.

### 2. Handle Token Invalidation

The backend automatically invalidates push tokens when they're no longer valid (e.g., user uninstalled app). Users will need to re-register their token on next login.

### 3. Notification Channels (Android)

The backend sets the channel ID to `"reminders"` for all reminder notifications. Make sure your frontend creates this channel with appropriate settings.

### 4. Badge Count

Consider implementing badge count management to show the number of unread reminders.

### 5. Background Notifications (iOS)

For iOS, make sure `UIBackgroundModes` includes `"remote-notification"` in your app.json.

## Troubleshooting

### Push notifications not received

1. Verify the user has granted notification permissions
2. Check that the push token was successfully registered on the backend
3. Ensure you're testing on a physical device
4. Check backend logs for push notification errors
5. Verify the reminder schedule is correct and should have triggered

### "Invalid push token" error

Make sure you're getting the token from Expo's push notification API correctly and it starts with `ExponentPushToken[`.

### Rate limiting errors

Add `EXPO_ACCESS_TOKEN` to your environment variables for higher rate limits.

## Additional Resources

- [Expo Push Notifications Guide](https://docs.expo.dev/push-notifications/overview/)
- [Expo Server SDK](https://github.com/expo/expo-server-sdk-node)
- [Notification Channels (Android)](https://docs.expo.dev/versions/latest/sdk/notifications/#managing-notification-channels-android-specific)
