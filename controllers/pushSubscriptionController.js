import PushSubscription from "../models/PushSubscription.js";

export const savePushSubscription = async (req, res, next) => {
  try {
    const subscription = req.body;

    if (
      !subscription?.endpoint ||
      !subscription?.keys?.p256dh ||
      !subscription?.keys?.auth
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid push subscription is required.",
      });
    }

    const saved = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          user: req.user._id,
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? null,
          keys: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
          },
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Push subscription saved.",
      data: { id: saved._id },
    });
  } catch (error) {
    return next(error);
  }
};

export const deletePushSubscription = async (req, res, next) => {
  try {
    const { endpoint } = req.body;

    if (!endpoint || typeof endpoint !== "string") {
      return res.status(400).json({
        success: false,
        message: "Subscription endpoint is required.",
      });
    }

    await PushSubscription.deleteOne({
      user: req.user._id,
      endpoint,
    });

    return res.status(200).json({
      success: true,
      message: "Push subscription removed.",
    });
  } catch (error) {
    return next(error);
  }
};

export default { savePushSubscription, deletePushSubscription };
