const LABEL_MAX_CHARS = 200;

export const clip = (value: string): string =>
  value.length > LABEL_MAX_CHARS ? `${value.slice(0, LABEL_MAX_CHARS)}…` : value;

export const printable = (value: string): string =>
  Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? "?" : char;
  }).join("");
