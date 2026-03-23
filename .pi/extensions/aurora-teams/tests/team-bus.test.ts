import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamBus } from '../team-bus';
import { createTempDir, cleanupTempDir, sleep } from './test-utils';

describe('TeamBus', () => {
  let tempDir: string;
  let bus: TeamBus;

  beforeEach(() => {
    tempDir = createTempDir();
    bus = new TeamBus(tempDir);
  });

  afterEach(() => {
    bus.stopAll();
    cleanupTempDir(tempDir);
  });

  describe('Message Sending', () => {
    it('should send a message to an agent', async () => {
      const messageId = await bus.send({
        from: 'scout',
        to: 'worker',
        type: 'info',
        content: 'Hello worker!',
      });

      expect(messageId).toMatch(/^msg-/);

      const messages = await bus.readInbox('worker');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(messageId);
      expect(messages[0].from).toBe('scout');
      expect(messages[0].to).toBe('worker');
      expect(messages[0].content).toBe('Hello worker!');
      expect(messages[0].type).toBe('info');
      expect(messages[0].read).toBe(false);
    });

    it('should send message with task reference', async () => {
      const messageId = await bus.send({
        from: 'orchestrator',
        to: 'worker',
        type: 'request',
        content: 'Please review task',
        task_id: 't-12345',
      });

      const messages = await bus.readInbox('worker');
      expect(messages[0].task_id).toBe('t-12345');
    });

    it('should broadcast message to all agents', async () => {
      // Create inboxes for multiple agents by sending individual messages first
      await bus.send({ from: 'orch', to: 'scout', type: 'info', content: 'init' });
      await bus.send({ from: 'orch', to: 'worker', type: 'info', content: 'init' });
      await bus.send({ from: 'orch', to: 'planner', type: 'info', content: 'init' });

      // Clear initial messages
      await bus.markRead('scout');
      await bus.markRead('worker');
      await bus.markRead('planner');

      // Broadcast
      await bus.broadcast('orchestrator', 'Team announcement', 'status');

      const scoutMsgs = await bus.readInbox('scout');
      const workerMsgs = await bus.readInbox('worker');
      const plannerMsgs = await bus.readInbox('planner');

      expect(scoutMsgs).toHaveLength(1);
      expect(workerMsgs).toHaveLength(1);
      expect(plannerMsgs).toHaveLength(1);

      expect(scoutMsgs[0].content).toBe('Team announcement');
      expect(workerMsgs[0].content).toBe('Team announcement');
      expect(plannerMsgs[0].content).toBe('Team announcement');
    });
  });

  describe('Message Reading', () => {
    beforeEach(async () => {
      await bus.send({
        from: 'agent1',
        to: 'agent2',
        type: 'info',
        content: 'Message 1',
      });
      await bus.send({
        from: 'agent1',
        to: 'agent2',
        type: 'request',
        content: 'Message 2',
      });
    });

    it('should read unread messages by default', async () => {
      const messages = await bus.readInbox('agent2');
      expect(messages).toHaveLength(2);
      expect(messages.every(m => !m.read)).toBe(true);
    });

    it('should read all messages when unreadOnly is false', async () => {
      await bus.markRead('agent2', []);
      const messages = await bus.readInbox('agent2', false);
      expect(messages).toHaveLength(2);
      expect(messages.every(m => m.read)).toBe(true);
    });

    it('should only show unread messages after marking some as read', async () => {
      const allMessages = await bus.readInbox('agent2');
      const firstId = allMessages[0].id;

      await bus.markRead('agent2', [firstId]);

      const unread = await bus.readInbox('agent2', true);
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(allMessages[1].id);
    });

    it('should handle empty inbox', async () => {
      const messages = await bus.readInbox('non-existent-agent');
      expect(messages).toEqual([]);
    });
  });

  describe('Mark Read', () => {
    it('should mark specific messages as read', async () => {
      const id1 = await bus.send({ from: 'a', to: 'b', type: 'info', content: 'M1' });
      const id2 = await bus.send({ from: 'a', to: 'b', type: 'info', content: 'M2' });
      const id3 = await bus.send({ from: 'a', to: 'b', type: 'info', content: 'M3' });

      await bus.markRead('b', [id1, id3]);

      const unread = await bus.readInbox('b', true);
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(id2);
    });

    it('should mark all messages as read when no IDs specified', async () => {
      await bus.send({ from: 'a', to: 'b', type: 'info', content: 'M1' });
      await bus.send({ from: 'a', to: 'b', type: 'info', content: 'M2' });

      await bus.markRead('b');

      const unread = await bus.readInbox('b', true);
      expect(unread).toEqual([]);
    });
  });

  describe('Inbox Management', () => {
    it('should trim inbox to max 100 messages', async () => {
      // Send 105 messages
      for (let i = 0; i < 105; i++) {
        await bus.send({
          from: 'sender',
          to: 'receiver',
          type: 'info',
          content: `Message ${i}`,
        });
      }

      const messages = await bus.readInbox('receiver', false);
      expect(messages.length).toBeLessThanOrEqual(100);
      
      // Should keep the most recent ones
      const contents = messages.map(m => m.content);
      expect(contents).toContain('Message 104'); // Last message
      expect(contents).not.toContain('Message 0'); // First message trimmed
    });
  });

  describe('Message Formatting', () => {
    it('should format messages for prompt', async () => {
      await bus.send({
        from: 'scout',
        to: 'planner',
        type: 'info',
        content: 'Context gathered',
      });

      await bus.send({
        from: 'orchestrator',
        to: 'planner',
        type: 'request',
        content: 'Please create plan',
      });

      const messages = await bus.readInbox('planner');
      const formatted = bus.formatForPrompt(messages);

      expect(formatted).toContain('Từ scout');
      expect(formatted).toContain('(info)');
      expect(formatted).toContain('Context gathered');
      expect(formatted).toContain('Từ orchestrator');
      expect(formatted).toContain('(request)');
      expect(formatted).toContain('Please create plan');
    });

    it('should handle empty message list', () => {
      const formatted = bus.formatForPrompt([]);
      expect(formatted).toBe('(không có tin nhắn mới)');
    });
  });

  describe('Watch Inbox', () => {
    it('should call callback when new messages arrive', async () => {
      const received: string[] = [];
      const callback = vi.fn((msgs) => {
        received.push(...msgs.map((m: any) => m.content));
      });

      // Start watching
      const unwatch = bus.watch('watcher', callback, 100);

      // Send messages
      await bus.send({ from: 'a', to: 'watcher', type: 'info', content: 'Msg 1' });
      await sleep(150);

      await bus.send({ from: 'b', to: 'watcher', type: 'info', content: 'Msg 2' });
      await sleep(150);

      unwatch();

      expect(callback).toHaveBeenCalled();
      expect(received).toContain('Msg 1');
      expect(received).toContain('Msg 2');
    });

    it('should auto-mark messages as read when watched', async () => {
      const callback = vi.fn();
      const unwatch = bus.watch('watcher', callback, 100);

      await bus.send({ from: 'a', to: 'watcher', type: 'info', content: 'Test' });
      await sleep(150);

      unwatch();

      const unread = await bus.readInbox('watcher', true);
      expect(unread).toEqual([]); // Should be marked as read
    });

    it('should stop watching when unwatch is called', async () => {
      const callback = vi.fn();
      const unwatch = bus.watch('watcher', callback, 100);

      await bus.send({ from: 'a', to: 'watcher', type: 'info', content: 'Before' });
      await sleep(150);

      unwatch();

      // Send after unwatching
      await bus.send({ from: 'a', to: 'watcher', type: 'info', content: 'After' });
      await sleep(150);

      // Callback should only be called once (for "Before")
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should stop all watchers with stopAll', async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      bus.watch('agent1', callback1, 100);
      bus.watch('agent2', callback2, 100);

      bus.stopAll();

      await bus.send({ from: 'a', to: 'agent1', type: 'info', content: 'Test1' });
      await bus.send({ from: 'a', to: 'agent2', type: 'info', content: 'Test2' });
      await sleep(150);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent sends to same agent', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        bus.send({
          from: `sender-${i}`,
          to: 'receiver',
          type: 'info',
          content: `Message ${i}`,
        })
      );

      const ids = await Promise.all(promises);

      const messages = await bus.readInbox('receiver', false);
      expect(messages).toHaveLength(10);
      
      const receivedIds = messages.map(m => m.id);
      expect(new Set(receivedIds).size).toBe(10); // All unique IDs
      
      ids.forEach(id => {
        expect(receivedIds).toContain(id);
      });
    });

    it('should handle concurrent sends to different agents', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        bus.send({
          from: 'broadcaster',
          to: `agent-${i}`,
          type: 'info',
          content: `Message to agent ${i}`,
        })
      );

      await Promise.all(promises);

      for (let i = 0; i < 5; i++) {
        const messages = await bus.readInbox(`agent-${i}`, false);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe(`Message to agent ${i}`);
      }
    });
  });
});
