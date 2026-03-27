import Markdown from 'react-markdown';
import { timeAgo, senderName } from '../shared';
import { useAgentMap } from '../../hooks/useAgentMap';

interface MessageBubbleProps {
  sender: string;
  content: string;
  timestamp: string;
  isUser: boolean;
}

export function MessageBubble({ sender, content, timestamp, isUser }: MessageBubbleProps) {
  const agentMap = useAgentMap();
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-slate-400">{senderName(sender, agentMap)}</span>
        <span className="text-xs text-slate-600">{timeAgo(timestamp)}</span>
      </div>
      <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
        isUser
          ? 'bg-amber-500/10 border border-amber-500/20'
          : 'bg-slate-800 border border-slate-700'
      }`}>
        <div className="prose prose-invert prose-sm max-w-none text-slate-300
          prose-p:text-sm prose-p:leading-relaxed prose-p:my-1
          prose-headings:text-slate-200 prose-headings:text-sm
          prose-code:text-amber-400 prose-code:text-xs
          prose-strong:text-slate-200
          prose-li:text-sm
        ">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
