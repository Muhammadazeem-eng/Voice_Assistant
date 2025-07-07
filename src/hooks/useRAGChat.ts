
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  documentContext?: any[];
}

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

export const useRAGChat = (apiKey: string) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    // Check authentication status
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        await fetchDocuments();
        await createOrGetSession();
      }
    };

    checkUser();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user || null);
        if (session?.user) {
          await fetchDocuments();
          await createOrGetSession();
        } else {
          setDocuments([]);
          setCurrentSessionId(null);
          setMessages([]);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchDocuments = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: "Error fetching documents",
        description: "Please try refreshing the page.",
        variant: "destructive"
      });
    }
  };

  const createOrGetSession = async () => {
    if (!user) return;

    try {
      const { data: session, error } = await supabase
        .from('chat_sessions')
        .insert({
          session_name: `Session ${new Date().toLocaleString()}`,
          user_id: user.id
        })
        .select()
        .single();

      if (error) throw error;
      setCurrentSessionId(session.id);
    } catch (error) {
      console.error('Error creating session:', error);
      toast({
        title: "Session Error",
        description: "Please sign in to use the RAG chat functionality.",
        variant: "destructive"
      });
    }
  };

  const searchDocuments = async (query: string) => {
    if (!apiKey || !user) return [];

    try {
      // Generate embedding for the query
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: query,
          encoding_format: 'float'
        })
      });

      if (!response.ok) throw new Error('Failed to generate query embedding');

      const embeddingResult = await response.json();
      const queryEmbedding = embeddingResult.data[0].embedding;

      // Search for similar chunks
      const { data: chunks, error } = await supabase.rpc('search_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 5
      });

      if (error) throw error;
      return chunks || [];
    } catch (error) {
      console.error('Error searching documents:', error);
      return [];
    }
  };

  const sendMessage = async (content: string) => {
    if (!currentSessionId || !apiKey || !user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to use the chat functionality.",
        variant: "destructive"
      });
      return;
    }

    try {
      // Add user message
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      // Search for relevant document chunks
      const relevantChunks = await searchDocuments(content);
      
      // Prepare context for AI
      let systemPrompt = 'You are a helpful AI assistant for meeting transcription and analysis.';
      
      if (relevantChunks.length > 0) {
        const context = relevantChunks
          .map(chunk => `From "${chunk.filename}": ${chunk.chunk_text}`)
          .join('\n\n');
        
        systemPrompt += `\n\nRelevant document context:\n${context}\n\nUse this context to answer the user's question when relevant.`;
      }

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo-preview',
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content }
          ],
          max_tokens: 1000,
          temperature: 0.7
        })
      });

      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.choices[0]?.message?.content || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
        documentContext: relevantChunks
      };

      setMessages(prev => [...prev, assistantMessage]);

      // Store messages in database
      await supabase.from('chat_messages').insert([
        {
          session_id: currentSessionId,
          role: 'user',
          content,
          document_context: null
        },
        {
          session_id: currentSessionId,
          role: 'assistant',
          content: assistantMessage.content,
          document_context: relevantChunks
        }
      ]);

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error while processing your request.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive"
      });
    }
  };

  return {
    documents,
    setDocuments,
    messages,
    setMessages,
    sendMessage,
    currentSessionId,
    user,
    isAuthenticated: !!user
  };
};
