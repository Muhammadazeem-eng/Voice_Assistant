
import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Plus, File, Trash2, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { processDocument, chunkText } from '@/utils/documentProcessor';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  created_at: string;
}

interface DocumentUploadProps {
  documents: Document[];
  onDocumentsChange: (documents: Document[]) => void;
  apiKey: string;
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({ 
  documents, 
  onDocumentsChange, 
  apiKey 
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [user, setUser] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check user authentication
  React.useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    checkUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user || null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to upload documents.",
        variant: "destructive"
      });
      return;
    }

    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please configure your OpenAI API key to upload documents.",
        variant: "destructive"
      });
      return;
    }

    const file = files[0];
    if (!file.type.includes('pdf') && !file.type.includes('wordprocessingml')) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF or DOCX files only.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setUploadProgress(0);

    try {
      // Process document
      setUploadProgress(20);
      const processedDoc = await processDocument(file);
      
      // Store document in database
      setUploadProgress(40);
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          filename: processedDoc.filename,
          file_type: processedDoc.fileType,
          file_size: processedDoc.fileSize,
          content: processedDoc.content,
          user_id: user.id
        })
        .select()
        .single();

      if (docError) throw docError;

      // Chunk the text
      setUploadProgress(60);
      const chunks = chunkText(processedDoc.content);
      
      // Generate embeddings and store chunks
      setUploadProgress(80);
      await processChunks(chunks, docData.id, apiKey);
      
      setUploadProgress(100);
      
      // Update documents list
      onDocumentsChange([...documents, docData]);
      
      toast({
        title: "Document uploaded successfully",
        description: `${processedDoc.filename} has been processed and is ready for chat.`
      });

    } catch (error) {
      console.error('Error uploading document:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to process the document. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processChunks = async (chunks: string[], documentId: string, apiKey: string) => {
    const batchSize = 10;
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      
      // Generate embeddings for batch
      const embeddingPromises = batch.map(async (chunk, index) => {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: chunk,
            encoding_format: 'float'
          })
        });

        if (!response.ok) {
          throw new Error('Failed to generate embedding');
        }

        const result = await response.json();
        return {
          document_id: documentId,
          chunk_text: chunk,
          chunk_index: i + index,
          embedding: result.data[0].embedding
        };
      });

      const chunkData = await Promise.all(embeddingPromises);
      
      // Store chunks in database
      const { error } = await supabase
        .from('document_chunks')
        .insert(chunkData);

      if (error) throw error;
    }
  };

  const deleteDocument = async (documentId: string) => {
    if (!user) {
      toast({
        title: "Authentication Required",
        description: "Please sign in to delete documents.",
        variant: "destructive"
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId);

      if (error) throw error;

      onDocumentsChange(documents.filter(doc => doc.id !== documentId));
      
      toast({
        title: "Document deleted",
        description: "Document and its embeddings have been removed."
      });
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: "Delete failed",
        description: "Failed to delete the document.",
        variant: "destructive"
      });
    }
  };

  if (!user) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-slate-200">Documents</h4>
        </div>
        
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please sign in to upload and chat with documents.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-slate-200">Documents</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="border-slate-600 text-slate-300 hover:bg-slate-800"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Document
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isProcessing}
      />

      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Processing document...</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between p-2 bg-slate-800 rounded-lg">
            <div className="flex items-center gap-2">
              <File className="w-4 h-4 text-slate-400" />
              <div>
                <p className="text-sm text-slate-200">{doc.filename}</p>
                <p className="text-xs text-slate-400">
                  {Math.round(doc.file_size / 1024)}KB • {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteDocument(doc.id)}
              className="text-slate-400 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        
        {documents.length === 0 && (
          <p className="text-sm text-slate-500 italic text-center py-4">
            No documents uploaded yet. Add PDFs or DOCX files to chat with them.
          </p>
        )}
      </div>
    </div>
  );
};

export default DocumentUpload;
