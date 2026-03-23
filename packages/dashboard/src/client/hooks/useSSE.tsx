import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

type SSEContextValue = {
  connected: boolean;
  subscribe: (event: string, handler: (data: any) => void) => () => void;
};

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  subscribe: () => () => {},
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const eventTypes = ['agent-state', 'new-message', 'audit-invocation', 'heartbeat', 'connected'];
    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        const handlers = listenersRef.current.get(type);
        handlers?.forEach(h => h(data));
      });
    }

    return () => es.close();
  }, []);

  const subscribe = useCallback((event: string, handler: (data: any) => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(handler);
    return () => {
      listenersRef.current.get(event)?.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ connected, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}

export function useSSEEvent(event: string, handler: (data: any) => void) {
  const { subscribe } = useSSE();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return subscribe(event, (data) => handlerRef.current(data));
  }, [event, subscribe]);
}
