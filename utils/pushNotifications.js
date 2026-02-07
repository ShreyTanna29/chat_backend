const { Expo } = require("expo-server-sdk");

// Create a new Expo SDK client
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true, // Use FCM API v1
});

/**
 * Validate if a token is a valid Expo push token
 */
function isValidPushToken(token) {
  return Expo.isExpoPushToken(token);
}

/**
 * Send a push notification to a single device
 * @param {string} pushToken - The Expo push token
 * @param {object} notification - The notification object
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {object} notification.data - Additional data to send with the notification
 * @param {string} notification.sound - Sound to play (default: 'default')
 * @param {number} notification.badge - Badge count
 * @param {string} notification.categoryId - Category identifier for notification actions
 * @param {number} notification.priority - Priority (default, normal, high)
 */
async function sendPushNotification(pushToken, notification) {
  try {
    // Check that the push token is valid
    if (!isValidPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      return {
        success: false,
        error: "Invalid push token",
      };
    }

    // Construct the message
    const message = {
      to: pushToken,
      sound: notification.sound || "default",
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      priority: notification.priority || "high",
      channelId: notification.channelId || "reminders",
    };

    // Add optional fields
    if (notification.badge !== undefined) {
      message.badge = notification.badge;
    }

    if (notification.categoryId) {
      message.categoryId = notification.categoryId;
    }

    // Send the push notification
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("Error sending push notification chunk:", error);
      }
    }

    // Check the tickets for errors
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        console.error(
          `Error sending push notification: ${ticket.message}`,
          ticket.details,
        );

        // Handle specific error types
        if (ticket.details && ticket.details.error === "DeviceNotRegistered") {
          return {
            success: false,
            error: "DeviceNotRegistered",
            shouldInvalidateToken: true,
          };
        }

        return {
          success: false,
          error: ticket.message,
        };
      }
    }

    console.log(`Push notification sent successfully to ${pushToken}`);
    return {
      success: true,
      tickets,
    };
  } catch (error) {
    console.error("Error sending push notification:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send push notifications to multiple devices
 * @param {Array} notifications - Array of notification objects with pushToken and notification details
 */
async function sendBatchPushNotifications(notifications) {
  const messages = [];
  const results = [];

  // Validate and prepare messages
  for (const notif of notifications) {
    if (!isValidPushToken(notif.pushToken)) {
      results.push({
        pushToken: notif.pushToken,
        success: false,
        error: "Invalid push token",
      });
      continue;
    }

    messages.push({
      to: notif.pushToken,
      sound: notif.sound || "default",
      title: notif.title,
      body: notif.body,
      data: notif.data || {},
      priority: notif.priority || "high",
      badge: notif.badge,
      categoryId: notif.categoryId,
      channelId: notif.channelId || "reminders",
    });
  }

  // Send notifications in chunks
  try {
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("Error sending batch push notifications:", error);
      }
    }

    // Process tickets
    tickets.forEach((ticket, index) => {
      if (ticket.status === "error") {
        results.push({
          pushToken: messages[index].to,
          success: false,
          error: ticket.message,
          shouldInvalidateToken:
            ticket.details?.error === "DeviceNotRegistered",
        });
      } else {
        results.push({
          pushToken: messages[index].to,
          success: true,
          ticketId: ticket.id,
        });
      }
    });

    return results;
  } catch (error) {
    console.error("Error in batch push notifications:", error);
    throw error;
  }
}

/**
 * Send a reminder notification
 * @param {string} pushToken - User's push token
 * @param {object} reminder - Reminder details
 */
async function sendReminderNotification(pushToken, reminder) {
  return await sendPushNotification(pushToken, {
    title: `🔔 ${reminder.title}`,
    body: reminder.prompt,
    data: {
      type: "reminder",
      reminderId: reminder.id,
      screen: "ReminderDetail",
    },
    sound: "default",
    priority: "high",
    categoryId: "reminder",
    channelId: "reminders",
  });
}

/**
 * Validate push receipt (call this later to check if notification was delivered)
 * @param {Array} receiptIds - Array of receipt IDs from tickets
 */
async function validatePushReceipts(receiptIds) {
  try {
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
    const results = [];

    for (const chunk of receiptIdChunks) {
      try {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);

        for (const receiptId in receipts) {
          const receipt = receipts[receiptId];

          if (receipt.status === "ok") {
            results.push({
              receiptId,
              success: true,
            });
          } else if (receipt.status === "error") {
            console.error(
              `Error in push receipt ${receiptId}:`,
              receipt.message,
              receipt.details,
            );

            results.push({
              receiptId,
              success: false,
              error: receipt.message,
              shouldInvalidateToken:
                receipt.details?.error === "DeviceNotRegistered",
            });
          }
        }
      } catch (error) {
        console.error("Error fetching push receipts:", error);
      }
    }

    return results;
  } catch (error) {
    console.error("Error validating push receipts:", error);
    throw error;
  }
}

module.exports = {
  isValidPushToken,
  sendPushNotification,
  sendBatchPushNotifications,
  sendReminderNotification,
  validatePushReceipts,
};
