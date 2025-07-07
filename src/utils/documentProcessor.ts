
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Set up PDF.js worker with CDN fallback
if (typeof window !== 'undefined') {
  // Try to use the built-in worker first, fallback to CDN
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  } catch (error) {
    console.warn('PDF.js worker setup warning:', error);
    // Fallback to Mozilla CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://mozilla.github.io/pdf.js/build/pdf.worker.min.js';
  }
}

export interface ProcessedDocument {
  content: string;
  filename: string;
  fileType: string;
  fileSize: number;
}

export const processDocument = async (file: File): Promise<ProcessedDocument> => {
  const fileType = file.type;
  let content = '';

  try {
    if (fileType === 'application/pdf') {
      content = await extractPDFText(file);
    } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      content = await extractDOCXText(file);
    } else {
      throw new Error('Unsupported file type. Please upload PDF or DOCX files.');
    }

    if (!content || content.trim().length === 0) {
      throw new Error('No text content could be extracted from the document.');
    }

    return {
      content,
      filename: file.name,
      fileType,
      fileSize: file.size
    };
  } catch (error) {
    console.error('Document processing error:', error);
    throw new Error(`Failed to process ${file.name}: ${error.message}`);
  }
};

const extractPDFText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ 
      data: arrayBuffer,
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false
    }).promise;
    
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter((item): item is any => 'str' in item)
          .map((item) => item.str)
          .join(' ');
        fullText += pageText + '\n';
      } catch (pageError) {
        console.warn(`Error processing page ${i}:`, pageError);
        // Continue with other pages
      }
    }

    if (!fullText.trim()) {
      throw new Error('No text content found in PDF');
    }

    return fullText.trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF. The PDF might be image-based or corrupted.');
  }
};

const extractDOCXText = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    if (!result.value || result.value.trim().length === 0) {
      throw new Error('No text content found in DOCX');
    }
    
    return result.value.trim();
  } catch (error) {
    console.error('DOCX extraction error:', error);
    throw new Error('Failed to extract text from DOCX');
  }
};

export const chunkText = (text: string, chunkSize: number = 1000, overlap: number = 200): string[] => {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end);
    chunks.push(chunk.trim());
    
    if (end === text.length) break;
    start = end - overlap;
  }

  return chunks.filter(chunk => chunk.length > 0);
};
