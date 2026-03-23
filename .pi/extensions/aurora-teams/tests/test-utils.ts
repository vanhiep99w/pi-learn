import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AgentConfig } from '../agents';
import type { Task, TaskStatus } from '../task-board';
import type { TeamMessage } from '../team-bus';

/**
 * Create a temporary directory for testing file operations
 * Remember to cleanup with cleanupTempDir() after each test
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'aurora-teams-test-'));
}

/**
 * Cleanup temporary directory created by createTempDir()
 */
export function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Factory function to create mock AgentConfig
 */
export function createMockAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'test-agent',
    description: 'Test agent for unit tests',
    model: 'claude-sonnet-4-5',
    tools: ['read', 'bash', 'grep'],
    thinking: 'medium',
    max_turns: 40,
    retry_on_fail: 2,
    system_prompt: 'You are a test agent.',
    source: 'project',
    file_path: '/fake/path/test-agent.md',
    ...overrides,
  };
}

/**
 * Factory function to create mock Task
 */
export function createMockTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: `t-${Math.random().toString(36).substring(2, 10)}`,
    title: 'Test Task',
    description: 'A test task',
    status: 'pending' as TaskStatus,
    priority: 'normal',
    depends_on: [],
    created_at: now,
    retry_count: 0,
    max_retries: 2,
    ...overrides,
  };
}

/**
 * Factory function to create mock TeamMessage
 */
export function createMockMessage(overrides: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id: `m-${Math.random().toString(36).substring(2, 10)}`,
    from: 'test-sender',
    to: 'test-recipient',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Mock Pi API object for testing
 */
export function createMockPiAPI() {
  const notifications: Array<{ message: string; type: string }> = [];
  const confirmations: Array<{ message: string; response: boolean }> = [];
  
  return {
    ui: {
      notify: (message: string, type = 'info') => {
        notifications.push({ message, type });
      },
      confirm: async (message: string): Promise<boolean> => {
        const response = confirmations.shift()?.response ?? true;
        return response;
      },
    },
    _notifications: notifications,
    _confirmations: confirmations,
    _queueConfirmation: (response: boolean) => {
      confirmations.push({ message: '', response });
    },
  };
}

/**
 * Sleep helper for async tests
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(interval);
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}
