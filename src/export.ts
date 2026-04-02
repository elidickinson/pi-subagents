/**
 * export.ts — Subagent session export to markdown.
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentRecord } from "./types.js";
import { extractText } from "./context.js";
import { formatDuration } from "./ui/agent-widget.js";

/**
 * Export a subagent session as markdown.
 *
 * Returns the full markdown string with metadata, message history, and tool calls.
 * Tool results are not truncated (full fidelity export).
 */
export function exportAgentSession(session: AgentSession, record: AgentRecord): string {
  const lines: string[] = [];

  // Metadata table
  const duration = formatDuration(record.startedAt, record.completedAt);
  const status = record.status === "running" ? `${record.status} (still running)` : record.status;
  const exportedAt = new Date().toISOString();

  lines.push(`# Agent ${record.id}: ${record.description}`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|-------|-------|");
  lines.push(`| Type | ${record.type} |`);
  lines.push(`| Status | ${status} |`);
  lines.push(`| Duration | ${duration} |`);
  lines.push(`| Tool uses | ${record.toolUses} |`);
  lines.push(`| Exported | ${exportedAt} |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Message history with inline tool calls
  let lastWasAssistantWithToolCalls = false;

  for (const msg of session.messages) {
    const role = msg.role;
    let hasToolCalls = false;

    // Check if this assistant message has tool calls
    if (role === "assistant") {
      for (const c of msg.content) {
        if ((c as any).type === "toolCall") {
          hasToolCalls = true;
          break;
        }
      }
    }

    // Add separator before this message unless:
    // - It's the first message
    // - Previous was assistant with tool calls and this is its result
    // - This is a toolResult following another toolResult
    const needsSeparator = lastWasAssistantWithToolCalls
      ? role !== "toolResult"
      : (role === "user" || role === "assistant");

    if (needsSeparator && lines.length > 0) {
      lines.push("---");
      lines.push("");
    }

    lastWasAssistantWithToolCalls = hasToolCalls;

    if (msg.role === "user") {
      const text = typeof msg.content === "string"
        ? msg.content
        : extractText(msg.content);
      if (text.trim()) {
        lines.push("## User");
        lines.push("");
        lines.push(text.trim());
        lines.push("");
      }
    } else if (msg.role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: Array<{ name: string; params?: any }> = [];

      for (const c of msg.content) {
        if (c.type === "text" && c.text) textParts.push(c.text);
        else if (c.type === "toolCall") {
          toolCalls.push({
            name: (c as any).toolName ?? "unknown",
            params: (c as any).params,
          });
        }
      }

      if (textParts.length === 0 && toolCalls.length === 0) continue;

      lines.push("## Assistant");
      lines.push("");

      // Assistant response text
      if (textParts.length > 0) {
        lines.push(textParts.join("\n").trim());
        lines.push("");
      }

      // Tool calls (rendered inline under the assistant turn)
      for (const { name, params } of toolCalls) {
        lines.push(`### Tool: ${name}`);
        lines.push("");

        if (params) {
          lines.push("**Parameters:**");
          lines.push("");
          lines.push("```json");
          lines.push(JSON.stringify(params, null, 2));
          lines.push("```");
          lines.push("");
        }
      }
    } else if (msg.role === "toolResult") {
      const result = msg as any;
      if (!result.toolName) continue;

      const text = extractText(msg.content);
      if (!text.trim()) continue;

      lines.push(`**Result (${result.toolName}):**`);
      lines.push("");
      lines.push("```");
      lines.push(text);
      lines.push("```");
      lines.push("");
    } else if ((msg as any).role === "bashExecution") {
      const bash = msg as any;
      lines.push(`### Tool: bash`);
      lines.push("");
      lines.push("**Parameters:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify({ command: bash.command }, null, 2));
      lines.push("```");
      lines.push("");

      if (bash.output?.trim()) {
        lines.push("**Result:**");
        lines.push("");
        lines.push("```");
        lines.push(bash.output);
        lines.push("```");
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}


