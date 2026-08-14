/**
 * 啟動閘門：reset 列出必等任務，各模組 complete，再 waitAll。
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

    static waitAll(): Promise<void> {
        return Promise.all(this.required.map((id) => this.ensure(id).promise)).then(() => undefined);
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
