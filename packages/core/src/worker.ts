import { Worker } from "worker_threads";
import os from "os";

export class WorkerPool {
  private pool: Worker[] = [];
  private taskQueue: Array<{
    workerFile: string;
    workerData: any;
    resolve: (val: any) => void;
    reject: (err: any) => void;
  }> = [];
  private activeWorkers = 0;
  private maxWorkers = os.cpus().length;

  constructor(maxWorkers?: number) {
    if (maxWorkers) this.maxWorkers = maxWorkers;
  }

  public async runTask(workerFile: string, workerData: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ workerFile, workerData, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.taskQueue.length === 0 || this.activeWorkers >= this.maxWorkers) {
      return;
    }

    const task = this.taskQueue.shift();
    if (!task) return;

    this.activeWorkers++;

    let worker = this.pool.pop();
    if (!worker) {
      worker = new Worker(task.workerFile, { workerData: task.workerData });
    }

    worker.on("message", (result: unknown) => {
      task.resolve(result);
      this.releaseWorker(worker!);
    });

    worker.on("error", (err: Error) => {
      task.reject(err);
      this.releaseWorker(worker!);
    });

    worker.on("exit", (code: number) => {
      if (code !== 0) {
        task.reject(new Error(`Worker stopped with exit code ${code}`));
      }
      // Do not reuse exited workers
      this.activeWorkers--;
      this.processQueue();
    });
  }

  private releaseWorker(worker: Worker) {
    worker.removeAllListeners("message");
    worker.removeAllListeners("error");
    // Remove the exit listener added for the specific task to avoid leaks,
    // but the worker itself might exit, so we let it be handled or just terminate it.
    // For simplicity, we just terminate it for now instead of full pooling to ensure clean state.
    worker.terminate();
    this.activeWorkers--;
    this.processQueue();
  }
}

// Export a singleton instance for global use
export const globalWorkerPool = new WorkerPool();
