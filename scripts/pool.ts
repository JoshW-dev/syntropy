// A small pool of worker threads that each run one job at a time.

import { Worker } from 'node:worker_threads';

export class Pool<J extends object, R> {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { job: J; resolve: (r: R) => void }[] = [];
  private pending = new Map<number, (r: R) => void>();
  private ready: Promise<void>;
  private nextId = 1;

  constructor(file: URL, n: number) {
    const readies: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(file);
      this.workers.push(w);
      readies.push(
        new Promise((res) => {
          w.on('message', (m: { ready?: boolean; id?: number; result?: R }) => {
            if (m.ready) {
              this.idle.push(w);
              res();
            } else if (m.id !== undefined) {
              this.pending.get(m.id)?.(m.result as R);
              this.pending.delete(m.id);
              this.idle.push(w);
            }
            this.pump();
          });
          w.on('error', (e) => {
            console.error('worker error', e);
            process.exit(1);
          });
        }),
      );
    }
    this.ready = Promise.all(readies).then(() => undefined);
  }

  async run(job: J): Promise<R> {
    await this.ready;
    return new Promise((resolve) => {
      this.queue.push({ job, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, resolve } = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, resolve);
      w.postMessage({ ...job, id });
    }
  }

  close(): void {
    for (const w of this.workers) w.terminate();
  }
}
