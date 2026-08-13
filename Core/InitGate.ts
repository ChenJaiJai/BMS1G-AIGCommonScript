/**
 * 啟動閘門：各模組載入完成後 complete，連線層 waitAll 後才處理桌況。
 *
 * 用法：
 * 1. 連線成功後 InitGate.reset(['Background', 'Table', 'Video', 'Poker'])
 * 2. 各模組完成後 InitGate.complete(id)
 * 3. await InitGate.waitAll()
 */
export const InitTask = {
    Background: 'Background',
    Table: 'Table',
    Video: 'Video',
    Poker: 'Poker',
} as const;

export type InitTaskId = (typeof InitTask)[keyof typeof InitTask] | string;

type TaskEntry = {
    done: boolean;
    promise: Promise<void>;
    resolve: () => void;
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

    static addRequired(id: string): void {
        if (!this.required.includes(id)) {
            this.required.push(id);
        }
        this.ensure(id);
    }

    static complete(id: string): void {
        const entry = this.ensure(id);
        if (entry.done) return;
        entry.done = true;
        entry.resolve();
        console.warn(`[InitGate] complete: ${id}`);
    }

    static wait(id: string): Promise<void> {
        return this.ensure(id).promise;
    }

    static waitAll(ids?: string[]): Promise<void> {
        const list = ids ?? this.required;
        return Promise.all(list.map((id) => this.wait(id))).then(() => undefined);
    }

    static isComplete(id: string): boolean {
        return this.tasks.get(id)?.done === true;
    }

    static pending(ids?: string[]): string[] {
        const list = ids ?? this.required;
        return list.filter((id) => !this.isComplete(id));
    }

    private static ensure(id: string): TaskEntry {
        let entry = this.tasks.get(id);
        if (entry) return entry;

        let resolve!: () => void;
        const promise = new Promise<void>((r) => {
            resolve = r;
        });
        entry = { done: false, promise, resolve };
        this.tasks.set(id, entry);
        return entry;
    }
}
