import Markdown from 'react-markdown';
import { timeAgo } from '../shared';
import type { Message } from '../../types';

export function ChannelMessage({ message }: { message: Message }) {
  return (
    <div className="px-4 py-3 hover:bg-slate-800/30 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-slate-300">{message.sender}</span>
        <span className="text-xs text-slate-600">{timeAgo(message.timestamp)}</span>
      </div>
      <div className="prose prose-invert prose-sm max-w-none text-slate-400
        prose-p:text-sm prose-p:my-0.5
        prose-code:text-amber-400 prose-code:text-xs
        prose-strong:text-slate-300
        prose-li:text-sm
      ">
        <Markdown>{message.content}</Markdown>
      </div>
    </div>
  );
}
