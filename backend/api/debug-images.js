import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const projectRoot = path.join(process.cwd());
    const imagesDir = path.join(projectRoot, 'public', 'images');
    const exists = fs.existsSync(imagesDir);
    const files = exists ? fs.readdirSync(imagesDir) : [];
    const stats = files.map(f => {
      const p = path.join(imagesDir, f);
      const s = fs.statSync(p);
      return { name: f, size: s.size, mtime: s.mtime };
    });
    res.json({ imagesDir, exists, count: files.length, files: stats });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
