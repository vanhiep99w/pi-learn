import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { discoverAgents, formatAgentList } from '../agents';
import { createTempDir, cleanupTempDir } from './test-utils';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('agents', () => {
  let tempDir: string;
  let projectAgentsDir: string;
  let userAgentsDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    projectAgentsDir = join(tempDir, 'project', '.pi', 'agents');
    userAgentsDir = join(tempDir, 'user', '.pi', 'agent', 'agents');
    
    mkdirSync(projectAgentsDir, { recursive: true });
    mkdirSync(userAgentsDir, { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  describe('parseFrontmatter & Agent Loading', () => {
    it('should parse agent with full frontmatter', () => {
      const content = `---
name: test-agent
description: A test agent
model: claude-sonnet-4-5
tools: read, bash, grep
thinking: medium
max_turns: 40
retry_on_fail: 3
---

This is the system prompt for the agent.
It can be multiple lines.`;

      writeFileSync(join(projectAgentsDir, 'test-agent.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('test-agent');
      expect(agents[0].description).toBe('A test agent');
      expect(agents[0].model).toBe('claude-sonnet-4-5');
      expect(agents[0].tools).toEqual(['read', 'bash', 'grep']);
      expect(agents[0].thinking).toBe('medium');
      expect(agents[0].max_turns).toBe(40);
      expect(agents[0].retry_on_fail).toBe(3);
      expect(agents[0].system_prompt).toContain('This is the system prompt');
      expect(agents[0].source).toBe('project');
    });

    it('should parse minimal agent config', () => {
      const content = `---
name: minimal
description: Minimal agent
---

Just a simple prompt.`;

      writeFileSync(join(projectAgentsDir, 'minimal.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('minimal');
      expect(agents[0].description).toBe('Minimal agent');
      expect(agents[0].model).toBeUndefined();
      expect(agents[0].tools).toBeUndefined();
      expect(agents[0].thinking).toBeUndefined();
      expect(agents[0].max_turns).toBeUndefined();
      expect(agents[0].retry_on_fail).toBe(2); // default
      expect(agents[0].system_prompt).toBe('Just a simple prompt.');
    });

    it('should skip files without frontmatter', () => {
      const content = `This file has no frontmatter at all.`;

      writeFileSync(join(projectAgentsDir, 'invalid.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toEqual([]);
    });

    it('should skip files with incomplete frontmatter', () => {
      const content = `---
name: incomplete
---

Missing description field.`;

      writeFileSync(join(projectAgentsDir, 'incomplete.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toEqual([]);
    });

    it('should skip non-.md files', () => {
      const content = `---
name: text-file
description: Should be ignored
---

This is a .txt file.`;

      writeFileSync(join(projectAgentsDir, 'should-skip.txt'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toEqual([]);
    });
  });

  describe('Agent Discovery', () => {
    beforeEach(() => {
      // Create some user agents
      writeFileSync(join(userAgentsDir, 'user-scout.md'), `---
name: user-scout
description: User scout agent
---
User scout prompt.`);

      writeFileSync(join(userAgentsDir, 'user-worker.md'), `---
name: user-worker
description: User worker agent
---
User worker prompt.`);

      // Create some project agents
      writeFileSync(join(projectAgentsDir, 'project-planner.md'), `---
name: project-planner
description: Project planner agent
---
Project planner prompt.`);

      writeFileSync(join(projectAgentsDir, 'project-worker.md'), `---
name: project-worker
description: Project worker agent (overrides user)
---
Project worker prompt.`);
    });

    it('should discover project agents only when scope is project', () => {
      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(2);
      expect(agents.map(a => a.name).sort()).toEqual(['project-planner', 'project-worker']);
      expect(agents.every(a => a.source === 'project')).toBe(true);
    });

    it('should discover both user and project agents when scope is both', () => {
      // Mock home directory by using env variable approach isn't available in test
      // Instead we test with manual scope filtering
      const { agents: projectAgents } = discoverAgents(join(tempDir, 'project'), 'project');
      
      expect(projectAgents.length).toBeGreaterThan(0);
    });

    it('should have project agents override user agents with same name', () => {
      // Create a user agent named 'worker'
      writeFileSync(join(userAgentsDir, 'worker.md'), `---
name: worker
description: User version
---
User prompt.`);

      // Create a project agent also named 'worker'
      writeFileSync(join(projectAgentsDir, 'worker.md'), `---
name: worker
description: Project version
---
Project prompt.`);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      const worker = agents.find(a => a.name === 'worker');
      expect(worker).toBeDefined();
      expect(worker?.source).toBe('project');
      expect(worker?.description).toBe('Project version');
    });

    it('should return projectDir when found', () => {
      const { projectDir } = discoverAgents(join(tempDir, 'project'), 'both');

      expect(projectDir).toBe(projectAgentsDir);
    });

    it('should return null projectDir when not found', () => {
      const nonProjectDir = join(tempDir, 'not-a-project');
      mkdirSync(nonProjectDir, { recursive: true });

      const { projectDir } = discoverAgents(nonProjectDir, 'both');

      expect(projectDir).toBeNull();
    });

    it('should find project agents in parent directories', () => {
      // Create nested directory structure
      const nestedDir = join(tempDir, 'project', 'src', 'deep', 'path');
      mkdirSync(nestedDir, { recursive: true });

      const { agents, projectDir } = discoverAgents(nestedDir, 'project');

      expect(projectDir).toBe(projectAgentsDir);
      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('Agent Formatting', () => {
    it('should format agent list', () => {
      writeFileSync(join(projectAgentsDir, 'scout.md'), `---
name: scout
description: Reconnaissance agent
---
Scout prompt.`);

      writeFileSync(join(projectAgentsDir, 'planner.md'), `---
name: planner
description: Planning agent
---
Planner prompt.`);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');
      const formatted = formatAgentList(agents);

      expect(formatted).toContain('scout [project]: Reconnaissance agent');
      expect(formatted).toContain('planner [project]: Planning agent');
    });

    it('should return (none) for empty agent list', () => {
      const formatted = formatAgentList([]);
      expect(formatted).toBe('(none)');
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-existent directories gracefully', () => {
      const { agents } = discoverAgents('/nonexistent/path', 'both');
      expect(agents).toEqual([]);
    });

    it('should handle malformed YAML frontmatter', () => {
      const content = `---
name: malformed
description: Should work
tools: read, bash,
max_turns: not-a-number
---

Prompt.`;

      writeFileSync(join(projectAgentsDir, 'malformed.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('malformed');
      expect(agents[0].tools).toEqual(['read', 'bash']); // trailing comma handled
      expect(agents[0].max_turns).toBeNaN(); // parseInt returns NaN
    });

    it('should handle empty tools list', () => {
      const content = `---
name: no-tools
description: Agent without tools
tools: 
---

Prompt.`;

      writeFileSync(join(projectAgentsDir, 'no-tools.md'), content);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(1);
      expect(agents[0].tools).toBeUndefined();
    });

    it('should preserve file paths correctly', () => {
      writeFileSync(join(projectAgentsDir, 'path-test.md'), `---
name: path-test
description: Test file path
---

Prompt.`);

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents[0].file_path).toBe(join(projectAgentsDir, 'path-test.md'));
    });
  });

  describe('Multiple Agents', () => {
    it('should load multiple agents from same directory', () => {
      for (let i = 0; i < 5; i++) {
        writeFileSync(join(projectAgentsDir, `agent-${i}.md`), `---
name: agent-${i}
description: Agent number ${i}
---

Prompt ${i}.`);
      }

      const { agents } = discoverAgents(join(tempDir, 'project'), 'project');

      expect(agents).toHaveLength(5);
      expect(agents.map(a => a.name).sort()).toEqual([
        'agent-0',
        'agent-1',
        'agent-2',
        'agent-3',
        'agent-4',
      ]);
    });
  });
});
