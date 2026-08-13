export interface WaitUntilOptions {
    /** 輪詢間隔（毫秒），預設 16 */
    intervalMs?: number;
    /** 逾時（毫秒），預設 30000；逾時則 resolve(false) */
    timeoutMs?: number;
    needCancel?: boolean;
}

/** @returns true 條件成立；false 逾時或 needCancel（不 throw） */
export function waitUntil(
    condition: () => boolean,
    options: WaitUntilOptions = {},
): Promise<boolean> {
    const intervalMs = options.intervalMs ?? 16;
    const timeoutMs = options.timeoutMs ?? 30000;

    return new Promise((resolve) => {
        const startedAt = Date.now();
        const check = setInterval(() => {
            if (condition()) {
                clearInterval(check);
                resolve(true);
                return;
            }
            if (Date.now() - startedAt >= timeoutMs || options.needCancel) {
                clearInterval(check);
                resolve(false);
            }
        }, intervalMs);
    });
}

export function waitUntil_test(condition: () => boolean, options: WaitUntilOptions = {}): WaitUntilHandle {
    const intervalMs = options.intervalMs ?? 16;
    const timeoutMs = options.timeoutMs ?? 30000;
    let timer: ReturnType<typeof setInterval> | null = null;
    let rejectFn: ((e: unknown) => void) | null = null;
    let done = false;
    const stop = () => {
        if (timer) clearInterval(timer);
        timer = null;
    };
    const promise = new Promise<void>((resolve, reject) => {
        rejectFn = reject;
        const startedAt = Date.now();
        timer = setInterval(() => {
            if (done) return;
            if (condition()) {
                done = true;
                stop();
                resolve();
                return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
                done = true;
                stop();
                reject(new Error('waitUntil: timeout'));
            }
        }, intervalMs);
    });
    const cancel = () => {
        if (done) return;
        done = true;
        stop();
        rejectFn?.(new Error('waitUntil: cancelled'));
    };
    return { promise, cancel };
}

export interface WaitUntilHandle {
    readonly promise: Promise<void>;
    cancel(): void;
}
