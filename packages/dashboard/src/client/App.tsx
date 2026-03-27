import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SSEProvider } from './hooks/useSSE';
import { Shell } from './components/layout/Shell';
import { HomePage } from './pages/HomePage';
import { OrgPage } from './pages/OrgPage';
import { ChatPage } from './pages/ChatPage';
import { ConversationsPage } from './pages/ConversationsPage';
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
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SSEProvider>
  );
}
