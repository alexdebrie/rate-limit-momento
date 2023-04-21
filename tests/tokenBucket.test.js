import { TokenBucketRateLimiter } from "../src";
import {
  CacheClient,
  CacheGet,
  CacheSet,
  Configurations,
  CredentialProvider,
} from "@gomomento/sdk";

const opts = {
  keyPrefix: "testratelimit",
  maxTokens: 50,
  startingTokens: 25,
  refillRate: 5,
  refillInterval: 60,
  cacheName: "testCache",
};

jest.mock("@gomomento/sdk", () => {
  const getMock = jest.fn();
  const setMock = jest.fn();

  const CacheClientMock = jest.fn().mockImplementation(() => ({
    get: getMock,
    set: setMock,
  }));

  return {
    CacheClient: CacheClientMock,
    CacheGet: {
      Error: class {
        innerException() {
          return new Error("CacheGet.Error");
        }
      },
      Hit: class {
        valueString() {
          return "1";
        }
      },
      Miss: class {},
    },
    CacheSet: {
      Error: class {
        innerException() {
          return new Error("CacheSet.Error");
        }
      },
      Success: class {},
    },
    Configurations: {
      InRegion: {
        Default: {
          v1: jest.fn(),
        },
      },
    },
    CredentialProvider: {
      fromEnvironmentVariable: jest.fn(),
    },
  };
});

describe("TokenBucketRateLimiter", () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new TokenBucketRateLimiter(opts);
    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date("2023-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const limiter = new TokenBucketRateLimiter({ cacheName: opts.cacheName });

      expect(limiter.keyPrefix).toBe("ratelimit");
      expect(limiter.maxTokens).toBe(100);
      expect(limiter.startingTokens).toBe(100);
      expect(limiter.refillRate).toBe(10);
      expect(limiter.refillInterval).toBe(60);
      expect(CacheClient).toHaveBeenCalled();
      expect(limiter.cacheName).toBe(opts.cacheName);
      expect(Configurations.InRegion.Default.v1).toHaveBeenCalled();
      expect(CredentialProvider.fromEnvironmentVariable).toHaveBeenCalledWith({
        environmentVariableName: "MOMENTO_AUTH_TOKEN",
      });
    });

    it("should initialize with custom values", () => {
      const limiter = new TokenBucketRateLimiter(opts);

      expect(limiter.keyPrefix).toBe(opts.keyPrefix);
      expect(limiter.maxTokens).toBe(opts.maxTokens);
      expect(limiter.startingTokens).toBe(opts.startingTokens);
      expect(limiter.refillRate).toBe(opts.refillRate);
      expect(limiter.refillInterval).toBe(opts.refillInterval);
      expect(limiter.cacheName).toBe(opts.cacheName);
    });
  });

  describe("limit", () => {
    it("should return allow true and remaining tokens when there are tokens available", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      const hit = new CacheGet.Hit();
      hit.valueString = () => "1672531200:1";
      mockGet.mockReturnValue(hit);

      const mockSet = CacheClient.mock.results[0].value.set;
      const success = new CacheSet.Success();
      mockSet.mockReturnValue(success);

      const result = await rateLimiter.limit("testClient");

      expect(mockGet).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient"
      );

      expect(mockSet).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        "1672531200:0"
      );

      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(0);
      expect(result.error).toBe(null);
    });

    it("should return allow false when there are no tokens available", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      const hit = new CacheGet.Hit();
      hit.valueString = () => "1672531200:0";
      mockGet.mockReturnValue(hit);

      const result = await rateLimiter.limit("testClient");

      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBe(null);
    });

    it("should handle CacheGet.Error correctly", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      mockGet.mockResolvedValueOnce(new CacheGet.Error());

      const result = await rateLimiter.limit("testClient");

      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should initialize the bucket with startingTokens if the item does not exist", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      const miss = new CacheGet.Miss();
      mockGet.mockReturnValue(miss);

      const mockSet = CacheClient.mock.results[0].value.set;
      const success = new CacheSet.Success();
      mockSet.mockReturnValue(success);

      const result = await rateLimiter.limit("testClient");

      expect(mockSet).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        `1672531200:${opts.startingTokens - 1}`
      );

      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(opts.startingTokens - 1);
      expect(result.error).toBe(null);
    });

    it("should increase the tokens in the bucket if needed", async () => {
      const currentTokens = 10;
      const mockGet = CacheClient.mock.results[0].value.get;
      const hit = new CacheGet.Hit();
      hit.valueString = () => `1672531130:${currentTokens}`;
      mockGet.mockReturnValue(hit);

      const mockSet = CacheClient.mock.results[0].value.set;
      const success = new CacheSet.Success();
      mockSet.mockReturnValue(success);

      const result = await rateLimiter.limit("testClient");

      const expectedRemaining = currentTokens + opts.refillRate - 1;

      expect(mockSet).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        `1672531200:${expectedRemaining}`
      );

      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(expectedRemaining);
      expect(result.error).toBe(null);
    });

    it("wont increase the tokens past the maximum", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      const hit = new CacheGet.Hit();
      hit.valueString = () => "0:0"
      mockGet.mockReturnValue(hit);

      const mockSet = CacheClient.mock.results[0].value.set;
      const success = new CacheSet.Success();
      mockSet.mockReturnValue(success);

      const result = await rateLimiter.limit("testClient");

      const expectedRemaining = opts.maxTokens - 1

      expect(mockSet).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        `1672531200:${expectedRemaining}`
      );

      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(expectedRemaining);
      expect(result.error).toBe(null);
    });
  });
});
