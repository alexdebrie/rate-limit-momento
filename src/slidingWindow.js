import {
  CacheClient,
  CacheDictionaryGetFields,
  CacheDictionaryIncrement,
  Configurations,
  CredentialProvider,
} from "@gomomento/sdk";
import { getTimeWindows } from "./timeUtils.js";

class SlidingWindowRateLimiter {
  /**
     * Initializes a new rate limiter with the specified options.
     * @param {Object} opts - The options for the rate limiter.
     * @param {string} [opts.keyPrefix='ratelimit'] - The prefix to use for cache keys.
     * @param {number} [opts.max=100] - The maximum number of requests allowed in the window. Defaults to 100.
     * @param {number} [opts.window=900] - The size of the full time window in seconds. Defaults to 900 (15 minutes).
     * @param {number} [opts.intervalWindow] - The size of a single interval time window in seconds. Defaults to window.
     * @param {Object} [opts.cache] - The Momento cache client to use. If not provided, a new client will be created using the 'MOMENTO_AUTH_TOKEN' environment variable.
     * @param {string} [opts.cacheName] - The name of the Momento cache to use.
  
     */
  constructor({
    keyPrefix,
    max,
    window,
    intervalWindow,
    cache,
    cacheName,
  } = {}) {
    this.keyPrefix = keyPrefix || "ratelimit";
    this.max = max || 100;
    this.window = window || 900;
    this.intervalWindow = intervalWindow || this.window;
    this.cache =
      cache ||
      new CacheClient({
        configuration: Configurations.InRegion.Default.v1(),
        credentialProvider: CredentialProvider.fromEnvironmentVariable({
          environmentVariableName: "MOMENTO_AUTH_TOKEN",
        }),
        defaultTtlSeconds: this.window,
      });
    this.cacheName = cacheName;
  }

  /**
   * Limits the rate of requests from a client.
   * @param {string} clientId - The ID of the client making the request.
   * @returns {Promise<{
   *   allow: boolean,
   *   remaining: number,
   *   error: Error|null
   * }>} An object indicating whether the request can proceed, how many requests are remaining during the period, and an error if any occurred.
   */
  async limit(clientId) {
    const { count, error, lastWindow } = await this._calculateTokens(clientId);

    if (error) {
      return {
        allow: false,
        remaining: 0,
        error,
      };
    }

    if (count >= this.max) {
      return {
        allow: false,
        remaining: 0,
        error: null,
      };
    }

    const key = this.buildKey(clientId);
    const incrResponse = await this.cache.dictionaryIncrement(
      this.cacheName,
      key,
      (lastWindow.getTime() / 1000).toString(),
      1
    );

    if (incrResponse instanceof CacheDictionaryIncrement.Error) {
      return {
        allow: false,
        remaining: this.max - count,
        error: incrResponse.innerException(),
      };
    }

    return {
      allow: true,
      remaining: this.max - count - 1,
      error: null,
    };
  }

  /**
   * Returns the number of remaining requests for a client.
   * @param {string} clientId - The ID of the client.
   * @returns {Promise<{
   *   remaining: number,
   *   error: Error|null
   * }>} An object indicating how many requests are remaining during the period and an error if any occurred.
   */
  async remaining(clientId) {
    const { count, error } = await this._calculateTokens(clientId);

    if (error) {
      return {
        remaining: null,
        error,
      };
    }

    if (count >= this.max) {
      return {
        remaining: 0,
        error: null,
      }
    }

    return {
      remaining: this.max - count,
      error: null,
    }
  }

  buildKey(clientId) {
    return `${this.keyPrefix}:${clientId}`;
  }

  async _calculateTokens(clientId) {
    const now = new Date();
    const beginningOfWindow = new Date(now.getTime() - this.window * 1000);
    const windows = getTimeWindows({
      startTime: beginningOfWindow,
      endTime: now,
      numSeconds: this.intervalWindow,
    });
    const key = this.buildKey(clientId);

    const response = await this.cache.dictionaryGetFields(
      this.cacheName,
      key,
      windows.map((window) => (window.getTime() / 1000).toString())
    );

    if (response instanceof CacheDictionaryGetFields.Error) {
      return {
        count: 0,
        error: response.innerException(),
        lastWindow: windows.at(-1),
      };
    }

    let count = 0;

    if (response instanceof CacheDictionaryGetFields.Hit) {
      response.valueMap().forEach((value, key) => {
        const i = parseInt(value, 10);
        count += i;
      });
    }

    return {
      count,
      error: null,
      lastWindow: windows.at(-1),
    };
  }
}

export default SlidingWindowRateLimiter;
