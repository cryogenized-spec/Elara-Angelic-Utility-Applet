export interface OCRBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRBlock {
  text: string;
  confidence?: number;
  bounds?: OCRBounds;
}

export interface OCRResult {
  text: string;
  blocks: OCRBlock[];
  confidence?: number;
  language?: string;
}

export interface OCRRegion extends OCRBounds {}

export interface OCRRecognizeOptions {
  language?: string;
  region?: OCRRegion;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Stable identity used to isolate preprocessing cache entries. */
  sourceArtifactId?: string;
}

export interface OCRService {
  recognize(image: Blob, options?: OCRRecognizeOptions): Promise<OCRResult>;
  recognizeRegion(image: Blob, crop: OCRRegion, options?: Omit<OCRRecognizeOptions, 'region'>): Promise<OCRResult>;
}

export interface OCRWorkerRequest {
  id: string;
  blob: Blob;
  language: string;
  region?: OCRRegion;
}

export interface OCRWorkerResponse {
  id: string;
  ok: boolean;
  result?: OCRResult;
  error?: string;
}
