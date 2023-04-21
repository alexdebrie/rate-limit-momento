import { SlidingWindowRateLimiter } from "../src";
import {
  CacheClient,
  CacheDictionaryGetFields,
  CacheDictionaryIncrement,
  Configurations,
  CredentialProvider,
} from "@gomomento/sdk";

const opts = {
  keyPrefix: "testratelimit",
  max: 10,
  window: 60,
  intervalWindow: 10,
  cacheName: "testCache",
};

jest.mock("@gomomento/sdk", () => {
  const dictionaryIncrementMock = jest.fn();
  const dictionaryGetFieldsMock = jest.fn();

  const CacheClientMock = jest.fn().mockImplementation(() => ({
    dictionaryIncrement: dictionaryIncrementMock,
    dictionaryGetFields: dictionaryGetFieldsMock,
  }));

  return {
    CacheClient: CacheClientMock,
    CacheDictionaryIncrement: {
      Error: class {
        innerException() {
          return new Error("CacheDictionaryIncrement.Error");
        }
      },
      Success: class {
        valueNumber() {
          return 1;
        }
      },
    },
    CacheDictionaryGetFields: {
      Error: class {
        innerException() {
          return new Error("CacheDictionaryGetFields.Error");
        }
      },
      Hit: class {
        valueMap() {
          return new Map([["1641039600", "2"], ["1641039620", "3"]]);
        }
      },
      Miss: class {}
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

describe("SlidingWindowRateLimiter", () => {
  let rateLimiter;

  beforeEach(() => {
    rateLimiter = new SlidingWindowRateLimiter(opts);
    jest.useFakeTimers("modern");
    jest.setSystemTime(new Date('2023-01-01T00:00:00.000Z'))
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe("constructor", () => {
    it("should initialize with default values", () => {
      const limiter = new SlidingWindowRateLimiter({
        cacheName: "testCache",
      });

      expect(limiter.keyPrefix).toBe("ratelimit");
      expect(limiter.max).toBe(100);
      expect(limiter.window).toBe(900);
      expect(limiter.intervalWindow).toBe(900);
      expect(CacheClient).toHaveBeenCalled();
      expect(Configurations.InRegion.Default.v1).toHaveBeenCalled();
      expect(CredentialProvider.fromEnvironmentVariable).toHaveBeenCalledWith({
        environmentVariableName: "MOMENTO_AUTH_TOKEN",
      });
    });

    it("should initialize with custom values", () => {
      expect(rateLimiter.keyPrefix).toBe(opts.keyPrefix);
      expect(rateLimiter.max).toBe(opts.max);
      expect(rateLimiter.window).toBe(opts.window);
      expect(rateLimiter.intervalWindow).toBe(opts.intervalWindow);
      expect(rateLimiter.cacheName).toBe(opts.cacheName);
    });
  });

  describe("limit", () => {
    it("should allow a request if the limit has not been reached", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      const mockIncrement = CacheClient.mock.results[0].value.dictionaryIncrement;
      const currentWindow = new Date(Date.now());
      const lastWindow = new Date(currentWindow - opts.intervalWindow * 1000);
      const currentExpectedWindowString = (currentWindow.getTime() / 1000).toString();
      const lastExpectedWindowString = (lastWindow.getTime() / 1000).toString();

      const hit = new CacheDictionaryGetFields.Hit()
      hit.valueMap = jest.fn().mockReturnValue(new Map([[currentExpectedWindowString, "2"], [lastExpectedWindowString, "3"]]))
      mockGetFields.mockResolvedValueOnce(hit);
      mockIncrement.mockResolvedValueOnce(
        new CacheDictionaryIncrement.Success()
      );
    
      const result = await rateLimiter.limit("testClient");
    
      expect(mockGetFields).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        ["1672531140", "1672531150", "1672531160", "1672531170", "1672531180", "1672531190", "1672531200"]
      );
      expect(mockIncrement).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        currentExpectedWindowString,
        1
      );
    
      expect(result.allow).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.error).toBe(null);
    });

    it("should deny a request if the limit has been exceeded", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      const currentWindow = new Date(Date.now());
      const currentExpectedWindowString = (currentWindow.getTime() / 1000).toString();

      const hit = new CacheDictionaryGetFields.Hit()
      hit.valueMap = jest.fn().mockReturnValue(new Map([[currentExpectedWindowString, "10"]]))
      mockGetFields.mockResolvedValueOnce(hit);
    
      const result = await rateLimiter.limit("testClient");
    
      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBe(null);
    });

    it("should handle CacheDictionaryGetFields.Error correctly", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      mockGetFields.mockResolvedValueOnce(new CacheDictionaryGetFields.Error());

      const result = await rateLimiter.limit("testClient");

      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toBeInstanceOf(Error);
    });

    it("should handle CacheDictionaryIncrement.Error correctly", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      const mockIncrement = CacheClient.mock.results[0].value.dictionaryIncrement;
      const currentWindow = new Date(Date.now());
      const expectedWindowString = (currentWindow.getTime() / 1000).toString();
    
      const hit = new CacheDictionaryGetFields.Hit()
      hit.valueMap = jest.fn().mockReturnValue(new Map([[expectedWindowString, "2"]]))
      mockGetFields.mockResolvedValueOnce(hit);
      mockIncrement.mockResolvedValueOnce(
        new CacheDictionaryIncrement.Error()
      );
    
      const result = await rateLimiter.limit("testClient");
    
      expect(result.allow).toBe(false);
      expect(result.remaining).toBe(8);
      expect(result.error).toBeInstanceOf(Error);
    });
  })

  describe("remaining", () => {
    it("should return the remaining number of requests", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      const currentWindow = new Date(Date.now());
      const expectedWindowString = (currentWindow.getTime() / 1000).toString();
      
      const hit = new CacheDictionaryGetFields.Hit()
      hit.valueMap = jest.fn().mockReturnValue(new Map([[expectedWindowString, "2"]]))
      mockGetFields.mockResolvedValueOnce(hit);
  
      const result = await rateLimiter.remaining("testClient");
  
      expect(mockGetFields).toHaveBeenCalledWith(
        opts.cacheName,
        "testratelimit:testClient",
        ["1672531140", "1672531150", "1672531160", "1672531170", "1672531180", "1672531190", "1672531200"]
      );
      expect(result.remaining).toBe(8);
      expect(result.error).toBe(null);
    });
  
    it("should return max if cache key is not found", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      mockGetFields.mockResolvedValueOnce(
        new CacheDictionaryGetFields.Miss()
      );
  
      const result = await rateLimiter.remaining("testClient");
  
      expect(result.remaining).toBe(opts.max);
      expect(result.error).toBe(null);
    });
  
    it("should return 0 if count is equal to or exceeds max", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      const currentWindow = new Date(Date.now());
      const expectedWindowString = (currentWindow.getTime() / 1000).toString();
      
      const hit = new CacheDictionaryGetFields.Hit()
      hit.valueMap = jest.fn().mockReturnValue(new Map([[expectedWindowString, opts.max.toString()]]))
      mockGetFields.mockResolvedValueOnce(hit);
  
      const result = await rateLimiter.remaining("testClient");
  
      expect(result.remaining).toBe(0);
      expect(result.error).toBe(null);
    });

    it("should handle CacheGetFields.Error correctly", async () => {
      const mockGetFields = CacheClient.mock.results[0].value.dictionaryGetFields;
      mockGetFields.mockResolvedValueOnce(
        new CacheDictionaryGetFields.Error()
      );
  
      const result = await rateLimiter.remaining("testClient");
  
      expect(result.remaining).toBe(null);
      expect(result.error).toBeInstanceOf(Error);
    });
  
  });
})

