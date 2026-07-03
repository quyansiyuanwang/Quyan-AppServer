import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { createRequestSizeGuard } from "@/middleware/request-size-guard";
import { PayloadTooLargeError } from "@/util/errors";
import { EventEmitter } from "events";

const { warnSpy } = vi.hoisted(() => ({
  warnSpy: vi.fn(),
}));

vi.mock("@/util/logger", () => ({
  LogCategory: { SYSTEM: "SYSTEM" },
  getLogger: () => ({
    warn: warnSpy,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    http: vi.fn(),
  }),
}));

describe("createRequestSizeGuard", () => {
  let mockReq: Request & EventEmitter;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    warnSpy.mockReset();

    mockReq = Object.assign(new EventEmitter(), {
      headers: {},
      path: "/test",
      method: "POST",
      ip: "127.0.0.1",
      removeListener: vi.fn(),
      destroy: vi.fn(),
    }) as unknown as Request & EventEmitter;

    mockRes = {
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    mockNext = vi.fn();
  });

  describe("Content-Length pre-check (Layer 1)", () => {
    it("should reject JSON request exceeding maxJsonBytes via Content-Length", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
        "content-length": String(6 * 1024 * 1024), // 6MB
      };

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(PayloadTooLargeError));
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("should reject multipart request exceeding maxMultipartBytes via Content-Length", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "multipart/form-data; boundary=----WebKitFormBoundary",
        "content-length": String(5 * 1024 * 1024), // 5MB
      };

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(PayloadTooLargeError));
    });

    it("should allow request within limit via Content-Length", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
        "content-length": String(3 * 1024 * 1024), // 3MB
      };

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it("should proceed when Content-Length is missing", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should proceed when Content-Length is invalid", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
        "content-length": "invalid",
      };

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe("Actual byte counting (Layer 2)", () => {
    it("should terminate request when actual bytes exceed limit (forged Content-Length)", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 1024, // 1KB limit
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
        "content-length": "500", // Claims 500 bytes
      };

      guard(mockReq, mockRes as Response, mockNext);

      // Simulate receiving data that exceeds limit
      mockReq.emit("data", Buffer.alloc(600));
      mockReq.emit("data", Buffer.alloc(600)); // Total 1200 bytes > 1024

      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockRes.json).toHaveBeenCalledWith({
        code: 1002,
        message: expect.stringContaining("Request body too large"),
      });
      expect(mockReq.destroy).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should allow request when actual bytes are within limit", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 2048, // 2KB limit
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      guard(mockReq, mockRes as Response, mockNext);

      mockReq.emit("data", Buffer.alloc(1000));
      mockReq.emit("data", Buffer.alloc(500)); // Total 1500 bytes < 2048
      mockReq.emit("end");

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.destroy).not.toHaveBeenCalled();
    });

    it("should handle string chunks correctly", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 100,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      guard(mockReq, mockRes as Response, mockNext);

      mockReq.emit("data", "a".repeat(60));
      mockReq.emit("data", "b".repeat(60)); // Total 120 bytes > 100

      expect(mockRes.status).toHaveBeenCalledWith(413);
      expect(mockReq.destroy).toHaveBeenCalled();
    });

    it("should not send response if headers already sent", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 100,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      mockRes.headersSent = true;

      guard(mockReq, mockRes as Response, mockNext);

      mockReq.emit("data", Buffer.alloc(200));

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
      expect(mockReq.destroy).toHaveBeenCalled();
    });

    it("should attach error listener before destroying request", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 100,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      const onceSpy = vi.spyOn(mockReq, "once");

      guard(mockReq, mockRes as Response, mockNext);

      mockReq.emit("data", Buffer.alloc(200));

      expect(onceSpy).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockReq.destroy).toHaveBeenCalled();
    });

    it("should only terminate once even with multiple chunks", async () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 100,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/json",
      };

      guard(mockReq, mockRes as Response, mockNext);

      mockReq.emit("data", Buffer.alloc(60));
      mockReq.emit("data", Buffer.alloc(60)); // First exceed
      mockReq.emit("data", Buffer.alloc(60)); // Should not trigger again

      expect(mockRes.status).toHaveBeenCalledTimes(1);
      expect(mockReq.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Content-Type resolution", () => {
    it("should use maxOtherBytes for unknown content types", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-type": "application/octet-stream",
        "content-length": String(9 * 1024 * 1024), // 9MB
      };

      guard(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should use maxOtherBytes when content-type is missing", () => {
      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      mockReq.headers = {
        "content-length": String(9 * 1024 * 1024),
      };

      guard(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should warn when attached after request entered flowing mode", () => {
      Object.assign(mockReq, { readableFlowing: true });

      const guard = createRequestSizeGuard({
        maxJsonBytes: 5 * 1024 * 1024,
        maxMultipartBytes: 4 * 1024 * 1024,
        maxOtherBytes: 10 * 1024 * 1024,
      });

      guard(mockReq, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(warnSpy).toHaveBeenCalledWith(
        "RequestSizeGuard attached after request entered flowing mode; early chunks may be missed",
        expect.objectContaining({
          path: "/test",
          method: "POST",
          ip: "127.0.0.1",
        }),
      );
    });
  });
});
