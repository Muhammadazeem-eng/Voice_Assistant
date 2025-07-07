
// Utility for managing browser sessions
export const getOrCreateSessionId = (): string => {
  const SESSION_KEY = 'rag_session_id';
  
  // Check if session ID exists in localStorage
  let sessionId = localStorage.getItem(SESSION_KEY);
  
  if (!sessionId) {
    // Generate a new session ID
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  
  return sessionId;
};

export const clearSession = (): void => {
  localStorage.removeItem('rag_session_id');
};
