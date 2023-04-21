import {
  CacheClient,
  CacheGet,
  CacheIncrement,
  Configurations,
  CredentialProvider,
} from "@gomomento/sdk";
import { timestampToWindow } from "./timeUtils.js";

class FixedWindowRateLimiter {
  /**
     * Initializes a new rate limiter with the specified options.
     * @param {Object} opts - The options for the rate limiter.
     * @param {string} [opts.keyPrefix='ratelimit'] - The prefix to use for cache keys.
     * @param {number} [opts.max=100] - The maximum number of requests allowed in the window.
     * @param {number} [opts.window=900] - The size of the time window in seconds.
     * @param {Object} [opts.cache] - The Momento cache client to use. If not provided, a new client will be created using the 'MOMENTO_AUTH_TOKEN' environment variable.
     * @param {string} [opts.cacheName] - The name of the Momento cache to use.
  
     */
  constructor({ keyPrefix, max, window, cache, cacheName } = {}) {
    if (!cacheName) {
      throw new Error("cacheName is required");
    }
    this.keyPrefix = keyPrefix || "ratelimit";
    this.max = max || 100;
    this.window = window || 900;
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
    const window = timestampToWindow({ numSeconds: this.window});
    const windowEpoch = window.getTime() / 1000;
    const key = this.buildKey(clientId, windowEpoch)
    const response = await this.cache.increment(
      this.cacheName,
      key,
      1,
    );

    if (response instanceof CacheIncrement.Error) {
        return {
            allow: false,
            remaining: 0,
            error: response.innerException(),
        }
    }

    const count = response.valueNumber();

    if (count > this.max) {
      return {
        allow: false,
        remaining: 0,
        error: null,
      };
    }

    return {
        allow: true,
        remaining: this.max - count,
        error: null,
    }
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
    const window = timestampToWindow({ numSeconds: this.window});
    const windowEpoch = window.getTime() / 1000;
    const key = this.buildKey(clientId, windowEpoch)
    const response = await this.cache.get(this.cacheName, key);

    if (response instanceof CacheGet.Error) {
        return {
            remaining: null,
            error: response.innerException(),
        }
    } else if (response instanceof CacheGet.Miss) {
      return {
        remaining: this.max,
        error: null,
      }
    }

    const val = response.valueString();
    const count = parseInt(val, 10);

    if (count >= this.max) {
      return {
        remaining: 0,
        error: null
      }
    }

    return {
      remaining: this.max - count,
      error: null,
    }
  }

  buildKey(clientId, window) {
    return `${this.keyPrefix}:${clientId}:${window}`;
  }
}

export default FixedWindowRateLimiter;
