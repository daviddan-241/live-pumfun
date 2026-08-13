// @ts-nocheck
import { EventEmitter } from 'events';
import {
  saveQueueJob,
  getPendingQueueJobs,
  updateQueueJobStatus,
  DBQueueJob,
} from '../database/repositories.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('QueueManager');

export interface QueueJob {
  id: string;
  messageId: string;
  sourceId: string;
  priority: number; // Higher number = higher priority
  type: 'message' | 'edit' | 'album' | 'pnl';
  payload: any;
  retryCount: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class QueueManager extends EventEmitter {
  private inMemoryQueue: QueueJob[] = [];
  private failedCount = 0;
  private processingJobs: Map<string, QueueJob> = new Map();

  constructor() {
    super();
    this.loadPendingJobsFromDB();
  }

  /**
   * Load any uncompleted pending jobs from database on startup
   */
  private loadPendingJobsFromDB(): void {
    try {
      const pendingDbJobs = getPendingQueueJobs();
      for (const dbJob of pendingDbJobs) {
        let parsedPayload = {};
        try {
          parsedPayload = JSON.parse(dbJob.payload);
        } catch {
          parsedPayload = { raw: dbJob.payload };
        }

        const job: QueueJob = {
          id: dbJob.id,
          messageId: dbJob.message_id,
          sourceId: dbJob.source_id,
          priority: dbJob.priority,
          type: dbJob.type as any,
          payload: parsedPayload,
          retryCount: dbJob.retry_count,
          maxRetries: dbJob.max_retries,
          status: dbJob.status as any,
          error: dbJob.error,
          createdAt: dbJob.created_at,
          updatedAt: dbJob.updated_at,
        };
        this.inMemoryQueue.push(job);
      }
      this.sortQueue();
      logger.info(`Loaded ${this.inMemoryQueue.length} pending jobs from database`);
    } catch (err: any) {
      logger.error('Failed to load pending queue jobs from DB:', err.message);
    }
  }

  /**
   * Sort queue by priority DESC, then createdAt ASC
   */
  private sortQueue(): void {
    this.inMemoryQueue.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Add job to the queue & persist to DB
   */
  public enqueue(
    jobData: Omit<QueueJob, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'status'> & { id?: string }
  ): QueueJob {
    const id = jobData.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const job: QueueJob = {
      ...jobData,
      id,
      retryCount: 0,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    // Persist to DB
    const dbJob: DBQueueJob = {
      id: job.id,
      message_id: job.messageId,
      source_id: job.sourceId,
      priority: job.priority,
      type: job.type,
      payload: JSON.stringify(job.payload),
      retry_count: job.retryCount,
      max_retries: job.maxRetries,
      status: job.status,
      error: job.error,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };

    saveQueueJob(dbJob);

    // Insert into in-memory queue and sort
    this.inMemoryQueue.push(job);
    this.sortQueue();

    logger.info(`Job ${job.id} enqueued (type=${job.type}, priority=${job.priority}). Queue size: ${this.inMemoryQueue.length}`);
    this.emit('job:enqueued', job);

    return job;
  }

  /**
   * Get next highest priority job from queue
   */
  public dequeue(): QueueJob | null {
    if (this.inMemoryQueue.length === 0) {
      return null;
    }

    const job = this.inMemoryQueue.shift()!;
    job.status = 'processing';
    job.updatedAt = Date.now();

    this.processingJobs.set(job.id, job);

    // Update status in DB
    updateQueueJobStatus(job.id, 'processing');

    logger.info(`Job ${job.id} dequeued for processing. Remaining pending: ${this.inMemoryQueue.length}`);
    return job;
  }

  /**
   * Mark job as complete and remove from queue
   */
  public markComplete(jobId: string): void {
    const job = this.processingJobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.updatedAt = Date.now();
      this.processingJobs.delete(jobId);
    }

    updateQueueJobStatus(jobId, 'completed');
    logger.info(`Job ${jobId} marked complete.`);
    this.emit('job:completed', { id: jobId });
  }

  /**
   * Mark job as failed. Retry if allowed, or mark permanently failed.
   */
  public markFailed(jobId: string, error: string): void {
    const job = this.processingJobs.get(jobId);
    this.processingJobs.delete(jobId);

    if (!job) {
      updateQueueJobStatus(jobId, 'failed', error);
      this.failedCount++;
      return;
    }

    job.retryCount += 1;
    job.error = error;
    job.updatedAt = Date.now();

    if (job.retryCount <= job.maxRetries) {
      job.status = 'pending';
      updateQueueJobStatus(jobId, 'pending', error, job.retryCount);

      // Re-enqueue for retry
      this.inMemoryQueue.push(job);
      this.sortQueue();
      logger.warn(`Job ${jobId} failed (${error}). Retrying (${job.retryCount}/${job.maxRetries}).`);
    } else {
      job.status = 'failed';
      updateQueueJobStatus(jobId, 'failed', error, job.retryCount);
      this.failedCount++;
      logger.error(`Job ${jobId} permanently failed after ${job.retryCount} retries: ${error}`);
      this.emit('job:failed', { id: jobId, error });
    }
  }

  /**
   * Current queue size (pending + processing)
   */
  public getQueueSize(): number {
    return this.inMemoryQueue.length + this.processingJobs.size;
  }

  /**
   * Get queue health summary
   */
  public getQueueHealth(): { size: number; oldest_job_age: number; failed_count: number; processing_count: number } {
    let oldestJobAge = 0;
    const now = Date.now();

    if (this.inMemoryQueue.length > 0) {
      const oldestTime = this.inMemoryQueue[this.inMemoryQueue.length - 1].createdAt;
      oldestJobAge = Math.floor((now - oldestTime) / 1000);
    }

    return {
      size: this.inMemoryQueue.length,
      oldest_job_age: oldestJobAge,
      failed_count: this.failedCount,
      processing_count: this.processingJobs.size,
    };
  }
}

export const queueManager = new QueueManager();
