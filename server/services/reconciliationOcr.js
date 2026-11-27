import { spawn } from 'node:child_process';

// Local process, no shell or network, and no evidence sent to an AI provider.
export const extractScreenshotText = buffer => new Promise((resolve, reject) => {
  const process = spawn('tesseract', ['stdin', 'stdout', '-l', 'eng', '--psm', '6'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let text = '';
  const timer = setTimeout(() => { process.kill(); reject(new Error('Screenshot reading timed out. Review the image and enter its pending rows manually.')); }, 30000);
  process.stdout.on('data', chunk => {
    text += chunk.toString();
    if (text.length > 1000000) { process.kill(); reject(new Error('Screenshot text is too large. Upload a smaller image.')); }
  });
  process.stderr.resume();
  process.stdin.on('error', () => {});
  process.on('error', () => { clearTimeout(timer); reject(new Error('Automatic screenshot reading is unavailable. Enter the pending rows from the image below. Docker builds include the local reader.')); });
  process.on('close', code => { clearTimeout(timer); if (code === 0) resolve(text); else reject(new Error('The screenshot could not be read automatically. Review the original image and enter its pending rows manually.')); });
  process.stdin.end(buffer);
});
