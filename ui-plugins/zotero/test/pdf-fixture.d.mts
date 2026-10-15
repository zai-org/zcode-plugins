export function makePdf(pages: string[][], options?: { labels?: { start: number; style: "r" | "D"; first?: number }[]; width?: number; height?: number; unicodeMap?: Record<string, string> }): Buffer;
export function samplePaper(): Buffer;
