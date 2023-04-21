import { FixedWindowRateLimiter } from "../src";
import { CacheClient, CacheIncrement, CacheGet, Configurations, CredentialProvider } from "@gomomento/sdk";

const opts = {
    keyPrefix: "testratelimit",
    max: 10,
    window: 60,
    cacheName: "testCache",
}

jest.mock("@gomomento/sdk", () => {
  const incrementMock = jest.fn();
  const getMock = jest.fn();

  const CacheClientMock = jest.fn().mockImplementation(() => ({
    increment: incrementMock,
    get: getMock,
  }));

  return {
    CacheClient: CacheClientMock,
    CacheIncrement: {
      Error: class {
        innerException() {
          return new Error("CacheIncrement.Error");
        }
      },
      Success: class {
        valueNumber() {
          return 1;
        }
      },
    },
    CacheGet: {
      Error: class {
        innerException() {
          return new Error("CacheGet.Error");
        }
      },
      Miss: class {},
      Success: class {
        valueString() {
          return "1";
        }
      },
    },
    Configurations: {
      InRegion: {
        Default: {
          v1: jest.fn()
        },
      },
    },
    CredentialProvider: {
      fromEnvironmentVariable: jest.fn()
    },
  };
});

describe("FixedWindowRateLimiter", () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new FixedWindowRateLimiter(opts);
    jest.useFakeTimers('modern')
    jest.setSystemTime(new Date('2023-01-01T00:00:00.000Z'))
  });

  afterEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const limiter = new FixedWindowRateLimiter({ cacheName: 'testCache'});
  
      expect(limiter.keyPrefix).toBe('ratelimit');
      expect(limiter.max).toBe(100);
      expect(limiter.window).toBe(900);
      expect(CacheClient).toHaveBeenCalled();
      expect(Configurations.InRegion.Default.v1).toHaveBeenCalled();
      expect(CredentialProvider.fromEnvironmentVariable).toHaveBeenCalledWith({
        environmentVariableName: 'MOMENTO_AUTH_TOKEN',
      });
    });
  
    it('should initialize with custom values', () => {
      expect(rateLimiter.keyPrefix).toBe(opts.keyPrefix);
      expect(rateLimiter.max).toBe(opts.max);
      expect(rateLimiter.window).toBe(opts.window);
      expect(rateLimiter.cacheName).toBe(opts.cacheName);
    });
  });

  describe("limit", () => {
    it("should allow a request if the limit has not been reached", async () => {
      const mockIncrement = CacheClient.mock.results[0].value.increment;
      mockIncrement.mockReturnValue(
        new CacheIncrement.Success()
      );

      const result = await rateLimiter.limit("testClient");

      expect(mockIncrement).toHaveBeenCalledWith(opts.cacheName, "testratelimit:testClient:1672531200", 1)

      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.error).toBe(null);
    });

    it("should deny a request if the limit has been reached", async () => {
      const success = new CacheIncrement.Success();
      success.valueNumber = () => 11;
      CacheClient.mock.results[0].value.increment.mockReturnValue(success);

      const result = await rateLimiter.limit("testClient");

      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBe(null);
    });

    it("should handle CacheIncrement.Error correctly", async () => {
      CacheClient.mock.results[0].value.increment.mockReturnValue(
        new CacheIncrement.Error()
      );

      const result = await rateLimiter.limit("testClient");

      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("remaining", () => {
    it("should return the remaining number of requests", async () => {
      const mockGet = CacheClient.mock.results[0].value.get;
      mockGet.mockReturnValue(
        new CacheGet.Success()
      );

      const result = await rateLimiter.remaining("testClient");

      expect(mockGet).toHaveBeenCalledWith(opts.cacheName, "testratelimit:testClient:1672531200")

      expect(result.remaining).toBe(9);
      expect(result.error).toBe(null);
    });

    it("should return max if cache key is not found", async () => {
      CacheClient.mock.results[0].value.get.mockReturnValue(
        new CacheGet.Miss()
      );

      const result = await rateLimiter.remaining("testClient");

      expect(result.remaining).toBe(10);
      expect(result.error).toBe(null);
    });

    it("should handle CacheGet.Error correctly", async () => {
      CacheClient.mock.results[0].value.get.mockReturnValue(
        new CacheGet.Error()
      );

      const result = await rateLimiter.remaining("testClient");

      expect(result.remaining).toBe(null);
      expect(result.error).toBeInstanceOf(Error);
    });
  });

  describe("buildKey", () => {
    it("should build a cache key with the correct format", () => {
      const clientId = "testClient";
      const window = Math.floor(Date.now() / 1000 / 60) * 60;

      const key = rateLimiter.buildKey(clientId, window);

      expect(key).toBe(`testratelimit:${clientId}:${window}`);
    });
  });
});
