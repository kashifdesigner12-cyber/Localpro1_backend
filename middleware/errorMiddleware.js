
import multer from "multer";

const notFound = (req, res, next) => {
  return res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  let statusCode = Number(error.statusCode || error.status) || 500;
  let message = error.message || "Internal server error";

  if (error.name === "ValidationError") {
    statusCode = 400;
    message = error.message;
  } else if (error.name === "CastError") {
    statusCode = 400;
    message = "Invalid resource ID.";
  } else if (error.code === 11000) {
    statusCode = 409;
    message = "A record with this value already exists.";
  } else if (error instanceof multer.MulterError) {
    statusCode = 400;

    if (error.code === "LIMIT_FILE_SIZE") {
      message = "File size cannot exceed 10 MB.";
    } else if (error.code === "LIMIT_FILE_COUNT") {
      message = "Only one file can be uploaded at a time.";
    } else if (error.code === "LIMIT_UNEXPECTED_FILE") {
      message = "Unexpected file field or unsupported file type.";
    } else if (error.code === "LIMIT_FIELD_VALUE") {
      message = "A form field exceeds the allowed size.";
    } else {
      message = "File upload failed. Check the file and try again.";
    }
  }

  if (statusCode < 400 || statusCode > 599) {
    statusCode = 500;
  }

  if (statusCode === 500) {
    console.error("[API ERROR]", {
      method: req.method,
      url: req.originalUrl,
      name: error.name,
      message: error.message,
      stack:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.stack,
    });
  }

  if (process.env.NODE_ENV === "production" && statusCode === 500) {
    message = "Internal server error";
  }

  return res.status(statusCode).json({
    success: false,
    message,
  });
};

export { notFound, errorHandler };
