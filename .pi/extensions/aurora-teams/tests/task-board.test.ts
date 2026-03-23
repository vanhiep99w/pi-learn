import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskBoard } from '../task-board';
import { createTempDir, cleanupTempDir, createMockTask } from './test-utils';

describe('TaskBoard', () => {
  let tempDir: string;
  let board: TaskBoard;

  beforeEach(() => {
    tempDir = createTempDir();
    board = new TaskBoard(tempDir, 'test-team');
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('CRUD Operations', () => {
    it('should create a task with default values', async () => {
      const task = await board.createTask({
        title: 'Test Task',
        description: 'A test task',
      });

      expect(task.id).toMatch(/^t-/);
      expect(task.title).toBe('Test Task');
      expect(task.description).toBe('A test task');
      expect(task.status).toBe('ready'); // No deps → ready
      expect(task.priority).toBe('normal');
      expect(task.depends_on).toEqual([]);
      expect(task.retry_count).toBe(0);
      expect(task.max_retries).toBe(2);
      expect(task.created_at).toBeGreaterThan(0);
    });

    it('should create a task with dependencies as pending', async () => {
      const task = await board.createTask({
        title: 'Dependent Task',
        description: 'Has dependencies',
        depends_on: ['t-dep1', 't-dep2'],
      });

      expect(task.status).toBe('pending'); // Has deps → pending
      expect(task.depends_on).toEqual(['t-dep1', 't-dep2']);
    });

    it('should retrieve a task by ID', async () => {
      const created = await board.createTask({
        title: 'Retrieve Test',
        description: 'Test retrieval',
      });

      const retrieved = await board.getTask(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent task', async () => {
      const task = await board.getTask('non-existent-id');
      expect(task).toBeNull();
    });

    it('should get all tasks', async () => {
      await board.createTask({ title: 'Task 1', description: 'First' });
      await board.createTask({ title: 'Task 2', description: 'Second' });
      await board.createTask({ title: 'Task 3', description: 'Third' });

      const tasks = await board.getAllTasks();
      expect(tasks).toHaveLength(3);
      expect(tasks.map(t => t.title)).toEqual(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should update a task', async () => {
      const task = await board.createTask({
        title: 'Original',
        description: 'Original description',
      });

      const updated = await board.updateTask(task.id, {
        title: 'Updated',
        result: 'Task completed',
      });

      expect(updated?.title).toBe('Updated');
      expect(updated?.result).toBe('Task completed');
      expect(updated?.description).toBe('Original description'); // Unchanged
    });

    it('should return null when updating non-existent task', async () => {
      const result = await board.updateTask('fake-id', { title: 'New' });
      expect(result).toBeNull();
    });
  });

  describe('Status Management', () => {
    it('should set task status to in_progress with timestamp', async () => {
      const task = await board.createTask({
        title: 'Status Test',
        description: 'Test status changes',
      });

      const before = Date.now();
      await board.setStatus(task.id, 'in_progress');
      const after = Date.now();

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('in_progress');
      expect(updated?.started_at).toBeGreaterThanOrEqual(before);
      expect(updated?.started_at).toBeLessThanOrEqual(after);
    });

    it('should set task status to done with timestamp', async () => {
      const task = await board.createTask({
        title: 'Done Test',
        description: 'Test completion',
      });

      await board.setStatus(task.id, 'in_progress');
      
      const before = Date.now();
      await board.setStatus(task.id, 'done', { result: 'Success!' });
      const after = Date.now();

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('done');
      expect(updated?.result).toBe('Success!');
      expect(updated?.completed_at).toBeGreaterThanOrEqual(before);
      expect(updated?.completed_at).toBeLessThanOrEqual(after);
    });

    it('should set task status to failed with error', async () => {
      const task = await board.createTask({
        title: 'Fail Test',
        description: 'Test failure',
      });

      await board.setStatus(task.id, 'failed', { error: 'Something went wrong' });

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('Something went wrong');
      expect(updated?.completed_at).toBeGreaterThan(0);
    });
  });

  describe('Task Claiming', () => {
    it('should claim a ready task', async () => {
      const task = await board.createTask({
        title: 'Claim Test',
        description: 'Test claiming',
      });

      const claimed = await board.claimTask(task.id, 'worker-agent');
      expect(claimed).toBe(true);

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('assigned');
      expect(updated?.agent).toBe('worker-agent');
    });

    it('should not claim a task that is not ready', async () => {
      const task = await board.createTask({
        title: 'Not Ready',
        description: 'Test',
        depends_on: ['dep-1'],
      });

      const claimed = await board.claimTask(task.id, 'worker');
      expect(claimed).toBe(false);

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('pending'); // Unchanged
    });

    it('should not claim a task that is already in progress', async () => {
      const task = await board.createTask({
        title: 'In Progress',
        description: 'Test',
      });

      await board.setStatus(task.id, 'in_progress');

      const claimed = await board.claimTask(task.id, 'another-worker');
      expect(claimed).toBe(false);

      const updated = await board.getTask(task.id);
      expect(updated?.status).toBe('in_progress'); // Unchanged
    });
  });

  describe('Task Queries', () => {
    beforeEach(async () => {
      await board.createTask({ title: 'Ready 1', description: 'Test' });
      await board.createTask({ title: 'Pending 1', description: 'Test', depends_on: ['dep'] });
      
      const t3 = await board.createTask({ title: 'Ready 2', description: 'Test' });
      await board.setStatus(t3.id, 'in_progress');
      
      const t4 = await board.createTask({ title: 'Done 1', description: 'Test' });
      await board.setStatus(t4.id, 'done');
    });

    it('should get ready tasks', async () => {
      const ready = await board.getReadyTasks();
      expect(ready).toHaveLength(1);
      expect(ready[0].title).toBe('Ready 1');
    });

    it('should get tasks by status', async () => {
      const pending = await board.getTasksByStatus('pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending 1');

      const done = await board.getTasksByStatus('done');
      expect(done).toHaveLength(1);
      expect(done[0].title).toBe('Done 1');

      const inProgress = await board.getTasksByStatus('in_progress');
      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].title).toBe('Ready 2');
    });

    it('should get pending approval tasks', async () => {
      const task = await board.createTask({
        title: 'Needs Approval',
        description: 'Test',
        require_approval: true,
      });

      await board.setStatus(task.id, 'waiting_approval');

      const pending = await board.getPendingApproval();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Needs Approval');
    });
  });

  describe('Dependency Resolution', () => {
    it('should unlock tasks when dependencies are done', async () => {
      const dep1 = await board.createTask({ title: 'Dep 1', description: 'Test' });
      const dep2 = await board.createTask({ title: 'Dep 2', description: 'Test' });
      
      const dependent = await board.createTask({
        title: 'Dependent',
        description: 'Test',
        depends_on: [dep1.id, dep2.id],
      });

      expect((await board.getTask(dependent.id))?.status).toBe('pending');

      // Complete dep1
      await board.setStatus(dep1.id, 'done');
      let unlocked = await board.resolveDependencies();
      expect(unlocked).toEqual([]); // Still waiting for dep2

      // Complete dep2
      await board.setStatus(dep2.id, 'done');
      unlocked = await board.resolveDependencies();
      expect(unlocked).toContain(dependent.id);

      const updated = await board.getTask(dependent.id);
      expect(updated?.status).toBe('ready');
    });

    it('should block tasks when dependencies fail', async () => {
      const dep = await board.createTask({ title: 'Dep', description: 'Test' });
      const dependent = await board.createTask({
        title: 'Dependent',
        description: 'Test',
        depends_on: [dep.id],
      });

      await board.setStatus(dep.id, 'failed');
      await board.resolveDependencies();

      const updated = await board.getTask(dependent.id);
      expect(updated?.status).toBe('blocked');
      expect(updated?.error).toContain('dependency failed');
    });

    it('should handle complex dependency graphs', async () => {
      const t1 = await board.createTask({ title: 'T1', description: 'Test' });
      const t2 = await board.createTask({ title: 'T2', description: 'Test' });
      const t3 = await board.createTask({
        title: 'T3',
        description: 'Test',
        depends_on: [t1.id],
      });
      const t4 = await board.createTask({
        title: 'T4',
        description: 'Test',
        depends_on: [t2.id, t3.id],
      });

      // Complete t1
      await board.setStatus(t1.id, 'done');
      let unlocked = await board.resolveDependencies();
      expect(unlocked).toContain(t3.id);
      expect(unlocked).not.toContain(t4.id);

      // Complete t2 and t3
      await board.setStatus(t2.id, 'done');
      await board.setStatus(t3.id, 'done');
      unlocked = await board.resolveDependencies();
      expect(unlocked).toContain(t4.id);
    });

    it('should not unlock if any dependency is blocked', async () => {
      const dep1 = await board.createTask({ title: 'Dep1', description: 'Test' });
      const dep2 = await board.createTask({ title: 'Dep2', description: 'Test' });
      const dependent = await board.createTask({
        title: 'Dependent',
        description: 'Test',
        depends_on: [dep1.id, dep2.id],
      });

      await board.setStatus(dep1.id, 'done');
      await board.setStatus(dep2.id, 'failed');
      await board.resolveDependencies();

      const updated = await board.getTask(dependent.id);
      expect(updated?.status).toBe('blocked');
    });
  });

  describe('Summary & Display', () => {
    it('should generate summary with counts', async () => {
      await board.createTask({ title: 'T1', description: 'Test' }); // ready
      
      const t2 = await board.createTask({ title: 'T2', description: 'Test' });
      await board.setStatus(t2.id, 'done');
      
      const t3 = await board.createTask({ title: 'T3', description: 'Test' });
      await board.setStatus(t3.id, 'in_progress');
      
      await board.createTask({ title: 'T4', description: 'Test', depends_on: ['dep'] }); // pending

      const summary = await board.getSummary();
      expect(summary).toContain('✓1'); // done
      expect(summary).toContain('⏳1'); // in_progress
      expect(summary).toContain('◎1 ready'); // ready
      expect(summary).toContain('○1 pending'); // pending
    });

    it('should handle empty board summary', async () => {
      const summary = await board.getSummary();
      expect(summary).toBe('no tasks');
    });

    it('should format task table', async () => {
      const t1 = await board.createTask({ title: 'Task 1', description: 'Test', agent: 'worker' });
      await board.setStatus(t1.id, 'done');

      const t2 = await board.createTask({ title: 'Task 2', description: 'Test' });
      await board.setStatus(t2.id, 'in_progress');

      const table = await board.formatTable();
      expect(table).toContain('✓');
      expect(table).toContain('Task 1');
      expect(table).toContain('[worker]');
      expect(table).toContain('⏳');
      expect(table).toContain('Task 2');
    });
  });

  describe('Atomic Writes & Concurrency', () => {
    it('should handle concurrent task creation', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        board.createTask({ title: `Task ${i}`, description: 'Concurrent' })
      );

      const tasks = await Promise.all(promises);
      const allTasks = await board.getAllTasks();

      expect(allTasks).toHaveLength(10);
      const ids = new Set(tasks.map(t => t.id));
      expect(ids.size).toBe(10); // All unique IDs
    });

    it('should handle concurrent status updates', async () => {
      const task = await board.createTask({ title: 'Concurrent', description: 'Test' });

      // Simulate concurrent updates
      const promises = [
        board.updateTask(task.id, { result: 'Result 1' }),
        board.updateTask(task.id, { error: 'Error 1' }),
        board.updateTask(task.id, { metadata: { key: 'value' } }),
      ];

      await Promise.all(promises);

      const updated = await board.getTask(task.id);
      expect(updated).not.toBeNull();
      // One of the updates should win (atomic writes guarantee no corruption)
      expect(updated?.id).toBe(task.id);
    });
  });
});
