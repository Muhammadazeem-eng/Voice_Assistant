
-- Enable the vector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create table for uploaded documents
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for document chunks with embeddings
CREATE TABLE public.document_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES public.documents(id) ON DELETE CASCADE NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  embedding vector(1536), -- OpenAI text-embedding-3-small produces 1536-dimensional vectors
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for chat sessions
CREATE TABLE public.chat_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  session_name TEXT NOT NULL DEFAULT 'New Session',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for chat messages with document context
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  document_context JSONB, -- Store relevant document chunks used for context
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add RLS policies for documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own documents" ON public.documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own documents" ON public.documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own documents" ON public.documents FOR DELETE USING (auth.uid() = user_id);

-- Add RLS policies for document chunks
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view chunks of their documents" ON public.document_chunks FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.documents WHERE documents.id = document_chunks.document_id AND documents.user_id = auth.uid()));
CREATE POLICY "Users can insert chunks for their documents" ON public.document_chunks FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.documents WHERE documents.id = document_chunks.document_id AND documents.user_id = auth.uid()));

-- Add RLS policies for chat sessions
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own chat sessions" ON public.chat_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own chat sessions" ON public.chat_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own chat sessions" ON public.chat_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own chat sessions" ON public.chat_sessions FOR DELETE USING (auth.uid() = user_id);

-- Add RLS policies for chat messages
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view messages from their sessions" ON public.chat_messages FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));
CREATE POLICY "Users can insert messages to their sessions" ON public.chat_messages FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sessions WHERE chat_sessions.id = chat_messages.session_id AND chat_sessions.user_id = auth.uid()));

-- Create an index for faster vector similarity search
CREATE INDEX ON public.document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Function to search similar document chunks
CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  user_id_param uuid DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_text text,
  chunk_index integer,
  similarity float,
  filename text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_text,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    d.filename
  FROM public.document_chunks dc
  JOIN public.documents d ON dc.document_id = d.id
  WHERE d.user_id = user_id_param
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
