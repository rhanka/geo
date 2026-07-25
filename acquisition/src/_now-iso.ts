// Print a compact ISO timestamp (YYYYMMDDTHHMMSSZ) for report filenames. $0.
// Usage: npx tsx acquisition/src/_now-iso.ts
console.log(new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'));

export {};
