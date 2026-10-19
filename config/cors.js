const ALLOWED_ENV_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "https://localpro1.net",
  "https://www.localpro1.net",
  "https://institute.localpro1.net",
]);

function normalizeOrigin(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function addConfiguredOrigins(value, variableName, setObj) {
  if (!value) return;
  for (const item of value.split(",")) {
    const origin = normalizeOrigin(item);
    if (origin) {
      setObj.add(origin);
      console.log(`[CORS] Configured origin: ${origin}`);
    } else if (item.trim()) {
      console.warn(`[CORS] Invalid URL in ${variableName}`);
    }
  }
}

const allowedOrigins = new Set(ALLOWED_ENV_ORIGINS);
addConfiguredOrigins(process.env.FRONTEND_URL, "FRONTEND_URL", allowedOrigins);
addConfiguredOrigins(process.env.FRONTEND_LOGIN_URL, "FRONTEND_LOGIN_URL", allowedOrigins);

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const normalized = normalizeOrigin(origin);
  if (normalized && allowedOrigins.has(normalized)) {
    return callback(null, true);
  }
  console.warn(`[CORS] Blocked origin: ${origin}`);
  return callback(new Error("Not allowed by CORS"));
}

const corsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"],
  exposedHeaders: ["Content-Disposition"],
  maxAge: 600,
};

const socketCorsOptions = {
  origin: corsOrigin,
  credentials: true,
  methods: ["GET", "POST"],
};

module.exports = { corsOptions, socketCorsOptions, allowedOrigins };