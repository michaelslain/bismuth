import { describe, it, expect } from "bun:test";
import { AppError, createError, ERROR_CODES } from "../src/error";

describe("AppError", () => {
  it("creates an AppError with code, message, and status code", () => {
    const err = new AppError("ENOENT", "File not found", 404);
    expect(err.code).toBe("ENOENT");
    expect(err.message).toBe("File not found");
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe("AppError");
  });

  it("defaults to status code 400 when not provided", () => {
    const err = new AppError("EINVAL", "Invalid argument");
    expect(err.statusCode).toBe(400);
  });

  it("is instanceof Error for catch handlers", () => {
    const err = new AppError("EACCES", "Permission denied", 403);
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AppError).toBe(true);
  });

  it("can be caught as Error", () => {
    let caught: Error | null = null;
    try {
      throw new AppError("EACCES", "Access denied", 403);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught instanceof AppError).toBe(true);
    expect((caught as AppError).code).toBe("EACCES");
  });

  describe("createError", () => {
    it("creates error with predefined code defaults", () => {
      const err = createError("ENOENT");
      expect(err.code).toBe("ENOENT");
      expect(err.message).toBe("Not found");
      expect(err.statusCode).toBe(404);
    });

    it("allows custom message override", () => {
      const err = createError("ENOENT", "Custom file not found message");
      expect(err.code).toBe("ENOENT");
      expect(err.message).toBe("Custom file not found message");
      expect(err.statusCode).toBe(404);
    });

    it("allows custom status code override", () => {
      const err = createError("CARD_NOT_FOUND", undefined, 500);
      expect(err.statusCode).toBe(500);
    });

    it("handles unknown codes with basic defaults", () => {
      const err = createError("UNKNOWN_CODE", "Something happened");
      expect(err.code).toBe("UNKNOWN_CODE");
      expect(err.message).toBe("Something happened");
      expect(err.statusCode).toBe(400);
    });
  });

  describe("ERROR_CODES", () => {
    it("has file system codes", () => {
      expect(ERROR_CODES.ENOENT.statusCode).toBe(404);
      expect(ERROR_CODES.EACCES.statusCode).toBe(403);
      expect(ERROR_CODES.EEXIST.statusCode).toBe(409);
      expect(ERROR_CODES.EINVAL.statusCode).toBe(400);
    });

    it("has SRS error codes", () => {
      expect(ERROR_CODES.CARD_NOT_FOUND.statusCode).toBe(404);
      expect(ERROR_CODES.CARD_FORMAT_ERROR.statusCode).toBe(400);
      expect(ERROR_CODES.CARD_CONTENT_CHANGED.statusCode).toBe(409);
    });

    it("has base error codes", () => {
      expect(ERROR_CODES.BASE_NOT_FOUND.statusCode).toBe(404);
      expect(ERROR_CODES.BASE_CYCLE.statusCode).toBe(400);
    });
  });
});
