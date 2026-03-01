/**
 * 轻量计数信号量 — 控制资源并发访问数
 * 用法：
 *   const sem = new Semaphore(3);   // 最多 3 个并发
 *   await sem.acquire();            // 获取 slot（满则排队等）
 *   try { ... } finally { sem.release(); }  // 务必用 finally 释放
 */
export class Semaphore {
    private current = 0;
    private queue: (() => void)[] = [];

    constructor(private readonly max: number) { }

    acquire(): Promise<void> {
        if (this.current < this.max) {
            this.current++;
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            this.queue.push(() => {
                this.current++;
                resolve();
            });
        });
    }

    release(): void {
        this.current--;
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        }
    }
}
