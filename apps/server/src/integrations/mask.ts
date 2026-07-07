export function maskSecret(plaintext: string): string {
  if (plaintext.length >= 4) {
    return '••••••••' + plaintext.slice(-4);
  }
  return '••••••••';
}