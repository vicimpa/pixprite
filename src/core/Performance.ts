/** On-demand software frame pacing sample; no loop or observers remain running afterwards. */
export function samplePerformance(durationMs = 2000) {
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 5000) throw new Error('durationMs must be between 100 and 5000');
  return new Promise(resolve => {
    const intervals: number[] = [];
    const start = performance.now();
    let previous: number | undefined, raf = 0, pointerMoves = 0, resizes = 0, longTaskCount = 0, longTaskMs = 0;
    const visibility = document.visibilityState, focused = document.hasFocus();
    const pointer = () => { pointerMoves++; }, resize = () => { resizes++; };
    addEventListener('pointermove', pointer, { passive: true }); addEventListener('resize', resize, { passive: true });
    const longTasksSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = longTasksSupported ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) { longTaskCount++; longTaskMs += entry.duration; }
    }) : null;
    observer?.observe({ entryTypes: ['longtask'] });
    const frame = (time: number) => { if (previous !== undefined && time > previous) intervals.push(time - previous); previous = time; raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    setTimeout(() => {
      cancelAnimationFrame(raf); observer?.disconnect(); removeEventListener('pointermove', pointer); removeEventListener('resize', resize);
      const sorted = [...intervals].sort((a, b) => a - b);
      const percentile = (q: number) => sorted[Math.ceil(sorted.length * q) - 1] ?? null;
      const elapsedFrames = intervals.reduce((sum, value) => sum + value, 0);
      const median = percentile(.5);
      resolve({ scope: 'requestAnimationFrame cadence; excludes compositor and display scanout', elapsedMs: performance.now() - start,
        visibility, focused, visibilityAtEnd: document.visibilityState, focusedAtEnd: document.hasFocus(), devicePixelRatio,
        samples: intervals.length, cadenceHz: elapsedFrames ? Math.round(intervals.length * 1000 / elapsedFrames * 10) / 10 : null,
        intervalMs: { p50: median, p95: percentile(.95), max: sorted.at(-1) ?? null, raw: intervals },
        events: { pointerMoves, resizes }, longTasks: longTasksSupported ? { count: longTaskCount, totalMs: longTaskMs } : null });
    }, durationMs);
  });
}
