// errors.js — error type-e XT (port az CryptoMind-XT/bot/xt_client.py: XTError)
export class XTError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XTError';
  }
}
