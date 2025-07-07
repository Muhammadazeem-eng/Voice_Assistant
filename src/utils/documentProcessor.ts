
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker with multiple fallback options
if (typeof window !== 'undefined') {
  try {
    // Try to use the bundled worker first
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    console.log('PDF.js worker configured with CDN');
  } catch (error) {
    console.warn('PDF.js worker setup error:', error);
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

    if (!content || content.trim().length === 0) {
      throw new Error('No readable text content could be extracted from the document. The file may be image-based, corrupted, or password-protected.');
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
  console.log('Starting PDF extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('PDF arrayBuffer size:', arrayBuffer.byteLength);
    
    // Load PDF with minimal configuration
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      verbosity: 0
    }).promise;

    console.log(`PDF loaded successfully. Pages: ${pdf.numPages}`);
    
    let allText = '';
    let processedPages = 0;
    let totalTextLength = 0;

    // Process each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        console.log(`Processing PDF page ${pageNum}/${pdf.numPages}`);
        const page = await pdf.getPage(pageNum);
        
        // Extract text content
        const textContent = await page.getTextContent();
        
        // Process text items more permissively
        let pageText = '';
        if (textContent.items && textContent.items.length > 0) {
          pageText = textContent.items
            .map((item: any) => {
              // Handle different item types
              if (item.str !== undefined) {
                return item.str;
              }
              return '';
            })
            .filter(text => text && text.trim().length > 0)
            .join(' ');
        }
        
        // Clean up the page text
        pageText = pageText
          .replace(/\s+/g, ' ')
          .trim();
        
        if (pageText.length > 0) {
          allText += pageText + '\n\n';
          totalTextLength += pageText.length;
          processedPages++;
          console.log(`Page ${pageNum}: extracted ${pageText.length} characters`);
        } else {
          console.log(`Page ${pageNum}: no text found`);
        }
        
      } catch (pageError) {
        console.warn(`Error processing PDF page ${pageNum}:`, pageError.message);
        // Continue with other pages instead of failing
        continue;
      }
    }

    console.log(`PDF processing summary: ${processedPages}/${pdf.numPages} pages processed, ${totalTextLength} total characters`);

    // Be more lenient with text validation
    if (totalTextLength === 0) {
      throw new Error(`No text content found in any pages. This appears to be an image-based PDF that requires OCR processing.`);
    }

    // Accept even small amounts of text (some PDFs have sparse text)
    if (totalTextLength < 5) {
      console.warn(`Very little text extracted (${totalTextLength} characters), but proceeding anyway`);
    }

    return {
      content: allText.trim(),
      details: {
        extractionMethod: 'PDF.js text extraction',
        pageCount: pdf.numPages,
        processedPages,
        totalTextLength
      }
    };
    
  } catch (error) {
    console.error('PDF extraction failed:', error);
    
    // Provide more specific error messages
    if (error.message.includes('Invalid PDF')) {
      throw new Error('This file does not appear to be a valid PDF document.');
    } else if (error.message.includes('password') || error.message.includes('encrypted')) {
      throw new Error('This PDF is password-protected. Please provide an unprotected PDF file.');
    } else if (error.message.includes('image-based')) {
      throw error; // Re-throw our custom message
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
    if (trimmedChunk.length > 10) { // Reduced minimum chunk size
      chunks.push(trimmedChunk);
      console.log(`Chunk ${chunks.length}: ${trimmedChunk.length} characters`);
    }
    
    if (end === text.length) break;
    start = Math.max(start + chunk.length - overlap, start + 1);
  }

  console.log(`Text chunking completed: ${chunks.length} chunks created`);
  return chunks;
};
