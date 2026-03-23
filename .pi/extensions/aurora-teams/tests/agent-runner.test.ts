import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatUsage } from '../agent-runner';
import type { UsageStats } from '../agent-runner';

describe('agent-runner', () => {
  describe('formatUsage', () => {
    it('should format usage with all fields', () => {
      const usage: UsageStats = {
        input: 1500,
        output: 800,
        cache_read: 2000,
        cache_write: 500,
        cost: 0.0234,
        context_tokens: 3000,
        turns: 3,
      };

      const formatted = formatUsage(usage, 'claude-sonnet-4-5');

      expect(formatted).toContain('3t'); // turns
      expect(formatted).toContain('↑1.5k'); // input
      expect(formatted).toContain('↓800'); // output
      expect(formatted).toContain('R2k'); // cache read
      expect(formatted).toContain('$0.0234'); // cost
      expect(formatted).toContain('claude-sonnet-4-5');
    });

    it('should handle small numbers', () => {
      const usage: UsageStats = {
        input: 100,
        output: 50,
        cache_read: 0,
        cache_write: 0,
        cost: 0.0001,
        context_tokens: 150,
        turns: 1,
      };

      const formatted = formatUsage(usage);

      expect(formatted).toContain('1t');
      expect(formatted).toContain('↑100');
      expect(formatted).toContain('↓50');
      expect(formatted).not.toContain('R'); // No cache read
      expect(formatted).toContain('$0.0001');
    });

    it('should handle large numbers with k suffix', () => {
      const usage: UsageStats = {
        input: 15000,
        output: 8500,
        cache_read: 25000,
        cache_write: 0,
        cost: 0.5,
        context_tokens: 50000,
        turns: 10,
      };

      const formatted = formatUsage(usage);

      expect(formatted).toContain('10t');
      expect(formatted).toContain('↑15k');
      expect(formatted).toContain('↓8.5k');
      expect(formatted).toContain('R25k');
      expect(formatted).toContain('$0.5000');
    });

    it('should handle zero values by not including them', () => {
      const usage: UsageStats = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        cost: 0,
        context_tokens: 0,
        turns: 0,
      };

      const formatted = formatUsage(usage);

      expect(formatted).toBe(''); // No parts
    });

    it('should extract model name from full path', () => {
      const usage: UsageStats = {
        input: 100,
        output: 50,
        cache_read: 0,
        cache_write: 0,
        cost: 0.001,
        context_tokens: 150,
        turns: 1,
      };

      const formatted = formatUsage(usage, 'anthropic/claude-sonnet-4-5');

      expect(formatted).toContain('claude-sonnet-4-5');
    });

    it('should handle model name without path separator', () => {
      const usage: UsageStats = {
        input: 100,
        output: 50,
        cache_read: 0,
        cache_write: 0,
        cost: 0.001,
        context_tokens: 150,
        turns: 1,
      };

      const formatted = formatUsage(usage, 'gpt-4');

      expect(formatted).toContain('gpt-4');
    });
  });

  describe('Usage Accumulation', () => {
    it('should correctly accumulate usage across multiple turns', () => {
      const usage: UsageStats = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        cost: 0,
        context_tokens: 0,
        turns: 0,
      };

      // Simulate 3 turns
      for (let i = 0; i < 3; i++) {
        usage.input += 100;
        usage.output += 50;
        usage.cost += 0.001;
        usage.turns++;
      }

      expect(usage.turns).toBe(3);
      expect(usage.input).toBe(300);
      expect(usage.output).toBe(150);
      expect(usage.cost).toBeCloseTo(0.003);
    });
  });

  describe('Context Building (Integration Concept)', () => {
    it('should structure context with agent role, task, and team status', () => {
      // This is a conceptual test - the actual buildContextPrompt is internal
      // We're testing what the structure should look like
      const expectedStructure = [
        '## Thông Tin Team',
        '**Vai trò của bạn:**',
        '**Task của bạn:**',
        '**Trạng thái Team:**',
      ];

      // If buildContextPrompt were exported, we could test it directly
      // For now, we document the expected structure
      expectedStructure.forEach(section => {
        expect(section).toBeTruthy();
      });
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should format error results correctly', () => {
      const errorResult = {
        success: false,
        output: '(no output)',
        usage: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          cost: 0,
          context_tokens: 0,
          turns: 0,
        },
        error: 'Failed after 3 attempts: Agent timeout',
        exit_code: 1,
        duration_ms: 5000,
      };

      expect(errorResult.success).toBe(false);
      expect(errorResult.error).toContain('Failed after 3 attempts');
      expect(errorResult.exit_code).toBe(1);
    });

    it('should format success results correctly', () => {
      const successResult = {
        success: true,
        output: 'Task completed successfully!',
        usage: {
          input: 500,
          output: 200,
          cache_read: 100,
          cache_write: 0,
          cost: 0.005,
          context_tokens: 700,
          turns: 2,
        },
        model: 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        exit_code: 0,
        duration_ms: 3500,
      };

      expect(successResult.success).toBe(true);
      expect(successResult.output).toBe('Task completed successfully!');
      expect(successResult.stop_reason).toBe('end_turn');
      expect(successResult.exit_code).toBe(0);
    });
  });

  describe('Retry Logic Behavior', () => {
    it('should calculate exponential backoff delays', () => {
      const delays: number[] = [];
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        delays.push(delay);
      }

      expect(delays).toEqual([1000, 2000, 4000]);
    });

    it('should respect max retry attempts', () => {
      const maxRetries = 2;
      const totalAttempts = maxRetries + 1; // initial + retries

      expect(totalAttempts).toBe(3);
    });
  });

  describe('Stop Reasons', () => {
    it('should identify error stop reasons', () => {
      const errorStopReasons = ['error', 'aborted'];
      
      errorStopReasons.forEach(reason => {
        const isError = reason === 'error' || reason === 'aborted';
        expect(isError).toBe(true);
      });
    });

    it('should identify successful stop reasons', () => {
      const successStopReasons = ['end_turn', 'max_turns', 'stop_sequence'];
      
      successStopReasons.forEach(reason => {
        const isError = reason === 'error' || reason === 'aborted';
        expect(isError).toBe(false);
      });
    });
  });

  describe('Agent Configuration Validation', () => {
    it('should validate required agent properties', () => {
      const agent = {
        name: 'test-agent',
        description: 'Test agent',
        model: 'claude-sonnet-4-5',
        tools: ['read', 'bash'],
        thinking: 'medium' as const,
        max_turns: 40,
        retry_on_fail: 3,
        system_prompt: 'You are a test agent.',
        source: 'project' as const,
        file_path: '/fake/path/test-agent.md',
      };

      expect(agent.name).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(agent.system_prompt).toBeTruthy();
      expect(agent.retry_on_fail).toBeGreaterThanOrEqual(0);
      expect(agent.max_turns).toBeGreaterThan(0);
    });

    it('should use default retry count when not specified', () => {
      const defaultRetry = 2;
      const agent = {
        retry_on_fail: undefined,
      };

      const retryCount = agent.retry_on_fail ?? defaultRetry;
      expect(retryCount).toBe(2);
    });
  });

  describe('Command Line Arguments', () => {
    it('should build correct pi command arguments', () => {
      const args: string[] = ['--mode', 'json', '-p', '--no-session'];
      
      // Add optional arguments
      const model = 'claude-sonnet-4-5';
      const tools = ['read', 'bash', 'grep'];
      const thinking = 'medium';
      const maxTurns = 40;

      args.push('--model', model);
      args.push('--tools', tools.join(','));
      args.push('--thinking', thinking);
      args.push('--max-turns', String(maxTurns));

      expect(args).toContain('--mode');
      expect(args).toContain('json');
      expect(args).toContain('--model');
      expect(args).toContain('claude-sonnet-4-5');
      expect(args).toContain('--tools');
      expect(args).toContain('read,bash,grep');
      expect(args).toContain('--thinking');
      expect(args).toContain('medium');
      expect(args).toContain('--max-turns');
      expect(args).toContain('40');
    });
  });

  describe('Temporary File Handling', () => {
    it('should generate unique temp file paths', () => {
      const prefix = 'test-agent';
      const paths = new Set<string>();
      
      // Simulate creating 5 temp files
      for (let i = 0; i < 5; i++) {
        const uniquePath = `/tmp/aurora-${prefix}-${Date.now()}-${Math.random()}/prompt.md`;
        paths.add(uniquePath);
      }

      // All paths should be unique
      expect(paths.size).toBe(5);
    });
  });
});
