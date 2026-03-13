/**
 * prompts.ts — System prompt builder for agents.
 */

import type { AgentConfig, EnvInfo } from "./types.js";

/**
 * Build the system prompt for an agent from its config.
 *
 * - "replace" mode: env header + config.systemPrompt (full control, no parent identity)
 * - "append" mode: env header + parent system prompt + sub-agent context + config.systemPrompt
 * - "append" with empty systemPrompt: pure parent clone
 *
 * @param parentSystemPrompt  The parent agent's effective system prompt (for append mode).
 */
export function buildAgentPrompt(
  config: AgentConfig,
  cwd: string,
  env: EnvInfo,
  parentSystemPrompt?: string,
): string {
  const commonHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.
You can use the send_message tool to notify the parent agent (fire-and-forget).
If the parent replies, it arrives as a new user message in your conversation.

# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  if (config.promptMode === "append") {
    const identity = parentSystemPrompt || genericBase;

    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

    const customSection = config.systemPrompt?.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    return commonHeader + "\n\n<inherited_system_prompt>\n" + identity + "\n</inherited_system_prompt>\n\n" + bridge + customSection;
  }

  // "replace" mode — env header + the config's full system prompt
  return commonHeader + "\n\n" + config.systemPrompt;
}

/** Fallback base prompt when parent system prompt is unavailable in append mode. */
const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;
