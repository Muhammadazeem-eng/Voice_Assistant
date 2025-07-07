import React, { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, File } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { processDocument, chunkText } from '@/utils/documentProcessor';
import { supabase } from '@/integrations/supabase/client';

interface FileUploadProps {
  onFileProcessed: (text: string) => void;
  webhookUrl: string;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileProcessed, webhookUrl }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allowedTypes = ['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  const allowedExtensions = ['.wav', '.mp3', '.m4a', '.pdf', '.docx'];

  const validateFile = (file: File): boolean => {
    const isValidType = allowedTypes.includes(file.type);
    const hasValidExtension = allowedExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );

    if (!isValidType && !hasValidExtension) {
      toast({
        title: "Invalid file type",
        description: "Please upload audio files (.wav, .mp3, .m4a) or documents (.pdf, .docx).",
        variant: "destructive"
      });
      return false;
    }

    if (file.size > 100 * 1024 * 1024) { // 100MB limit
      toast({
        title: "File too large",
        description: "Please upload files smaller than 100MB.",
        variant: "destructive"
      });
      return false;
    }

    return true;
  };

  const processFile = async (file: File) => {
    if (!validateFile(file)) return;

    setIsProcessing(true);
    setCurrentFile(file.name);
    setUploadProgress(0);

    try {
      const isDocument = file.type.includes('pdf') || file.type.includes('wordprocessingml');
      
      if (isDocument) {
        // Process document
        setUploadProgress(25);
        const processedDoc = await processDocument(file);
        
        setUploadProgress(50);
        onFileProcessed(`[DOCUMENT: ${file.name}] Document content processed successfully. You can now ask questions about this document in the chat.`);
        
        setUploadProgress(100);
        toast({
          title: "Document processed successfully",
          description: `${file.name} has been processed. Use the chat to ask questions about it.`
        });
      } else {
        // Process audio file (existing logic)
        if (!webhookUrl) {
          // Simulate file processing for demo
          const duration = Math.random() * 3 + 2; // 2-5 seconds
          const steps = 20;
          const stepDuration = (duration * 1000) / steps;

          for (let i = 0; i <= steps; i++) {
            await new Promise(resolve => setTimeout(resolve, stepDuration));
            setUploadProgress((i / steps) * 100);
          }

          onFileProcessed(`[AUDIO: ${file.name}] Simulated transcription of uploaded audio file processed at ${new Date().toLocaleTimeString()}`);
        } else {
          await processWithWebhook(file);
        }
        
        toast({
          title: "File processed successfully",
          description: `${file.name} has been processed.`
        });
      }
    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: "Processing failed",
        description: "Failed to process the file. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
      setCurrentFile(null);
      setUploadProgress(0);
    }
  };

  const processWithWebhook = async (file: File) => {
    const chunkSize = 1024 * 1024; // 1MB chunks
    const totalChunks = Math.ceil(file.size / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      const formData = new FormData();
      formData.append('audio', chunk, `${file.name}_chunk_${i}`);
      formData.append('chunkIndex', i.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('originalName', file.name);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const result = await response.text();
        if (result.trim()) {
          onFileProcessed(result);
        }
      }

      setUploadProgress(((i + 1) / totalChunks) * 100);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col items-center space-y-2">
      <div
        className={`w-full h-16 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-blue-400 bg-blue-400/10'
            : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/30'
        } ${isProcessing ? 'pointer-events-none opacity-50' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
      >
        <div className="flex items-center gap-2 text-slate-400">
          {isProcessing ? (
            <>
              <File className="w-5 h-5" />
              <span className="text-sm">Processing...</span>
            </>
          ) : (
            <>
              <Upload className="w-5 h-5" />
              <span className="text-sm">Drop files or click</span>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.m4a,.pdf,.docx,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isProcessing}
      />

      {isProcessing && (
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Processing: {currentFile}</span>
            <span>{Math.round(uploadProgress)}%</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
        </div>
      )}

      <div className="text-center">
        <p className="text-sm text-slate-400">Audio & Document Upload</p>
        <p className="text-xs text-slate-500">Supports .wav, .mp3, .m4a, .pdf, .docx</p>
      </div>
    </div>
  );
};

export default FileUpload;
