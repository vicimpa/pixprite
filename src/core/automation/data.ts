export const integer = (value: unknown, name: string, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
export function bytes(data: unknown) {
  if (typeof data !== 'string' || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Expected base64 data');
  return Uint8ClampedArray.from(atob(data), char => char.charCodeAt(0));
}
export function base64(data: ArrayBuffer | Uint8ClampedArray) {
  const array = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(binary);
}
