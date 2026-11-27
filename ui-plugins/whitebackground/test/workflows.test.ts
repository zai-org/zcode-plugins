import { describe, expect, it } from "vitest";
import { KitError } from "../src/kit/workspace.ts";
import { MAX_PIXELS, MAX_SIDE, WORKFLOW_IDS, assertDimensions, canvasUrl, workflowOf } from "../src/workflows.ts";

describe("assertDimensions", () => {
  it("accepts valid sizes", () => {
    expect(assertDimensions(1, 1)).toEqual({ width: 1, height: 1 });
    expect(assertDimensions(2048, 2048)).toEqual({ width: 2048, height: 2048 });
    expect(assertDimensions(8192, 1)).toEqual({ width: 8192, height: 1 });
  });

  it("rejects non-integers, zero, oversize sides, and over 32MP", () => {
    expect(() => assertDimensions(1.5, 10)).toThrow(KitError);
    expect(() => assertDimensions(0, 10)).toThrow(/1 and 8192/);
    expect(() => assertDimensions(MAX_SIDE + 1, 1)).toThrow(/1 and 8192/);
    expect(() => assertDimensions(8192, 8192)).toThrow(KitError);
    try {
      assertDimensions(8192, 8192);
    } catch (error) {
      expect((error as KitError).code).toBe("too_many_pixels");
    }
    expect(() => assertDimensions(Math.floor(Math.sqrt(MAX_PIXELS)) + 100, Math.floor(Math.sqrt(MAX_PIXELS)) + 100)).toThrow(
      KitError,
    );
  });
});

describe("workflows", () => {
  it("lists the six official editors", () => {
    expect([...WORKFLOW_IDS]).toEqual(["white", "transparent", "png_to_white", "square", "shopify", "enhance"]);
    for (const id of WORKFLOW_IDS) {
      const flow = workflowOf(id);
      expect(flow.url.startsWith("https://whitebackground.app/")).toBe(true);
    }
  });

  it("rejects unknown workflows", () => {
    try {
      workflowOf("cloud");
      throw new Error("should fail");
    } catch (error) {
      expect((error as KitError).code).toBe("bad_workflow");
    }
  });

  it("builds the official canvas URL", () => {
    expect(canvasUrl(16, 16)).toBe("https://whitebackground.app/api/mcp/canvas?width=16&height=16");
    expect(canvasUrl(16, 16, true)).toBe("https://whitebackground.app/api/mcp/canvas?width=16&height=16&download=1");
  });
});
