
import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface ProcessedDocument {
  content: string;
  filename: string;
  fileType: string;
  fileSize: number;
}

export const processDocument = async (file: File): Promise<ProcessedDocument> => {
  const fileType = file.type;
  let content = '';

  if (fileType === 'application/pdf') {
    content = await extractPDFText(file);
  } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    content = await extractDOCXText(file);
  } else {
    throw new Error('Unsupported file type. Please upload PDF or DOCX files.');
  }

  return {
    content,
    filename: file.name,
    fileType,
    fileSize: file.size
  };
};

const extractPDFText = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is any => 'str' in item)
      .map((item) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }

  return fullText.trim();
};

const extractDOCXText = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
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
