export function unzip(buf: Buffer): Map<string, () => Buffer>;
export function readWorkbook(buf: Buffer): { sheets: { name: string; dim: string; rows: { r: number; cells: { ref: string; v: string; f?: string }[] }[] }[]; vba: Buffer | null };
export function workbookText(buf: Buffer, sheet?: string | null, fromRow?: number, max?: number): string;
export function ovbaDecompress(buf: Buffer): Buffer;
export function vbaModules(bin: Buffer): { name: string; code: string }[];
export function parseCopyDump(sql: string): Record<string, { columns: string[]; rows: (string | null)[][] }>;
