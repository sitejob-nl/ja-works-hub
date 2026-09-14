import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_EDGE } from '../../supabase/functions/_shared/feedback-contract';

export async function normalizeScreenshot(blob: Blob): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('Kies een PNG-, JPG- of WebP-afbeelding.');
  if (blob.size > 10 * 1024 * 1024) throw new Error('Kies een afbeelding van maximaal 10 MB.');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40000000) throw new Error('Deze afbeelding is te groot. Snijd hem eerst bij.');
    const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Het screenshot kon niet worden geopend.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encoding removes EXIF/text metadata. The edited canvas is what gets sent.
    return screenshotDataUrl(canvas);
  } finally { bitmap.close(); }
}

export function screenshotDataUrl(canvas: HTMLCanvasElement): string {
  const result = canvas.toDataURL('image/png');
  if (result.length * 0.75 > MAX_SCREENSHOT_BYTES) throw new Error('Het screenshot is groter dan 2 MB. Kies een kleiner deel van het scherm.');
  return result;
}

export async function captureFeedbackScreen(): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Deze browser kan het scherm niet vastleggen. Plak of upload een screenshot.');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  let timer: ReturnType<typeof setTimeout>;
  try {
    video.muted = true;
    video.srcObject = stream;
    await Promise.race([
      (async () => {
        await video.play();
        // Wait for a decoded frame, not merely permission to capture.
        if ('requestVideoFrameCallback' in video) await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
        else await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Scherm vastleggen duurde te lang. Probeer uploaden of plakken.')), 10000); }),
    ]);
    if (!video.videoWidth || !video.videoHeight) throw new Error('Er is geen schermbeeld ontvangen.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return screenshotDataUrl(canvas);
  } finally {
    clearTimeout(timer!);
    stream.getTracks().forEach(track => track.stop());
    video.pause();
    video.srcObject = null;
  }
}
