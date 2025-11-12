import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'images');
const destDir = path.join(process.cwd(), 'public', 'images');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      ensureDir(destPath);
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      console.log(`copied ${srcPath} -> ${destPath}`);
    }
  }
}

try {
  if (!fs.existsSync(srcDir)) {
    console.warn('No images directory to copy:', srcDir);
    process.exit(0);
  }
  ensureDir(destDir);
  copyRecursive(srcDir, destDir);
  console.log('Images copied to public/images');
} catch (err) {
  console.error('Failed to copy images:', err);
  process.exit(1);
}
