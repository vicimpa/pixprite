import { useMemo } from "react";
import { signalRef, type SignalRef } from "./signalRef";

function useSignalRef<T>(initial: T): SignalRef<T>;
function useSignalRef<T>(initial: null): SignalRef<T | null>;
function useSignalRef<T>(initial = null) {
  return useMemo(() => signalRef<T>(initial), []);
}

export { useSignalRef };