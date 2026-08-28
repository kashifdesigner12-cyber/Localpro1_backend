const mongoose = require('mongoose');

const AgentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Agent name is required'],
      trim: true
    },
    role: {
      type: String,
      required: [true, 'Agent role is required'],
      trim: true,
      default: 'Customer Support'
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['voice', 'chat', 'sms', 'email', 'multi-purpose'],
      default: 'chat'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft', 'archived'],
      default: 'active'
    },
    model: {
      type: String,
      default: 'gpt-4'
    },
    systemPrompt: {
      type: String,
      default: ''
    },
    instructions: {
      type: String,
      default: ''
    },
    voice: {
      provider: { type: String, default: 'elevenlabs' },
      voiceId: { type: String, default: 'default' },
      speed: { type: Number, default: 1.0 },
      pitch: { type: Number, default: 1.0 }
    },
    tools: [
      {
        name: { type: String },
        description: { type: String },
        enabled: { type: Boolean, default: true }
      }
    ],
    knowledgeBase: [
      {
        title: { type: String },
        content: { type: String },
        sourceUrl: { type: String }
      }
    ],
    settings: {
      temperature: { type: Number, default: 0.7 },
      maxTokens: { type: Number, default: 1000 },
      greetingMessage: { type: String, default: 'Hello! How can I assist you today?' },
      fallbackMessage: { type: String, default: 'I am not sure about that. Let me connect you with a team member.' },
      transferPhoneNumber: { type: String, default: '' },
      businessHoursOnly: { type: Boolean, default: false }
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    stats: {
      totalConversations: { type: Number, default: 0 },
      totalMessages: { type: Number, default: 0 },
      resolvedQueries: { type: Number, default: 0 },
      transferredCalls: { type: Number, default: 0 },
      averageResponseTimeMs: { type: Number, default: 0 },
      satisfactionScore: { type: Number, default: 100 }
    },
    activity: [
      {
        action: { type: String },
        details: { type: String },
        timestamp: { type: Date, default: Date.now }
      }
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  { timestamps: true }
);

AgentSchema.index({ createdBy: 1, createdAt: -1 });
AgentSchema.index({ status: 1 });
AgentSchema.index({ type: 1 });

module.exports = mongoose.model('Agent', AgentSchema);