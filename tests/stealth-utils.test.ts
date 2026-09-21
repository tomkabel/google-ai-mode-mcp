import { describe, it, expect } from "vitest";
import {
  sleep,
  randomInt,
  randomFloat,
  randomChar,
  gaussian,
} from "../src/utils/stealth-utils.js";

describe("stealth-utils pure helpers", () => {
  describe("sleep", () => {
    it("resolves after approximately the specified delay", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(200);
    });

    it("resolves immediately for 0ms", async () => {
      const start = Date.now();
      await sleep(0);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("randomInt", () => {
    it("returns integer within range (inclusive)", () => {
      for (let i = 0; i < 100; i++) {
        const n = randomInt(5, 10);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(5);
        expect(n).toBeLessThanOrEqual(10);
      }
    });

    it("returns same value when min === max", () => {
      expect(randomInt(7, 7)).toBe(7);
    });

    it("works with large ranges", () => {
      for (let i = 0; i < 50; i++) {
        const n = randomInt(0, 1000000);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1000000);
      }
    });
  });

  describe("randomFloat", () => {
    it("returns float within range", () => {
      for (let i = 0; i < 100; i++) {
        const n = randomFloat(1.0, 2.0);
        expect(n).toBeGreaterThanOrEqual(1.0);
        expect(n).toBeLessThanOrEqual(2.0);
      }
    });

    it("can return non-integer values", () => {
      let found = false;
      for (let i = 0; i < 100; i++) {
        const n = randomFloat(0, 1);
        if (!Number.isInteger(n)) found = true;
      }
      expect(found).toBe(true);
    });
  });

  describe("randomChar", () => {
    it("returns a single lowercase character", () => {
      for (let i = 0; i < 50; i++) {
        const c = randomChar();
        expect(c.length).toBe(1);
        expect(/[a-z]/.test(c)).toBe(true);
      }
    });
  });

  describe("gaussian", () => {
    it("returns values clustered around the mean", () => {
      const mean = 100;
      const stdDev = 10;
      const values: number[] = [];
      for (let i = 0; i < 1000; i++) {
        values.push(gaussian(mean, stdDev));
      }
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      // Average should be roughly within 2 stddev of mean
      expect(avg).toBeGreaterThan(mean - 2 * stdDev);
      expect(avg).toBeLessThan(mean + 2 * stdDev);
    });

    it("returns finite numbers", () => {
      for (let i = 0; i < 100; i++) {
        const n = gaussian(50, 5);
        expect(Number.isFinite(n)).toBe(true);
      }
    });
  });
});
