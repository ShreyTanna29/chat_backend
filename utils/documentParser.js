/**
 * Document Parser Utility
 * Extracts text content from various document formats (PDF, DOCX, TXT, etc.)
 */

const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

/**
 * Supported document MIME types
 */
const SUPPORTED_DOCUMENT_TYPES = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "text/html": "html",
  "application/rtf": "rtf",
};

/**
 * Check if a MIME type is a supported document type
 * @param {string} mimetype - The MIME type to check
 * @returns {boolean}
 */
function isSupportedDocument(mimetype) {
  return mimetype in SUPPORTED_DOCUMENT_TYPES;
}

/**
 * Get the file extension for a MIME type
 * @param {string} mimetype - The MIME type
 * @returns {string|null}
 */
function getDocumentExtension(mimetype) {
  return SUPPORTED_DOCUMENT_TYPES[mimetype] || null;
}

/**
 * Extract text content from a PDF buffer
 * @param {Buffer} buffer - The PDF file buffer
 * @returns {Promise<string>}
 */
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (error) {
    console.error("[DOCUMENT_PARSER] Error parsing PDF:", error.message);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

/**
 * Extract text content from a DOCX buffer
 * @param {Buffer} buffer - The DOCX file buffer
 * @returns {Promise<string>}
 */
async function parseDOCX(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (error) {
    console.error("[DOCUMENT_PARSER] Error parsing DOCX:", error.message);
    throw new Error(`Failed to parse DOCX: ${error.message}`);
  }
}

/**
 * Extract text content from a plain text buffer
 * @param {Buffer} buffer - The text file buffer
 * @returns {Promise<string>}
 */
async function parseText(buffer) {
  return buffer.toString("utf-8");
}

/**
 * Parse document and extract text content
 * @param {Buffer} buffer - The document buffer
 * @param {string} mimetype - The MIME type of the document
 * @param {string} [filename] - Optional filename for context
 * @returns {Promise<{text: string, metadata: object}>}
 */
async function parseDocument(buffer, mimetype, filename = "document") {
  console.log("[DOCUMENT_PARSER] Parsing document:", {
    mimetype,
    filename,
    bufferSize: buffer.length,
  });

  if (!isSupportedDocument(mimetype)) {
    throw new Error(`Unsupported document type: ${mimetype}`);
  }

  let text = "";
  const extension = getDocumentExtension(mimetype);

  switch (extension) {
    case "pdf":
      text = await parsePDF(buffer);
      break;
    case "docx":
      text = await parseDOCX(buffer);
      break;
    case "doc":
      // For .doc files, try to extract as text (limited support)
      // In production, you might want to use a different library
      text = await parseText(buffer);
      break;
    case "txt":
    case "md":
    case "csv":
    case "json":
    case "html":
    case "rtf":
      text = await parseText(buffer);
      break;
    default:
      throw new Error(`No parser available for document type: ${extension}`);
  }

  // Clean up the extracted text
  text = text.trim();

  // Truncate if too long (to avoid token limits)
  const MAX_DOCUMENT_LENGTH = 100000; // ~100k characters
  if (text.length > MAX_DOCUMENT_LENGTH) {
    console.log(
      "[DOCUMENT_PARSER] Document truncated from",
      text.length,
      "to",
      MAX_DOCUMENT_LENGTH,
      "characters"
    );
    text =
      text.substring(0, MAX_DOCUMENT_LENGTH) +
      "\n\n[Document truncated due to length...]";
  }

  console.log("[DOCUMENT_PARSER] ✓ Document parsed successfully:", {
    extractedLength: text.length,
    preview: text.substring(0, 100) + (text.length > 100 ? "..." : ""),
  });

  return {
    text,
    metadata: {
      filename,
      mimetype,
      extension,
      originalSize: buffer.length,
      extractedLength: text.length,
    },
  };
}

module.exports = {
  parseDocument,
  isSupportedDocument,
  getDocumentExtension,
  SUPPORTED_DOCUMENT_TYPES,
};
