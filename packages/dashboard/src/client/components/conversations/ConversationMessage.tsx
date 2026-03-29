import Markdown from 'react-markdown';
import { timeAgo } from '../shared';
import type { Agent, Message } from '../../types';

interface ConversationMessageProps {
  message: Message;
  isFocused: boolean;
  /** Optional agent data for emoji/name display */
  agent?: Agent;
}

export function ConversationMessage({ message, isFocused, agent }: ConversationMessageProps) {
  const displayName = agent?.name ?? message.sender;
  const emoji = agent?.emoji;

  return (
    <div className={`flex ${isFocused ? 'justify-end' : 'justify-start'} px-4 py-1.5`}>
      <div className={`max-w-[75%] ${isFocused ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-0.5 ${isFocused ? 'flex-row-reverse' : ''}`}>
          <span className={`text-xs font-medium ${isFocused ? 'text-amber-400/80' : 'text-slate-400'}`}>
            {emoji && <span className="mr-1">{emoji}</span>}
            {displayName}
          </span>
          <span className="text-xs text-slate-600">{timeAgo(message.timestamp)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 ${
          isFocused
            ? 'bg-amber-900/20 border border-amber-700/40 rounded-tr-sm'
            : 'bg-slate-800 border border-slate-700/50 rounded-tl-sm'
        }`}>
          <div className={`prose prose-invert prose-sm max-w-none
            prose-p:text-sm prose-p:leading-relaxed prose-p:my-0.5
            prose-headings:text-sm
            prose-code:text-xs
            prose-strong:text-slate-200
            prose-li:text-sm
            ${isFocused
              ? 'text-slate-200 prose-p:text-slate-200 prose-code:text-amber-400 prose-headings:text-slate-100'
              : 'text-slate-300 prose-p:text-slate-300 prose-code:text-amber-400 prose-headings:text-slate-200'
            }
          `}>
            <Markdown>{message.content}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
