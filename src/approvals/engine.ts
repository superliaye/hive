export interface ApprovalItem {
  id: string;
  type: 'AR_CHANGE' | 'HEAVYWEIGHT' | 'BUDGET' | 'OTHER';
  description: string;
  justification?: string;
  requestedBy?: string;
}

export interface ApprovalDecision {
  itemId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}

/**
 * Parse an approval request from a channel message.
 * Format:
 *   **Approval Request: <item-id>**
 *   Type: AR_CHANGE | HEAVYWEIGHT | BUDGET | OTHER
 *   Description: ...
 *   Justification: ...
 *   Requested by: @agent-id
 */
export function parseApprovalItem(content: string): ApprovalItem | null {
  const headerMatch = content.match(/\*\*Approval Request:\s*(\S+)\*\*/);
  if (!headerMatch) return null;

  const id = headerMatch[1];
  const typeMatch = content.match(/^Type:\s*(.+)$/m);
  const descMatch = content.match(/^Description:\s*(.+)$/m);
  const justMatch = content.match(/^Justification:\s*(.+)$/m);
  const reqMatch = content.match(/^Requested by:\s*(.+)$/m);

  const validTypes = ['AR_CHANGE', 'HEAVYWEIGHT', 'BUDGET', 'OTHER'] as const;
  const rawType = typeMatch?.[1]?.trim();
  const type = validTypes.includes(rawType as any) ? (rawType as ApprovalItem['type']) : 'OTHER';

  return {
    id,
    type,
    description: descMatch?.[1]?.trim() ?? '',
    justification: justMatch?.[1]?.trim(),
    requestedBy: reqMatch?.[1]?.trim(),
  };
}

/**
 * Parse a super-user approval/rejection decision.
 * Format: "approved: <item-id>" or "rejected: <item-id> — reason"
 */
export function parseApprovalDecision(content: string): ApprovalDecision | null {
  const match = content.match(/^(approved|rejected):\s*(\S+)(?:\s*[—–-]\s*(.+))?$/i);
  if (!match) return null;

  return {
    itemId: match[2],
    decision: match[1].toLowerCase() as 'approved' | 'rejected',
    reason: match[3]?.trim(),
  };
}
