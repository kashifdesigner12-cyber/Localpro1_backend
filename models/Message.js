
import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    clientMsgId: {
      type: String,
      default: null,
      trim: true,
    },

    text: {
      type: String,
      trim: true,
      default: "",
    },

    priority: {
      type: String,
      enum: ["standard", "important", "urgent"],
      default: "standard",
    },

    attachments: [
      {
        name: {
          type: String,
          default: "",
        },
        path: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          default: "",
        },
        size: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    ],

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        emoji: {
          type: String,
          required: true,
        },
      },
    ],

    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },

    isEdited: {
      type: Boolean,
      default: false,
    },

    editedAt: {
      type: Date,
      default: null,
    },

    isPinned: {
      type: Boolean,
      default: false,
    },

    pinnedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Fast conversation message history.
messageSchema.index({
  conversation: 1,
  createdAt: -1,
  _id: -1,
});

// Fast message history filtering for deleted messages.
messageSchema.index({
  conversation: 1,
  deletedFor: 1,
  createdAt: -1,
});

// Fast duplicate-send / idempotency lookup.
messageSchema.index(
  {
    conversation: 1,
    sender: 1,
    clientMsgId: 1,
  },
  {
    partialFilterExpression: {
      clientMsgId: { $type: "string" },
    },
  }
);

// Fast sender-based message lookups.
messageSchema.index({
  conversation: 1,
  sender: 1,
  createdAt: -1,
});

const Message =
  mongoose.models.Message ||
  mongoose.model("Message", messageSchema);

export default Message;
