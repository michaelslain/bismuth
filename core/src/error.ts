/**
 * Unified error class for backend operations with HTTP status codes.
 *
 * Enables precise error categorization: file not found (404), permission denied (403),
 * invalid arguments (400), server errors (500), and domain-specific errors like card
 * lookup failures. The status code allows server.ts to map errors to correct HTTP
 * responses instead of defaulting everything to 400.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    // Maintain prototype chain for instanceof checks.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Common error codes with their default HTTP status codes. */
export const ERROR_CODES = {
  // File system errors
  ENOENT: { code: "ENOENT", statusCode: 404, message: "Not found" },
  EACCES: { code: "EACCES", statusCode: 403, message: "Permission denied" },
  EEXIST: { code: "EEXIST", statusCode: 409, message: "Already exists" },
  EINVAL: { code: "EINVAL", statusCode: 400, message: "Invalid argument" },

  // Validation errors
  PARSE_ERROR: { code: "PARSE_ERROR", statusCode: 400, message: "Parse error" },
  SCHEMA_ERROR: { code: "SCHEMA_ERROR", statusCode: 400, message: "Schema validation failed" },

  // SRS / Cards errors
  CARD_NOT_FOUND: { code: "CARD_NOT_FOUND", statusCode: 404, message: "Card not found" },
  CARD_FORMAT_ERROR: {
    code: "CARD_FORMAT_ERROR",
    statusCode: 400,
    message: "Invalid card format",
  },
  CARD_CONTENT_CHANGED: {
    code: "CARD_CONTENT_CHANGED",
    statusCode: 409,
    message: "Card content changed since it was loaded",
  },

  // Base / Source resolution errors
  BASE_NOT_FOUND: { code: "BASE_NOT_FOUND", statusCode: 404, message: "Base not found" },
  BASE_CYCLE: { code: "BASE_CYCLE", statusCode: 400, message: "Base composition cycle detected" },

  // Generic server errors
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", statusCode: 500, message: "Internal server error" },
};

/**
 * Create an AppError with a predefined code and optional custom message.
 * Falls back to default status code and message for the code if not overridden.
 */
export function createError(
  code: string,
  message?: string,
  statusCode?: number,
): AppError {
  const def = (ERROR_CODES as Record<string, any>)[code];
  return new AppError(
    code,
    message ?? def?.message ?? code,
    statusCode ?? def?.statusCode ?? 400,
  );
}
