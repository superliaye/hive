import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SSEProvider } from './hooks/useSSE';
import { Shell } from './components/layout/Shell';
import { HomePage } from './pages/HomePage';
import { OrgPage } from './pages/OrgPage';
import { ChatPage } from './pages/ChatPage';
import { ConversationsDirectoryPage } from './pages/ConversationsDirectoryPage';
import { AgentConversationsPage } from './pages/AgentConversationsPage';
import { ConversationViewPage } from './pages/ConversationViewPage';
import { AuditPage } from './pages/AuditPage';

export function App() {
  return (
    <SSEProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<HomePage />} />
            <Route path="org" element={<OrgPage />} />
            <Route path="chat" element={<ChatPage />} />
            {/* Layer 1: Directory — agent cards + group chat cards */}
            <Route path="conversations" element={<ConversationsDirectoryPage />} />
            {/* Layer 2: Agent drill-in — DMs + groups for a specific agent */}
            <Route path="conversations/:alias" element={<AgentConversationsPage />} />
            {/* Layer 3: Conversation view with focal agent — splat captures colon-containing IDs */}
            <Route path="conversations/:agentAlias/*" element={<ConversationViewPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SSEProvider>
  );
}
