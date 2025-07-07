
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Enhanced PDF.js worker setup with multiple fallbacks
if (typeof window !== 'undefined') {
  try {
    // Try different worker sources in order of preference
    const workerSources = [
      `/node_modules/pdfjs-dist/build/pdf.worker.min.js`,
      `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`,
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`,
      'https://mozilla.github.io/pdf.js/build/pdf.worker.min.js'
    ];
    
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSources[1]; // Start with unpkg
    console.log('PDF.js worker configured with:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  } catch (error) {
    console.warn('PDF.js worker setup warning:', error);
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
      const result = await extractPDFTextEnhanced(file);
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

const extractPDFTextEnhanced = async (file: File): Promise<{content: string, details: any}> => {
  console.log('Starting enhanced PDF extraction for:', file.name);
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('PDF arrayBuffer size:', arrayBuffer.byteLength);
    
    // Enhanced PDF loading options
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useSystemFonts: true,
      disableFontFace: false, // Enable font face for better text extraction
      isEvalSupported: false,
      useWorkerFetch: false,
      disableAutoFetch: false,
      disableStream: false,
      maxImageSize: 1024 * 1024, // 1MB max image size
      verbosity: 0 // Reduce console spam
    });

    const pdf = await loadingTask.promise;
    console.log(`PDF loaded successfully. Pages: ${pdf.numPages}`);
    
    let fullText = '';
    let successfulPages = 0;
    let hasImages = false;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        console.log(`Processing PDF page ${pageNum}/${pdf.numPages}`);
        const page = await pdf.getPage(pageNum);
        
        // Get text content
        const textContent = await page.getTextContent({
          includeMarkedContent: true,
          disableCombineTextItems: false
        });
        
        // Check if page has images
        const operatorList = await page.getOperatorList();
        if (operatorList.fnArray.includes(pdfjsLib.OPS.paintImageXObject)) {
          hasImages = true;
        }
        
        if (textContent.items && textContent.items.length > 0) {
          const pageText = textContent.items
            .filter((item): item is any => 'str' in item && item.str.trim().length > 0)
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
        // Continue with other pages instead of failing completely
      }
    }

    if (successfulPages === 0) {
      throw new Error(`No readable text found in PDF. This may be an image-based PDF or the text may be embedded as images. Extracted from ${successfulPages}/${pdf.numPages} pages.`);
    }

    if (fullText.trim().length < 10) {
      throw new Error(`Very little text extracted (${fullText.length} characters). This PDF may contain mostly images or have text rendering issues.`);
    }

    console.log(`PDF extraction completed: ${fullText.length} characters from ${successfulPages}/${pdf.numPages} pages`);

    return {
      content: fullText.trim(),
      details: {
        extractionMethod: 'PDF.js enhanced',
        pageCount: pdf.numPages,
        successfulPages,
        hasImages
      }
    };
  } catch (error) {
    console.error('Enhanced PDF extraction failed:', error);
    
    // Provide specific error messages based on error type
    if (error.message.includes('Invalid PDF')) {
      throw new Error('Invalid PDF file format. Please ensure the file is a valid PDF document.');
    } else if (error.message.includes('Password')) {
      throw new Error('Password-protected PDF detected. Please provide an unprotected PDF file.');
    } else if (error.message.includes('fetch')) {
      throw new Error('PDF processing service temporarily unavailable. Please try again in a moment.');
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
    
    // Enhanced mammoth options for better text extraction
    const result = await mammoth.extractRawText({ 
      arrayBuffer,
      // Additional options for better text extraction
      convertImage: mammoth.images.ignoreImage // Ignore images for now, focus on text
    });
    
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

export const chunkText = (text: string, chunkSize: number = 1000, overlap: number = 200): string[] => {
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
      if (sentenceEnd > chunk.length * 0.7) { // Only break if we're not cutting too much
        chunk = text.slice(start, start + sentenceEnd + 2);
      }
    }
    
    const trimmedChunk = chunk.trim();
    if (trimmedChunk.length > 10) { // Only add meaningful chunks
      chunks.push(trimmedChunk);
      console.log(`Chunk ${chunks.length}: ${trimmedChunk.length} characters`);
    }
    
    if (end === text.length) break;
    start = Math.max(start + chunk.length - overlap, start + 1); // Ensure progress
  }

  console.log(`Text chunking completed: ${chunks.length} chunks created`);
  return chunks;
};
