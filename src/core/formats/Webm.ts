const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** WebM video recorded from a canvas in real time (the browser's own encoder) */
export async function encodeWebm(frames: OffscreenCanvas[], delays: number[], loops: number) {
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('WebM recording is not supported');
  const can = document.createElement('canvas');
  // Video encoders want even sizes
  can.width = frames[0].width + (frames[0].width & 1);
  can.height = frames[0].height + (frames[0].height & 1);
  const ctx = can.getContext('2d')!;
  const stream = can.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => { rec.onstop = r; });
  rec.start();
  for (let n = 0; n < loops; n++)
    for (let i = 0; i < frames.length; i++) {
      ctx.clearRect(0, 0, can.width, can.height);
      ctx.drawImage(frames[i], 0, 0);
      track.requestFrame();
      await sleep(Math.max(10, delays[i]));
    }
  rec.stop();
  await stopped;
  stream.getTracks().forEach(t => t.stop());
  return new Blob(chunks, { type: 'video/webm' });
}

