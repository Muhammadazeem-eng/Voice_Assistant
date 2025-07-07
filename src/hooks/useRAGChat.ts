
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { getOrCreateSessionId } from '@/utils/sessionUtils';

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
  const [sessionId] = useState<string>(getOrCreateSessionId());

  useEffect(() => {
    const initializeSession = async () => {
      await fetchDocuments();
      await createOrGetSession();
    };

    initializeSession();
  }, []);

  const fetchDocuments = async () => {
    try {
      console.log('Fetching documents for session:', sessionId);
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      console.log('Documents fetched:', data?.length || 0);
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
    try {
      const { data: session, error } = await supabase
        .from('chat_sessions')
        .insert({
          session_name: `Session ${new Date().toLocaleString()}`,
          browser_session_id: sessionId
        })
        .select()
        .single();

      if (error) throw error;
      setCurrentSessionId(session.id);
      console.log('Chat session created:', session.id);
    } catch (error) {
      console.error('Error creating session:', error);
      toast({
        title: "Session Error",
        description: "Failed to create chat session.",
        variant: "destructive"
      });
    }
  };

  const searchDocuments = async (query: string) => {
    if (!apiKey) {
      console.log('No API key provided for document search');
      return [];
    }

    try {
      console.log('Searching documents for query:', query);
      console.log('Available documents:', documents.length);
      
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

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Embedding API error:', response.status, errorData);
        throw new Error(`Failed to generate query embedding: ${response.status}`);
      }

      const embeddingResult = await response.json();
      const queryEmbedding = embeddingResult.data[0].embedding;
      console.log('Query embedding generated successfully');

      // Search for similar chunks with enhanced parameters
      const { data: chunks, error } = await supabase.rpc('search_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5, // Lower threshold for better recall
        match_count: 8, // More results for better context
        session_id_param: sessionId
      });

      if (error) {
        console.error('Database search error:', error);
        throw error;
      }
      
      console.log('Search results:', {
        chunksFound: chunks?.length || 0,
        chunks: chunks?.map(c => ({
          filename: c.filename,
          similarity: c.similarity,
          textPreview: c.chunk_text.substring(0, 100) + '...'
        }))
      });
      
      return chunks || [];
    } catch (error) {
      console.error('Error searching documents:', error);
      toast({
        title: "Search Error",
        description: "Failed to search documents. Please try again.",
        variant: "destructive"
      });
      return [];
    }
  };

  const sendMessage = async (content: string) => {
    if (!currentSessionId || !apiKey) {
      toast({
        title: "Configuration Required",
        description: "Please configure your OpenAI API key to use the chat functionality.",
        variant: "destructive"
      });
      return;
    }

    try {
      console.log('Sending message:', content);
      
      // Add user message immediately
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, userMessage]);

      // Search for relevant document chunks
      const relevantChunks = await searchDocuments(content);
      console.log('Using document chunks for context:', relevantChunks.length);
      
      // Enhanced system prompt with better document context handling
      let systemPrompt = `You are a helpful AI assistant specializing in document analysis and meeting transcription. You have access to uploaded documents and can provide detailed analysis based on their content.

IMPORTANT INSTRUCTIONS:
- You have access to specific document content that has been uploaded by the user
- Always reference the documents when answering questions about their content
- Be specific about which document you're referencing
- If information isn't in the provided documents, clearly state that
- Provide detailed, accurate responses based on the document content`;

      if (relevantChunks.length > 0) {
        const documentContext = relevantChunks
          .map((chunk, index) => {
            return `Document: "${chunk.filename}" (Relevance: ${(chunk.similarity * 100).toFixed(1)}%)
Content: ${chunk.chunk_text}

---`;
          })
          .join('\n\n');

        systemPrompt = `You are a helpful AI assistant specializing in document analysis. You have access to the following document content that the user has uploaded:

DOCUMENT CONTEXT:
${documentContext}

INSTRUCTIONS:
- Use the above document content to answer the user's questions
- Always specify which document you're referencing when providing information
- Be detailed and accurate in your responses
- If the user asks about information not found in these documents, clearly state that the information is not available in the uploaded documents
- When referencing documents, mention the filename and provide specific details from the content
- The documents are provided in order of relevance to the user's question`;

        console.log('Enhanced system prompt created with', relevantChunks.length, 'document chunks');
      } else {
        console.log('No relevant document chunks found, using basic system prompt');
      }

      // Prepare conversation history
      const conversationMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-6).map(msg => ({ role: msg.role, content: msg.content })), // Last 6 messages for context
        { role: 'user', content }
      ];

      console.log('Calling OpenAI API with', conversationMessages.length, 'messages');

      // Call OpenAI API with enhanced parameters
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
          max_tokens: 2000, // Increased for more detailed responses
          temperature: 0.3, // Lower temperature for more focused, factual responses
          top_p: 0.9,
          frequency_penalty: 0.1,
          presence_penalty: 0.1
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('OpenAI API error:', response.status, errorData);
        throw new Error(`API request failed: ${response.status} ${errorData?.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const assistantContent = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
        documentContext: relevantChunks.length > 0 ? relevantChunks : undefined
      };

      setMessages(prev => [...prev, assistantMessage]);
      console.log('Assistant response generated successfully');

      // Store messages in database
      try {
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
            content: assistantContent,
            document_context: relevantChunks.length > 0 ? relevantChunks : null
          }
        ]);
        console.log('Messages stored in database');
      } catch (dbError) {
        console.error('Error storing messages:', dbError);
        // Don't throw here, as the conversation still worked
      }

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: `Sorry, I encountered an error while processing your request: ${error.message}`,
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
    sessionId,
    isAuthenticated: true // Always true since no auth required
  };
};
