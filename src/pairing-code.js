export function normalizePairingCode(value) {
  const code = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(code) ? code : null;
}
