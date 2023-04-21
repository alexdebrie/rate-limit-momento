import {
  CacheClient,
  CacheGet,
  CacheSet,
  Configurations,
  CredentialProvider,
} from "@gomomento/sdk";

class TokenBucketRateLimiter {
  /**
     * Initializes a new rate limiter with the specified options.
     * @param {Object} opts - The options for the rate limiter.
     * @param {string} [opts.keyPrefix='ratelimit'] - The prefix to use for cache keys.
     * @param {number} [opts.maxTokens=100] - The maximum number of requests allowed in the window (defaults to 100)
     * @param {number} [opts.startingTokens] - The size of the time window in seconds (defaults to maxTokens).
     * @param {number} [opts.refillRate] - The number of tokens to add to the bucket every refillInterval (defaults to 10).
     * @param {number} [opts.refillInterval] - The number of seconds between token refills (defaults to 60).
     * @param {Object} [opts.cache] - The Momento cache client to use. If not provided, a new client will be created using the 'MOMENTO_AUTH_TOKEN' environment variable.
     * @param {string} [opts.cacheName] - The name of the Momento cache to use.
  
     */
  constructor({
    keyPrefix,
    maxTokens,
    startingTokens,
    refillRate,
    refillInterval,
    cache,
    cacheName,
  } = {}) {
    this.keyPrefix = keyPrefix || "ratelimit";
    this.maxTokens = maxTokens || 100;
    this.startingTokens = startingTokens || this.maxTokens;
    this.refillRate = refillRate || 10;
    this.refillInterval = refillInterval || 60;
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
    let { tokens, error } = await this._calculateTokens(clientId);

    if (error) {
      return {
        allow: false,
        remaining: 0,
        error
      };
    }

    if (tokens <= 0) {
      return {
        allow: false,
        remaining: 0,
        error: null,
      };
    }

    const lastUpdatedAt = new Date()
    tokens -= 1;

    const key = this.buildKey(clientId);

    const setResponse = await this.cache.set(this.cacheName, key, pack({ lastUpdatedAt, tokens }));

    if (setResponse instanceof CacheSet.Error) {
      return {
        allow: false,
        remaining: tokens,
        error: response.innerException(),
      };
    }

    return {
      allow: true,
      remaining: tokens,
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
    const { tokens, error } = await this._calculateTokens(clientId);

    if (error) {
      return {
        remaining: null,
        error,
      };
    }

    return {
      remaining: tokens,
      error: null,
    };

  }

  buildKey(clientId) {
    return `${this.keyPrefix}:${clientId}`;
  }

  async _calculateTokens(clientId) {
    const key = this.buildKey(clientId);
    const response = await this.cache.get(this.cacheName, key);

    if (response instanceof CacheGet.Error) {
      return {
        lastUpdatedAt: null,
        tokens: null,
        error: response.innerException(),
      };
    }

    const now = Date.now() / 1000;
    let lastUpdatedAt = now;

    // If it's a miss, we'll see them up with the starting tokens.
    let tokens = this.startingTokens;
    

    if (response instanceof CacheGet.Hit) {
      ({ lastUpdatedAt, tokens } = unpack(response.valueString()))
    }

    const intervals = Math.floor((now - lastUpdatedAt) / this.refillInterval);

    if (intervals > 0) {
      tokens = Math.min(this.maxTokens, tokens + intervals * this.refillRate);
    }

    return {
      lastUpdatedAt,
      tokens,
      error: null,
    }
  }
}

const pack = ({ lastUpdatedAt, tokens }) => {
  return `${lastUpdatedAt.getTime() / 1000}:${tokens}`;
};

const unpack = (value) => {
  const [lastUpdatedAt, tokens] = value.split(":");
  return {
    lastUpdatedAt: parseInt(lastUpdatedAt, 10),
    tokens: parseInt(tokens, 10),
  };
};

export default TokenBucketRateLimiter;
