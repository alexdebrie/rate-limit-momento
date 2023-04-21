import { timestampToWindow, getTimeWindows } from "../src/timeUtils.js";

describe("rateLimiterUtils", () => {
  describe("timestampToWindow()", () => {
    it("should return the start time of a window for a given timestamp", () => {
      const timestamp = new Date("2022-01-01T00:00:30Z");
      const windowStart = timestampToWindow({ timestamp, numSeconds: 60 });
      expect(windowStart.toISOString()).toBe("2022-01-01T00:00:00.000Z");
    });
  });

  describe("getTimeWindows()", () => {
    it("should return an array of time windows between a start and end time", () => {
      const startTime = new Date("2022-01-01T00:00:00Z");
      const endTime = new Date("2022-01-01T00:02:59Z");
      const numSeconds = 60;
      const windows = getTimeWindows({ startTime, endTime, numSeconds });
      expect(windows.length).toBe(3);
      expect(windows[0].toISOString()).toBe("2022-01-01T00:00:00.000Z");
      expect(windows[1].toISOString()).toBe("2022-01-01T00:01:00.000Z");
      expect(windows[2].toISOString()).toBe("2022-01-01T00:02:00.000Z");
    });

    it("should throw an error if startTime is not provided", () => {
      expect(() =>
        getTimeWindows({ endTime: new Date(), numSeconds: 60 })
      ).toThrow("Must provide a start time in getTimeWindows");
    });

    it("should return an empty array if endTime is before startTime", () => {
      const startTime = new Date("2022-01-01T00:01:00Z");
      const endTime = new Date("2022-01-01T00:00:00Z");
      const numSeconds = 60;
      const windows = getTimeWindows({ startTime, endTime, numSeconds });
      expect(windows.length).toBe(0);
    });
  });
});