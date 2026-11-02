
import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";

let vapidConfigured = false;

const configureVapid = () => {
  if (vapidConfigured) {
    return;
  }

  const {
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
  } = process.env;

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    throw new Error("VAPID environment variables are missing.");
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  vapidConfigured = true;
};

const sendToSubscription = async (subscription, payload) => {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      { TTL: 86400 }
    );

    return { sent: 1, failed: 0 };
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      try {
        await PushSubscription.deleteOne({
          _id: subscription._id,
        });
      } catch (deleteError) {
        console.error(
          "Expired push subscription cleanup failed:",
          deleteError.message
        );
      }
    } else {
      console.error(
        "Push notification failed:",
        error.statusCode || error.message
      );
    }

    return { sent: 0, failed: 1 };
  }
};

export const sendPushToUser = async (userId, payload) => {
  configureVapid();

  const subscriptions = await PushSubscription.find({
    user: userId,
  })
    .select("_id endpoint expirationTime keys")
    .lean();

  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }

  const results = await Promise.all(
    subscriptions.map((subscription) =>
      sendToSubscription(subscription, payload)
    )
  );

  const totals = results.reduce(
    (summary, result) => ({
      sent: summary.sent + result.sent,
      failed: summary.failed + result.failed,
    }),
    { sent: 0, failed: 0 }
  );

  return {
    ...totals,
    total: subscriptions.length,
  };
};

export default sendPushToUser;
