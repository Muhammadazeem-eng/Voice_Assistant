import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker with proper version matching
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

export interface ProcessedDocument {
  content: string;
  filename: string;
  fileType: string;
  fileSize: number;
  processingDetails?: {
    extractionMethod: string;
    pageCount?: number;
    wordCount: number;
    hasImages?: boolean;
  };
}

export const processDocument = async (file: File): Promise<ProcessedDocument> => {
  const fileType = file.type;
  let content = '';
  let processingDetails: ProcessedDocument['processingDetails'];

  console.log(`Starting document processing for: ${file.name} (${fileType})`);

  try {
    if (fileType === 'application/pdf') {
      const result = await extractPDFText(file);
      content = result.content;
      processingDetails = result.details;
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await extractDOCXText(file);
      content = result.content;
      processingDetails = result.details;
    } else {
      throw new Error(`Unsupported file type: ${fileType}. Please upload PDF or DOCX files only.`);
    }

    // More lenient text validation
    if (!content || content.trim().length < 10) {
      throw new Error('Document appears to be empty or contains insufficient text content.');
    }

    const wordCount = content.split(/\s+/).filter(word => word.length > 0).length;
    console.log(`Document processed successfully: ${wordCount} words extracted`);

    return {
      content: content.trim(),
      filename: file.name,
      fileType,
      fileSize: file.size,
      processingDetails: {
        ...processingDetails,
        wordCount
      }
    };
  } catch (error) {
    console.error('Document processing error for', file.name, ':', error);
    throw new Error(`Failed to process ${file.name}: ${error.message}`);
  }
};

const extractPDFText = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting robust PDF text extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('PDF arrayBuffer size:', arrayBuffer.byteLength);
    
    // Load PDF with proper configuration
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      verbosity: 0,
      // Disable worker for better compatibility in some environments
      disableWorker: false,
      // Add error recovery options
      stopAtErrors: false
    }).promise;
    
    console.log(`PDF loaded successfully. Pages: ${pdf.numPages}`);
    
    let fullText = '';
    let successfulPages = 0;
    
    // Extract text from each page with better error handling
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Better text extraction with spacing preservation
        const pageText = textContent.items
          .filter((item: any) => item.str && typeof item.str === 'string')
          .map((item: any) => {
            // Preserve some spacing context
            const str = item.str.trim();
            return str;
          })
          .filter((text: string) => text.length > 0)
          .join(' ');
        
        if (pageText.trim().length > 0) {
          fullText += pageText + '\n\n';
          successfulPages++;
        }
        
        console.log(`Page ${pageNum}: ${pageText.length} characters extracted`);
      } catch (pageError) {
        console.warn(`Error processing page ${pageNum}:`, pageError);
        // Continue with other pages instead of failing
      }
    }
    
    console.log(`Successfully processed ${successfulPages}/${pdf.numPages} pages`);
    
    // Clean up the extracted text but preserve structure
    const cleanedText = fullText
      .replace(/\s{3,}/g, ' ')  // Replace multiple spaces with single space
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Normalize paragraph breaks
      .trim();
    
    console.log(`PDF text extraction completed: ${cleanedText.length} characters total`);
    
    // More lenient validation - accept even short documents
    if (!cleanedText || cleanedText.length < 5) {
      throw new Error('No readable text content found in PDF. This document may be image-based or corrupted.');
    }
    
    return {
      content: cleanedText,
      details: {
        extractionMethod: 'PDF.js browser extraction',
        pageCount: pdf.numPages,
        successfulPages,
        totalTextLength: cleanedText.length
      }
    };
    
  } catch (error) {
    console.error('PDF extraction failed:', error);
    
    // Provide more specific error messages
    if (error.message.includes('Invalid PDF') || error.message.includes('corrupted')) {
      throw new Error('Invalid PDF file. Please ensure the file is not corrupted.');
    } else if (error.message.includes('password') || error.message.includes('encrypted')) {
      throw new Error('PDF is password-protected. Please provide an unprotected file.');
    } else if (error.message.includes('image-based')) {
      throw error; // Re-throw our custom message
    } else if (error.message.includes('API version')) {
      throw new Error('PDF processing library error. Please try again or use a different PDF file.');
    } else {
      throw new Error(`PDF processing failed: ${error.message}`);
    }
  }
};

const extractDOCXText = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting DOCX extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('DOCX arrayBuffer size:', arrayBuffer.byteLength);
    
    // Use mammoth to extract text
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    console.log('DOCX extraction result:', {
      contentLength: result.value.length,
      messagesCount: result.messages?.length || 0
    });
    
    // Log any extraction messages/warnings
    if (result.messages && result.messages.length > 0) {
      console.log('DOCX extraction messages:', result.messages);
    }
    
    if (!result.value || result.value.trim().length === 0) {
      throw new Error('No readable text content found in DOCX file. The document may be empty or contain only images.');
    }
    
    // Clean up the extracted text
    const cleanedText = result.value
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
    
    console.log(`DOCX extraction completed: ${cleanedText.length} characters`);
    
    return {
      content: cleanedText,
      details: {
        extractionMethod: 'Mammoth text extraction',
        hasImages: result.messages?.some(msg => msg.message.includes('image')) || false
      }
    };
  } catch (error) {
    console.error('DOCX extraction failed:', error);
    
    if (error.message.includes('not a valid zip file')) {
      throw new Error('This file does not appear to be a valid Word document.');
    } else if (error.message.includes('encrypted')) {
      throw new Error('This Word document is password-protected. Please provide an unprotected document.');
    } else {
      throw new Error(`DOCX processing failed: ${error.message}`);
    }
  }
};

export const chunkText = (text: string, chunkSize: number = 800, overlap: number = 150): string[] => {
  console.log(`Starting text chunking: ${text.length} characters, chunk size: ${chunkSize}, overlap: ${overlap}`);
  
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);
    
    // Try to break at sentence boundaries if possible
    if (end < text.length) {
      const lastSentenceEnd = chunk.lastIndexOf('. ');
      const lastQuestionEnd = chunk.lastIndexOf('? ');
      const lastExclamationEnd = chunk.lastIndexOf('! ');
      
      const sentenceEnd = Math.max(lastSentenceEnd, lastQuestionEnd, lastExclamationEnd);
      if (sentenceEnd > chunk.length * 0.6) {
        chunk = text.slice(start, start + sentenceEnd + 2);
      }
    }
    
    const trimmedChunk = chunk.trim();
    if (trimmedChunk.length > 10) {
      chunks.push(trimmedChunk);
      console.log(`Chunk ${chunks.length}: ${trimmedChunk.length} characters`);
    }
    
    if (end === text.length) break;
    start = Math.max(start + chunk.length - overlap, start + 1);
  }

  console.log(`Text chunking completed: ${chunks.length} chunks created`);
  return chunks;
};
