# <div align="center"> Rate Limit Momento </div>

<p align="center">
  <img src="https://user-images.githubusercontent.com/6509926/233721398-86224dde-0458-4824-9562-15e9a6801be4.png" alt="Mo waiting at a stoplight in his convertible" width=512>
<p>


A simple, serverless rate limiter using [Momento Cache](https://www.gomomento.com/).

### Table of Contents
- [What is this? Why do we need it?](#what-is-this-why-do-we-need-it)
- [Usage](#usage)
  - [Example](#example)
  - [API](#api)
- [Rate limiter configuration](#rate-limiter-configuration)
  - [FixedWindowRateLimiter](#fixedwindowratelimiter)
  - [SlidingWindowRateLimiter](#slidingwindowratelimiter)
  - [TokenBucketRateLimiter](#tokenbucketratelimiter)
- [Costs](#costs)

## What is this? Why do we need it?

It's a [rate limiter](https://en.wikipedia.org/wiki/Rate_limiting). It can help throttle requests to prevent DDoS attacks or to simply restrict your API.

These have existed in Node for a while (see [node-rate-limit-flexible](https://github.com/animir/node-rate-limiter-flexible) for a generic one or [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) for a common Express middlware). However, they generally rely on serverfull storage to manage state -- Redis, Memcached, or even databases like MongoDB, Postgres, or MySQL.

This library uses [Momento](https://www.gomomento.com/), a serverless cache with pay-per-use pricing and no connection limits. This means it works better in a serverless environment that can have many instances of compute entering and exiting all the time.

Also, this gave me an excuse to publish my first NPM package and to play around with ChatGPT + Midjourney :) This is still a work in progress -- aiming to get publish to NPM and also create a [Middy.js middleware](https://middy.js.org/).

For another great, _serverless_ rate limiting library, check out [Upstash's](https://upstash.com/) [ratelimit](https://github.com/upstash/ratelimit).

## Usage

### Example

1. [Sign up for a Momento account](https://www.gomomento.com/) to get an auth token. Set the token to your `MOMENTO_AUTH_TOKEN` environment variable and create a cache. 

2. Install the library

    ```bash
    npm i alexdebrie/rate-limit-momento
    ```

3. Add to your application

    ```node
    import { FixedWindowRateLimiter } from "rate-limit-momento"

    // Create your rate limiter instance
    const rateLimiter = new FixedWindowRateLimiter({ cacheName: 'rate-limit' })

    // Invoke .limit() with a clientId to test whether to allow the request
    const { allow, remaining, error } = rateLimiter.limit('alexdebrie') 

    console.log(`Request allowed: ${allow}; Requests remaining: ${remaining})
    ```

### API

[Each rate limiter configuration](#rate-limiter-configuration) exposes two methods:

1. `limit(clientId)`: This attempts to allow the request and reports back on the result. This consumes a token, if available. The response is
  
    ```javascript

    const response = rateLimiter.limit(clientId)
    console.log(response)
    {
      allow: boolean,
      remaining: integer,
      error: Error|null
    }
    ```

2. `remaining(clientId)`: This returns the number of requests remaining for the clientId without consuming a token. The response shape is:

    ```javascript
    const response = rateLimiter.remaining(clientId)
    console.log(response)
    {
      remaining: integer,
      error: Error|null
    }
    ```

## Rate limiter configuration

There are three different rate limiter strategies in this library. Choose the one that fits your needs.

Note that the Sliding Window and Token Bucket strategies could allow requests in excess of your limit during high concurrency due to non-atomic read-then-write processes. If you need stronger guarantees, a cache may not be right for you!

[Additional reading on rate limit strategies](https://cloud.google.com/architecture/rate-limiting-strategies-techniques#techniques-enforcing-rate-limits).

### FixedWindowRateLimiter

The `FixedWindowRateLimiter` limits the rate of requests from a client within a fixed time window. It's the simplest implementation but can be subject to bursty traffic. For example, a fixed window of 60 minutes could allow all traffic in the first 15 seconds of an hour.

#### Configuration options:

- **keyPrefix:** The prefix that will be used on keys to distinguish them from other items in your cache (*default: 'ratelimit'*).

- **max:** The maximum requests allowed for a client within a given window (*default: 100*).

- **window:** The length of the window in seconds (*default: 900 seconds / 15 minutes*).

- **cache:** An initialized instance of the Momento Cache client. If not provided, one will be created for you.

- **cacheName:** The name of the cache to use in Momento. This must be provided and must exist before use.

Sample usage:

```javascript
import { FixedWindowRateLimiter } from 'rate-limit-momento';

const rateLimiter = new FixedWindowRateLimiter({
  keyPrefix: 'myapp',
  max: 100,
  window: 60,
  cacheName: 'my-cache',
});

const clientId = 'abusiveuser';

const { allow, remaining } = await rateLimiter.limit(clientId);
console.log(`Allow request: ${allow}, Remaining requests: ${remaining}`);

const { remaining } = await rateLimiter.remaining(clientId);
console.log(`Remaining requests: ${remaining}`);
```

### SlidingWindowRateLimiter

The `SlidingWindowRateLimiter` limits the rate of requests from a client within a sliding time window, allowing for greater flexibility and fine-tuning of your application's traffic management. 

In contrast to the fixed window limiter, a sliding rate limiter expires requests on a more granular level. For each interval that passes, requests from the oldest interval within the window will be rolled off.

#### Configuration options:

- **keyPrefix:** The prefix that will be used on keys to distinguish them from other items in your cache (*default: 'ratelimit'*).

- **max:** The maximum requests allowed for a client within a given time window (*default: 100*).

- **window:** The length of the full time window in seconds (*default: 900 seconds / 15 minutes*).

- **intervalWindow:** The length of a single interval time window in seconds (*default: same as `window`*).

- **cache:** An initialized instance of the Momento Cache client. If not provided, one will be created for you.

- **cacheName:** The name of the cache to use in Momento. This must be provided and must exist before use.

Sample usage:

```javascript
import { SlidingWindowRateLimiter } from 'rate-limit-momento';

const rateLimiter = new SlidingWindowRateLimiter({
  keyPrefix: 'myapp',
  max: 100,
  window: 60 * 60,
  intervalWindow: 60,
  cacheName: 'my-cache',
});

const clientId = 'scriptkiddie';

const { allow, remaining } = await rateLimiter.limit(clientId);
console.log(`Allow request: ${allow}, Remaining requests: ${remaining}`);

const { remaining } = await rateLimiter.remaining(clientId);
console.log(`Remaining requests: ${remaining}`);
```

### TokenBucketRateLimiter

The `TokenBucketRateLimiter` limits the rate of requests from a client by tracking the number of tokens available in a token bucket, which gets refilled periodically. When a request comes in, a token is removed from the bucket, and the request is allowed if there are tokens available.

#### Configuration options:

- **keyPrefix:** The prefix that will be used on keys to distinguish them from other items in your cache (*default: 'ratelimit'*).

- **maxTokens:** The maximum number of tokens that the bucket can hold (*default: 100*).

- **startingTokens:** The initial number of tokens in the bucket (*default: maxTokens*).

- **refillRate:** The number of tokens to add to the bucket every refillInterval (*default: 10*).

- **refillInterval:** The number of seconds between token refills (*default: 60*).

- **cache:** An initialized instance of the Momento Cache client. If not provided, one will be created for you.

- **cacheName:** The name of the cache to use in Momento. This must be provided and must exist before use.

Sample usage:

```javascript
import { TokenBucketRateLimiter } from 'rate-limit-momento';

const rateLimiter = new TokenBucketRateLimiter({
  keyPrefix: 'myapp',
  maxTokens: 100,
  startingTokens: 50,
  refillRate: 20,
  refillInterval: 60,
  cacheName: 'my-cache',
});

const clientId = 'dr_evil';

const { allow, remaining } = await rateLimiter.limit(clientId);
console.log(`Allow request: ${allow}, Remaining requests: ${remaining}`);

const { remaining } = await rateLimiter.remaining(clientId);
console.log(`Remaining requests: ${remaining}`);
```

## Costs

So, how much will this cost you? Well, it depends on the number of requests you have!

[Momento charges based on the GBs transferred](https://www.gomomento.com/pricing) at a flat rate of $0.50 per GB.

Requests are metered in 1KB increments. Most of our operations are pretty small and should be <1KB unless you use a long `keyPrefix`.

Thus, **the price is roughly $0.50 per million requests**.

Further, you get the first 50GB per month for free, so your first 50 million requests are free. 💥
