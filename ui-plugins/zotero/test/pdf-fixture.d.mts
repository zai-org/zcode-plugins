export function makePdf(pages: string[][], options?: { labels?: { start: number; style: "r" | "D"; first?: number }[]; width?: number; height?: number }): Buffer;
export function samplePaper(): Buffer;
