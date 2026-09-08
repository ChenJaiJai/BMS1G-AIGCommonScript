/**
 * 啟動閘門：reset 列出必等任務，各模組 complete，再 waitAll。
 * 任一模組「主＋預設都失敗」時呼叫 fail，中斷全部等待中的 await。
 *
 * InitTask 只放各座台都會等的項。遊戲自己的任務在遊戲專案定義，reset 時一起傳進來。
 */
export const InitTask = {
    Background: 'Background',
    Table: 'Table',
    Video: 'Video',
} as const;

type TaskEntry = {
    done: boolean;
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason?: unknown) => void;
};

export default class InitGate {
    private static tasks = new Map<string, TaskEntry>();
    private static required: string[] = [];

    static reset(required: string[]): void {
        for (const entry of this.tasks.values()) {
            if (!entry.done) {
                entry.done = true;
                entry.resolve();
            }
        }
        this.tasks.clear();
        this.required = [...required];
        for (const id of this.required) {
            this.ensure(id);
        }
    }

    static complete(id: string): void {
        const entry = this.ensure(id);
        if (entry.done) return;
        entry.done = true;
        entry.resolve();
    }

    /**
     * 取消全部尚未完成的任務，讓 waitAll reject。
     * 當前沒有任何等待中的任務 → 直接 return。
     */
    static fail(reason?: unknown): void {
        let hasPending = false;
        const err = reason instanceof Error
            ? reason
            : new Error(reason != null ? String(reason) : 'InitGate.fail');
        for (const entry of this.tasks.values()) {
            if (entry.done) continue;
            hasPending = true;
            entry.done = true;
            entry.reject(err);
        }
        if (!hasPending) return;
    }

    static waitAll(): Promise<void> {
        return Promise.all(this.required.map((id) => this.ensure(id).promise)).then(() => undefined);
    }

    private static ensure(id: string): TaskEntry {
        let entry = this.tasks.get(id);
        if (entry) return entry;

        let resolve!: () => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<void>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        // 避免 fail 後未接住的 Promise 變成 unhandled rejection（waitAll 會接）
        promise.catch(() => undefined);
        entry = { done: false, promise, resolve, reject };
        this.tasks.set(id, entry);
        return entry;
    }
}
