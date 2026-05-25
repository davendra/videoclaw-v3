import { rename, writeFile } from 'node:fs/promises';

export async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tempPath, content);
  await rename(tempPath, path);
}
