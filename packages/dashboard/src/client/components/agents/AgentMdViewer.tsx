import Markdown from 'react-markdown';

export function AgentMdViewer({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-slate-300
      prose-headings:text-slate-200 prose-headings:text-sm prose-headings:font-medium
      prose-p:text-xs prose-p:leading-relaxed
      prose-code:text-amber-400 prose-code:text-xs prose-code:bg-slate-800 prose-code:px-1 prose-code:rounded
      prose-pre:bg-slate-800 prose-pre:rounded prose-pre:text-xs
      prose-strong:text-slate-200
      prose-a:text-amber-500
      prose-li:text-xs prose-li:leading-relaxed
      prose-hr:border-slate-800
    ">
      <Markdown>{content}</Markdown>
    </div>
  );
}
