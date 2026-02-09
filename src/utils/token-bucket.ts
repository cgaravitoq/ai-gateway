/**
 * Token Bucket rate limiter.
 *
 * Tokens refill continuously based on elapsed wall-clock time.
 * Each `tryAcquire()` call attempts to consume one token; if the bucket is
 * empty it returns `false` and the caller should reject the request.
 */
export class TokenBucket {
	/** Maximum tokens the bucket can hold */
	private readonly maxTokens: number;

	/** Tokens added per second */
	private readonly refillRate: number;

	/** Current token count (may be fractional between refills) */
	private tokens: number;

	/** Timestamp (ms) of the last refill calculation */
	private lastRefillAt: number;

	constructor(maxTokens: number, refillRate: number) {
		if (maxTokens <= 0) throw new Error("maxTokens must be positive");
		if (refillRate <= 0) throw new Error("refillRate must be positive");

		this.maxTokens = maxTokens;
		this.refillRate = refillRate;
		this.tokens = maxTokens; // bucket starts full
		this.lastRefillAt = Date.now();
	}

	/**
	 * Refill tokens based on time elapsed since the last refill.
	 * Clamps at `maxTokens` so the bucket never overflows.
	 */
	private refill(): void {
		const now = Date.now();
		const elapsedSeconds = (now - this.lastRefillAt) / 1_000;
		this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillRate);
		this.lastRefillAt = now;
	}

	/**
	 * Attempt to consume one token.
	 * @returns `true` if a token was available and consumed, `false` otherwise.
	 */
	tryAcquire(): boolean {
		this.refill();

		if (this.tokens < 1) {
			return false;
		}

		this.tokens -= 1;
		return true;
	}

	/**
	 * Get the number of tokens currently available (after refill).
	 * Returns a whole number (floored).
	 */
	getRemaining(): number {
		this.refill();
		return Math.floor(this.tokens);
	}

	/**
	 * Seconds until at least one full token is available.
	 * Returns 0 if tokens are already available.
	 */
	getRetryAfter(): number {
		this.refill();

		if (this.tokens >= 1) {
			return 0;
		}

		const deficit = 1 - this.tokens;
		return Math.ceil(deficit / this.refillRate);
	}
}
