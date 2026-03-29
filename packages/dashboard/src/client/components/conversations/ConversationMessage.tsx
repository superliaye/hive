import Markdown from 'react-markdown';
import { timeAgo } from '../shared';
import type { Message } from '../../types';

interface ConversationMessageProps {
  message: Message;
  isFocused: boolean;
}

export function ConversationMessage({ message, isFocused }: ConversationMessageProps) {
  return (
    <div className={`flex ${isFocused ? 'justify-end' : 'justify-start'} px-4 py-1.5`}>
      <div className={`max-w-[75%] ${isFocused ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`flex items-center gap-2 mb-0.5 ${isFocused ? 'flex-row-reverse' : ''}`}>
          <span className={`text-xs font-medium ${isFocused ? 'text-amber-400/80' : 'text-slate-400'}`}>
            {message.sender}
          </span>
          <span className="text-xs text-slate-600">{timeAgo(message.timestamp)}</span>
        </div>
        <div className={`rounded-2xl px-4 py-2.5 ${
          isFocused
            ? 'bg-amber-500/10 border border-amber-500/20 rounded-tr-sm'
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
