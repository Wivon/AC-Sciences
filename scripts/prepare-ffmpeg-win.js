const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const pkgPath = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static', 'package.json');
let releaseTag = 'b6.1.1';
let baseName = 'ffmpeg';
let binariesUrl = 'https://github.com/eugeneware/ffmpeg-static/releases/download';

try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const meta = pkg && pkg['ffmpeg-static'];
  if (meta && typeof meta['binary-release-tag'] === 'string') releaseTag = meta['binary-release-tag'];
  if (meta && typeof meta['executable-base-name'] === 'string') baseName = meta['executable-base-name'];
  if (meta && typeof meta['binaries-url-env-var'] === 'string') {
    const envUrl = process.env[meta['binaries-url-env-var']];
    if (envUrl) binariesUrl = envUrl;
  }
  if (meta && typeof meta['binary-release-tag-env-var'] === 'string') {
    const envTag = process.env[meta['binary-release-tag-env-var']];
    if (envTag) releaseTag = envTag;
  }
} catch (_e) {
  // Fall back to defaults if metadata is unavailable.
}

const arch = 'x64';
const platform = 'win32';
const downloadUrl = `${binariesUrl}/${releaseTag}/${baseName}-${platform}-${arch}.gz`;

const targetDir = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static');
const targetPath = path.join(targetDir, `${baseName}.exe`);

if (!fs.existsSync(targetDir)) {
  console.error('ffmpeg-static is not installed. Run npm install first.');
  process.exit(1);
}

if (fs.existsSync(targetPath)) {
  console.log(`ffmpeg.exe already present at ${targetPath}`);
  process.exit(0);
}

console.log(`Downloading ${downloadUrl}`);

function downloadWithRedirects(url, depth = 0) {
  if (depth > 5) {
    console.error('Too many redirects while downloading ffmpeg.');
    process.exit(1);
  }
  https.get(url, (res) => {
    const status = res.statusCode || 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      const nextUrl = new URL(res.headers.location, url).toString();
      res.resume();
      return downloadWithRedirects(nextUrl, depth + 1);
    }
    if (status !== 200) {
      console.error(`Download failed: ${status}`);
      res.resume();
      process.exit(1);
    }

    const gunzip = zlib.createGunzip();
    const file = fs.createWriteStream(targetPath);

    res.pipe(gunzip).pipe(file);

    file.on('finish', () => {
      file.close(() => {
        fs.chmodSync(targetPath, 0o755);
        console.log(`Saved ${targetPath}`);
      });
    });

    file.on('error', (err) => {
      console.error('Write error:', err.message || err);
      process.exit(1);
    });
  }).on('error', (err) => {
    console.error('Download error:', err.message || err);
    process.exit(1);
  });
}

downloadWithRedirects(downloadUrl);
