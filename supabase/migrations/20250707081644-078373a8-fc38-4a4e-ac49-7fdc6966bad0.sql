
-- Drop all existing RLS policies
DROP POLICY IF EXISTS "Users can view their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert their own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete their own documents" ON public.documents;

DROP POLICY IF EXISTS "Users can view chunks of their documents" ON public.document_chunks;
DROP POLICY IF EXISTS "Users can insert chunks for their documents" ON public.document_chunks;

DROP POLICY IF EXISTS "Users can view their own chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can insert their own chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can update their own chat sessions" ON public.chat_sessions;
DROP POLICY IF EXISTS "Users can delete their own chat sessions" ON public.chat_sessions;

DROP POLICY IF EXISTS "Users can view messages from their sessions" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert messages to their sessions" ON public.chat_messages;

-- Disable RLS on all tables
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages DISABLE ROW LEVEL SECURITY;

-- Modify documents table to use session_id instead of user_id
ALTER TABLE public.documents DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Modify chat_sessions table to use session_id instead of user_id
ALTER TABLE public.chat_sessions DROP COLUMN IF EXISTS user_id;
ALTER TABLE public.chat_sessions ADD COLUMN IF NOT EXISTS browser_session_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Update the search function to work without user_id parameter
CREATE OR REPLACE FUNCTION public.search_document_chunks(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5,
  session_id_param text DEFAULT NULL
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
  WHERE (session_id_param IS NULL OR d.session_id = session_id_param)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
