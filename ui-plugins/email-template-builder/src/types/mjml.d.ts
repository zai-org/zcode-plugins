declare module "mjml" {
  export interface MjmlNode { tagName: string; attributes: Record<string, string>; children?: MjmlNode[]; content?: string; line?: number }
  export interface MjmlError { line: number; message: string; tagName: string; formattedMessage: string }
  export default function mjml2html(mjml: string, options?: Record<string, unknown>): Promise<{ html: string; json: MjmlNode; errors: MjmlError[] }>;
}
declare module "html-to-text" {
  export function convert(html: string, options?: Record<string, unknown>): string;
}
