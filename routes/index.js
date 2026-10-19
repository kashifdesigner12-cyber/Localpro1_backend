const loadRouter = (routePath) => {
  const routeModule = require(routePath);
  if (typeof routeModule === "function") return routeModule;
  if (routeModule && typeof routeModule.router === "function") return routeModule.router;
  if (routeModule && typeof routeModule.default === "function") return routeModule.default;
  throw new TypeError(`Route file ${routePath} does not export an Express router.`);
};

const routesConfig = [
  ["/api/auth", "./authRoutes"],
  ["/api/users", "./userRoutes"],
  ["/api/signup-requests", "./signupRequestRoutes"],
  ["/api/leave-requests", "./leaveRequestRoutes"],
  ["/api/notifications", "./notificationRoutes"],
  ["/api/tasks", "./taskRoutes"],
  ["/api/dashboard", "./dashboardRoutes"],
  ["/api/conversations", "./conversationRoutes"],
  ["/api/messages", "./messageRoutes"],
  ["/api/attendance", "./attendanceRoutes"],
  ["/api/events", "./eventRoutes"],
  ["/api/calendar", "./calendarRoutes"],
  ["/api/appointments", "./eventRoutes"],
  ["/api/calls", "./callRoutes"],
  ["/api/contacts", "./contactRoutes"],
  ["/api/leads", "./contactRoutes"],
  ["/api/emails", "./emailRoutes"],
  ["/api/media", "./mediaRoutes"],
  ["/api/files", "./mediaRoutes"],
  ["/api/campaigns", "./campaignRoutes"],
  ["/api/ai-agents", "./agentRoutes"],
  ["/api/agents", "./agentRoutes"],
  ["/api/analytics", "./analyticsRoutes"],
  ["/api/settings", "./settingsRoutes"],
  ["/api/activity", "./activityRoutes"],
];

function registerRoutes(app) {
  for (const [prefix, relativePath] of routesConfig) {
    app.use(prefix, loadRouter(relativePath));
  }
}

module.exports = registerRoutes;