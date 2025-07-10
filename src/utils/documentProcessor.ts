import mammoth from 'mammoth';
import { pdfjs } from 'react-pdf';

// Configure react-pdf worker with a more reliable approach
try {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).toString();
} catch (error) {
  console.warn('Failed to set PDF worker source:', error);
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
}

// PDF.co API configuration
const PDFCO_API_KEY = 'muhammad.azm556@gmail.com_rqoOK38F3gw4cb6zanXLtzTsBso1CTzLK9CCffCnDKPQOHprXjW1EkKfS6oQbCSq';
const PDFCO_BASE_URL = 'https://api.pdf.co/v1';

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
      const result = await extractPDFTextWithPDFCo(file);
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

const extractPDFTextWithPDFCo = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting PDF text extraction with PDF.co for:', file.name);
  
  try {
    // Step 1: Upload file to PDF.co
    const uploadFormData = new FormData();
    uploadFormData.append('file', file);
    
    console.log('Uploading PDF to PDF.co...');
    const uploadResponse = await fetch(`${PDFCO_BASE_URL}/file/upload`, {
      method: 'POST',
      headers: {
        'x-api-key': PDFCO_API_KEY
      },
      body: uploadFormData
    });

    console.log('Upload response status:', uploadResponse.status);
    console.log('Upload response headers:', Object.fromEntries(uploadResponse.headers.entries()));

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('PDF.co upload error response:', errorText);
      throw new Error(`PDF.co upload failed: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadData = await uploadResponse.json();
    console.log('PDF uploaded to PDF.co successfully:', uploadData);

    if (!uploadData.url) {
      throw new Error('PDF.co upload did not return a valid URL');
    }

    // Step 2: Extract text using PDF.co
    const extractPayload = {
      url: uploadData.url,
      pages: '',  // Extract all pages
      password: '', // No password
      async: false
    };

    console.log('Extracting text with payload:', extractPayload);

    const extractResponse = await fetch(`${PDFCO_BASE_URL}/pdf/convert/to/text`, {
      method: 'POST',
      headers: {
        'x-api-key': PDFCO_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(extractPayload)
    });

    console.log('Extract response status:', extractResponse.status);
    console.log('Extract response headers:', Object.fromEntries(extractResponse.headers.entries()));

    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      console.error('PDF.co extraction error response:', errorText);
      throw new Error(`PDF.co text extraction failed: ${extractResponse.status} - ${errorText}`);
    }

    const extractData = await extractResponse.json();
    console.log('PDF.co extraction response:', {
      error: extractData.error,
      hasBody: !!extractData.body,
      bodyLength: extractData.body?.length || 0,
      message: extractData.message,
      url: extractData.url
    });

    if (extractData.error === true) {
      throw new Error(`PDF.co extraction error: ${extractData.message || 'Unknown error'}`);
    }

    // Check if we have text content
    let textContent = '';
    if (extractData.body && typeof extractData.body === 'string') {
      textContent = extractData.body;
    } else if (extractData.url) {
      // If PDF.co returns a URL to the text file, fetch it
      console.log('Fetching text content from URL:', extractData.url);
      const textResponse = await fetch(extractData.url);
      if (textResponse.ok) {
        textContent = await textResponse.text();
      }
    }

    if (!textContent || textContent.trim().length === 0) {
      console.log('PDF.co extraction returned empty text. Response:', extractData);
      throw new Error('PDF appears to contain no readable text content. It may be image-based or corrupted.');
    }

    // Clean up the extracted text
    const cleanedText = textContent
      .replace(/\r\n/g, '\n')
      .replace(/\s{3,}/g, ' ')  // Replace multiple spaces with single space
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Normalize paragraph breaks
      .trim();

    console.log(`PDF.co text extraction completed: ${cleanedText.length} characters total`);

    return {
      content: cleanedText,
      details: {
        extractionMethod: 'PDF.co API',
        totalTextLength: cleanedText.length
      }
    };

  } catch (error) {
    console.error('PDF.co extraction failed:', error);
    throw new Error(`PDF processing failed: ${error.message}. Please ensure the PDF contains readable text and try again.`);
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
