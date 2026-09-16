// sign.js — signing-e live-verified XT /future v1 (CCXT parity)
// ---------------------------------------------------------
// Port az CryptoMind-XT/bot/xt_client.py (_signed_request_headers_and_payload):
// - Header ha: xt-validate-appkey / xt-validate-timestamp / xt-validate-signature
//   (+ xt-validate-algorithms=HmacSHA256, xt-validate-recvwindow=60000)
// - Signed string = "xt-validate-appkey=..&xt-validate-timestamp=.."
//   + "#path" [+ "#payload"] — payload daghighan hamoon chizi ke ferestade mishe:
//   baraye POST = body (JSON default), baraye GET = query string (sorted k=v)
// - POST body ha JSON ba separators (",", ":") — bedune fasele (mesl-e python).
// - XT_SIGN_PREFIX / XT_SIGN_BODY az env ghabel-e override hastan.
import crypto from 'node:crypto';

export function signPrefix() {
  return String(process.env.XT_SIGN_PREFIX || 'xt-validate').replace(/^-+|-+$/g, '').toLowerCase();
}

export function signBodyMode() {
  return String(process.env.XT_SIGN_BODY || 'json').toLowerCase();
}

export function authHeaders(prefix, apiKey, ts, sig) {
  return {
    'Content-type': 'application/x-www-form-urlencoded',
    [`${prefix}-appkey`]: apiKey,
    [`${prefix}-timestamp`]: ts,
    [`${prefix}-signature`]: sig,
    [`${prefix}-algorithms`]: 'HmacSHA256',
    [`${prefix}-recvwindow`]: '60000',
  };
}

// sorted "k=v&k=v" — mesl-e python: "&".join(f"{k}={params[k]}" for k in sorted(params))
export function sortedQuery(params) {
  return Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
}

// Body-e JSON-e daghigh (mesl-e python json.dumps(separators=(",", ":")))
export function jsonBody(params) {
  if (!params || !Object.keys(params).length) return '';
  return JSON.stringify(params);
}

// Khuruji: { headers, body?, query? } — headers shamel-e signature-e dorost hast.
export function signedHeadersAndPayload({ method, path, params, apiKey, secret }) {
  const p = signPrefix();
  const ts = String(Date.now());
  let msg = `${p}-appkey=${apiKey}&${p}-timestamp=${ts}`;

  if (method === 'GET') {
    if (params && Object.keys(params).length) {
      msg += `#${path}#${sortedQuery(params)}`;
    } else {
      msg += `#${path}`;
    }
    const sig = crypto.createHmac('sha256', secret).update(msg).digest('hex');
    return { headers: authHeaders(p, apiKey, ts, sig), query: params || {} };
  }

  // POST
  const mode = signBodyMode();
  let body;
  if (mode === 'form') {
    body = params && Object.keys(params).length ? sortedQuery(params) : '';
  } else {
    body = jsonBody(params);
  }
  msg += body ? `#${path}#${body}` : `#${path}`;
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  const headers = authHeaders(p, apiKey, ts, sig);
  if (mode !== 'form') headers['Content-type'] = 'application/json';
  return { headers, body };
}
