
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Simple PDF.js worker setup with local fallback
if (typeof window !== 'undefined') {
  try {
    // Use the built-in worker from the package
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.js',
      import.meta.url
    ).toString();
    console.log('PDF.js worker configured successfully');
  } catch (error) {
    console.warn('PDF.js worker setup warning:', error);
    // Fallback to CDN worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

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
      const result = await extractPDFTextSimplified(file);
      content = result.content;
      processingDetails = result.details;
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await extractDOCXTextEnhanced(file);
      content = result.content;
      processingDetails = result.details;
    } else {
      throw new Error(`Unsupported file type: ${fileType}. Please upload PDF or DOCX files only.`);
    }

    if (!content || content.trim().length === 0) {
      throw new Error('No readable text content could be extracted from the document. The file may be image-based, corrupted, or password-protected.');
    }

    const wordCount = content.split(/\s+/).length;
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

const extractPDFTextSimplified = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting simplified PDF extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('PDF arrayBuffer size:', arrayBuffer.byteLength);
    
    // Simplified PDF loading with minimal configuration
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      verbosity: 0,
      standardFontDataUrl: undefined, // Disable font loading
      cMapUrl: undefined, // Disable cMap loading
      useSystemFonts: false
    }).promise;

    console.log(`PDF loaded successfully. Pages: ${pdf.numPages}`);
    
    let fullText = '';
    let successfulPages = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        console.log(`Processing PDF page ${pageNum}/${pdf.numPages}`);
        const page = await pdf.getPage(pageNum);
        
        // Get text content with basic options
        const textContent = await page.getTextContent();
        
        if (textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter((item): item is any => 'str' in item && item.str && item.str.trim().length > 0)
            .map((item) => item.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (pageText.length > 0) {
            fullText += pageText + '\n\n';
            successfulPages++;
            console.log(`Page ${pageNum} extracted: ${pageText.length} characters`);
          }
        }
      } catch (pageError) {
        console.warn(`Error processing PDF page ${pageNum}:`, pageError.message);
        // Continue with other pages
      }
    }

    if (successfulPages === 0) {
      throw new Error(`No readable text found in PDF. This may be an image-based PDF. Processed ${successfulPages}/${pdf.numPages} pages.`);
    }

    if (fullText.trim().length < 10) {
      throw new Error(`Very little text extracted (${fullText.length} characters). This PDF may contain mostly images.`);
    }

    console.log(`PDF extraction completed: ${fullText.length} characters from ${successfulPages}/${pdf.numPages} pages`);

    return {
      content: fullText.trim(),
      details: {
        extractionMethod: 'PDF.js simplified',
        pageCount: pdf.numPages,
        successfulPages
      }
    };
  } catch (error) {
    console.error('PDF extraction failed:', error);
    
    // Provide specific error messages
    if (error.message.includes('Invalid PDF')) {
      throw new Error('Invalid PDF file format. Please ensure the file is a valid PDF document.');
    } else if (error.message.includes('Password')) {
      throw new Error('Password-protected PDF detected. Please provide an unprotected PDF file.');
    } else {
      throw new Error(`PDF text extraction failed: ${error.message}. This may be an image-based PDF or contain complex formatting.`);
    }
  }
};

const extractDOCXTextEnhanced = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting enhanced DOCX extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('DOCX arrayBuffer size:', arrayBuffer.byteLength);
    
    // Use mammoth to extract raw text
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
      throw new Error('No readable text content found in DOCX file. The document may be empty, corrupted, or contain only images.');
    }
    
    // Clean up the extracted text
    const cleanedText = result.value
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n') // Remove excessive line breaks
      .trim();
    
    console.log(`DOCX extraction completed: ${cleanedText.length} characters`);
    
    return {
      content: cleanedText,
      details: {
        extractionMethod: 'Mammoth enhanced',
        hasImages: result.messages?.some(msg => msg.message.includes('image')) || false
      }
    };
  } catch (error) {
    console.error('Enhanced DOCX extraction failed:', error);
    
    if (error.message.includes('not a valid zip file')) {
      throw new Error('Invalid DOCX file format. Please ensure the file is a valid Word document.');
    } else if (error.message.includes('encrypted')) {
      throw new Error('Password-protected DOCX detected. Please provide an unprotected document.');
    } else {
      throw new Error(`DOCX text extraction failed: ${error.message}`);
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
      if (sentenceEnd > chunk.length * 0.6) { // Only break if we're not cutting too much
        chunk = text.slice(start, start + sentenceEnd + 2);
      }
    }
    
    const trimmedChunk = chunk.trim();
    if (trimmedChunk.length > 20) { // Only add meaningful chunks
      chunks.push(trimmedChunk);
      console.log(`Chunk ${chunks.length}: ${trimmedChunk.length} characters`);
    }
    
    if (end === text.length) break;
    start = Math.max(start + chunk.length - overlap, start + 1); // Ensure progress
  }

  console.log(`Text chunking completed: ${chunks.length} chunks created`);
  return chunks;
};
