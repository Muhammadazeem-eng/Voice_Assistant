import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Plus, File, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { processDocument, chunkText } from '@/utils/documentProcessor';
import { supabase } from '@/integrations/supabase/client';
import { getOrCreateSessionId } from '@/utils/sessionUtils';

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
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionId = getOrCreateSessionId();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Validate API key first
    if (!apiKey || apiKey.trim().length === 0) {
      toast({
        title: "API Key Required",
        description: "Please configure your OpenAI API key to upload documents.",
        variant: "destructive"
      });
      return;
    }

    const file = files[0];
    const supportedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (!supportedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload PDF or DOCX files only.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setUploadProgress(0);
    setProcessingStatus('Preparing document...');

    try {
      console.log(`=== Starting document upload process for: ${file.name} ===`);
      console.log('File details:', {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: new Date(file.lastModified).toISOString()
      });
      console.log('API Key configured:', apiKey ? 'Yes' : 'No');
      
      // Step 1: Process document with better error handling and consistent progress updates
      setUploadProgress(15);
      if (file.type === 'application/pdf') {
        setProcessingStatus('Extracting text from PDF...');
      } else {
        setProcessingStatus('Extracting text from document...');
      }
      
      let processedDoc;
      try {
        processedDoc = await processDocument(file);
        console.log('Document processing completed:', {
          contentLength: processedDoc.content.length,
          wordCount: processedDoc.processingDetails?.wordCount,
          extractionMethod: processedDoc.processingDetails?.extractionMethod
        });
      } catch (processingError) {
        console.error('Document processing failed:', processingError);
        throw new Error(`Document processing failed: ${processingError.message}`);
      }
      
      // Step 2: Store document in database
      setUploadProgress(30);
      setProcessingStatus('Storing document in database...');
      
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          filename: processedDoc.filename,
          file_type: processedDoc.fileType,
          file_size: processedDoc.fileSize,
          content: processedDoc.content,
          session_id: sessionId
        })
        .select()
        .single();

      if (docError) {
        console.error('Database insertion error:', docError);
        throw new Error(`Database error: ${docError.message}`);
      }
      
      console.log('Document stored in database with ID:', docData.id);

      // Step 3: Generate text chunks
      setUploadProgress(45);
      setProcessingStatus('Creating text chunks...');
      const chunks = chunkText(processedDoc.content, 1000, 200);
      
      console.log(`Generated ${chunks.length} text chunks`);
      
      if (chunks.length === 0) {
        throw new Error('No valid text chunks could be created from the document content.');
      }
      
      // Step 4: Process chunks with embeddings and better error handling
      setUploadProgress(60);
      setProcessingStatus('Generating embeddings...');
      await processChunksWithEmbeddings(chunks, docData.id, apiKey.trim(), (progress) => {
        setUploadProgress(60 + (progress * 35)); // 60-95% for embeddings
        setProcessingStatus(`Processing embeddings... (${Math.round(progress * 100)}%)`);
      });
      
      setUploadProgress(100);
      setProcessingStatus('Upload completed!');
      
      // Update documents list
      onDocumentsChange([...documents, docData]);
      
      // Verify the document was processed correctly
      await verifyDocumentProcessing(docData.id);
      
      toast({
        title: "Document uploaded successfully",
        description: `${processedDoc.filename} has been processed and is ready for chat. ${chunks.length} text chunks created.`,
        duration: 5000
      });

      console.log(`=== Document upload completed successfully for: ${file.name} ===`);

    } catch (error) {
      console.error('Error uploading document:', error);
      setProcessingStatus('Upload failed');
      
      // Provide specific error messages based on error type
      let errorMessage = error.message || "Failed to process the document. Please try again.";
      let errorTitle = "Upload failed";
      
      if (error.message.includes('image-based')) {
        errorTitle = "Image-based PDF detected";
        errorMessage = "This PDF appears to contain mostly images. Please try a PDF with selectable text.";
      } else if (error.message.includes('corrupted') || error.message.includes('Invalid PDF')) {
        errorTitle = "File appears corrupted";
        errorMessage = "The file may be corrupted or password-protected. Please try a different file.";
      } else if (error.message.includes('API') || error.message.includes('Embedding')) {
        errorTitle = "API Error";
        errorMessage = "There was an issue with the embedding generation. Please check your API key and try again.";
      } else if (error.message.includes('401') || error.message.includes('Invalid API key')) {
        errorTitle = "Invalid API Key";
        errorMessage = "Your OpenAI API key appears to be invalid. Please check your API key configuration.";
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
        duration: 10000
      });
    } finally {
      setIsProcessing(false);
      setUploadProgress(0);
      setProcessingStatus('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const processChunksWithEmbeddings = async (
    chunks: string[], 
    documentId: string, 
    apiKey: string,
    onProgress?: (progress: number) => void
  ) => {
    const batchSize = 3; // Smaller batches for more reliable processing
    const totalBatches = Math.ceil(chunks.length / batchSize);
    
    console.log(`Processing ${chunks.length} chunks in ${totalBatches} batches`);
    console.log('Using API key (first 10 chars):', apiKey.substring(0, 10) + '...');
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} chunks)`);
      
      try {
        // Generate embeddings for batch with enhanced error handling
        const embeddingPromises = batch.map(async (chunk, index) => {
          const actualIndex = i + index;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(`Generating embedding for chunk ${actualIndex} (attempt ${attempt})`);
              
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
                const errorData = await response.json().catch(() => null);
                const errorMessage = errorData?.error?.message || response.statusText;
                console.error(`API error for chunk ${actualIndex}:`, response.status, errorMessage);
                
                if (response.status === 401) {
                  throw new Error('Invalid API key. Please check your OpenAI API key configuration.');
                } else if (response.status === 429) {
                  throw new Error('Rate limit exceeded. Please wait a moment and try again.');
                } else {
                  throw new Error(`Embedding API error (${response.status}): ${errorMessage}`);
                }
              }

              const result = await response.json();
              console.log(`Embedding generated successfully for chunk ${actualIndex}`);
              
              return {
                document_id: documentId,
                chunk_text: chunk,
                chunk_index: actualIndex,
                embedding: result.data[0].embedding
              };
            } catch (error) {
              console.warn(`Embedding attempt ${attempt} failed for chunk ${actualIndex}:`, error.message);
              if (attempt === 3) throw error;
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            }
          }
        });

        const chunkData = await Promise.all(embeddingPromises);
        console.log(`Generated embeddings for batch ${batchNumber}`);
        
        // Store chunks in database
        const { error } = await supabase
          .from('document_chunks')
          .insert(chunkData);

        if (error) {
          console.error('Database insertion error for batch', batchNumber, ':', error);
          throw new Error(`Database error for batch ${batchNumber}: ${error.message}`);
        }
        
        console.log(`Batch ${batchNumber} stored successfully in database`);
        
        // Update progress
        if (onProgress) {
          onProgress((batchNumber) / totalBatches);
        }
        
        // Small delay between batches to avoid rate limiting
        if (batchNumber < totalBatches) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (error) {
        console.error(`Error processing batch ${batchNumber}:`, error);
        throw new Error(`Failed to process document chunks (batch ${batchNumber}): ${error.message}`);
      }
    }
    console.log('All chunks processed and stored successfully');
  };

  const verifyDocumentProcessing = async (documentId: string) => {
    try {
      const { data: chunks, error } = await supabase
        .from('document_chunks')
        .select('id, chunk_index, chunk_text')
        .eq('document_id', documentId)
        .limit(5);

      if (error) throw error;

      console.log('Document processing verification:', {
        documentId,
        chunksStored: chunks?.length || 0,
        sampleChunks: chunks?.map(c => ({
          index: c.chunk_index,
          textPreview: c.chunk_text.substring(0, 50) + '...'
        }))
      });

      if (!chunks || chunks.length === 0) {
        console.warn('Warning: No chunks found in database after processing');
      }
    } catch (error) {
      console.error('Error verifying document processing:', error);
    }
  };

  const deleteDocument = async (documentId: string) => {
    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', documentId)
        .eq('session_id', sessionId);

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
        <div className="space-y-3 p-4 bg-slate-800 rounded-lg border border-slate-600">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">{processingStatus}</span>
            <span className="text-slate-400">{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
          {uploadProgress > 0 && uploadProgress < 100 && (
            <p className="text-xs text-slate-500">
              This may take a moment depending on document size...
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
            <div className="flex items-center gap-3">
              <div className="flex items-center">
                <File className="w-4 h-4 text-slate-400" />
                <CheckCircle className="w-3 h-3 text-green-500 ml-1" />
              </div>
              <div>
                <p className="text-sm text-slate-200 font-medium">{doc.filename}</p>
                <p className="text-xs text-slate-400">
                  {Math.round(doc.file_size / 1024)}KB • {new Date(doc.created_at).toLocaleDateString()} • Ready for chat
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
        
        {documents.length === 0 && !isProcessing && (
          <div className="text-center py-8 px-4 bg-slate-800/50 rounded-lg border border-slate-700 border-dashed">
            <File className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <p className="text-sm text-slate-400 mb-1">No documents uploaded yet</p>
            <p className="text-xs text-slate-500">Add PDFs or DOCX files to chat with their content</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentUpload;
