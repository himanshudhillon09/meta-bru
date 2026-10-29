export interface Clock {
    now(): number;
    sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Time budget for one publish run, including its automatic Stories. It keeps
 * a reel run inside STALE_LOCK_MS (15 minutes), so the Page lock and the
 * publishing post are never treated as stale while Meta is still working.
 */
export const PUBLISH_RUN_MS = 12 * 60 * 1000;

export class Deadline {
    readonly endsAt: number;
    readonly clock: Clock;

    constructor(endsAt: number, clock: Clock = systemClock) {
        this.endsAt = endsAt;
        this.clock = clock;
    }

    static after(ms: number, clock: Clock = systemClock): Deadline {
        return new Deadline(clock.now() + ms, clock);
    }

    expired(): boolean {
        return this.clock.now() >= this.endsAt;
    }
}

export type PollResult<T> = { done: true; value: T } | { done: false };

export interface PollOptions {
    intervalMs: number;
    timeoutMs: number;
    deadline: Deadline;
}

/**
 * Runs `check` now and then every `intervalMs` until it reports done. Gives up
 * after `timeoutMs` or at the run deadline, whichever comes first, and returns
 * null. The last check always runs at the cut-off.
 */
export async function pollUntil<T>(
    check: () => Promise<PollResult<T>>,
    options: PollOptions
): Promise<T | null> {
    const { clock } = options.deadline;
    const stopAt = Math.min(
        clock.now() + options.timeoutMs,
        options.deadline.endsAt
    );

    for (;;) {
        const result = await check();
        if (result.done) return result.value;

        const remaining = stopAt - clock.now();
        if (remaining <= 0) return null;
        await clock.sleep(Math.min(options.intervalMs, remaining));
    }
}
