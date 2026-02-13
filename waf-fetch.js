const nodeFetch = require('node-fetch');
const WafSession = require('./waf-session');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// One WafSession per base-URL origin
const sessions = {};

function getSession(url) {
    const origin = new URL(url).origin + '/';
    if (!sessions[origin]) {
        sessions[origin] = new WafSession(origin);
    }
    return sessions[origin];
}

function looksLikeWafChallenge(response) {
    if (response.status === 403) return true;
    const ct = response.headers.get('content-type') || '';
    return ct.includes('text/html');
}

async function wafFetch(url, options = {}) {
    const session = getSession(url);
    const cookieHeader = await session.getCookieHeader();

    const mergedHeaders = {
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
        Cookie: cookieHeader,
    };

    const response = await nodeFetch(url, { ...options, headers: mergedHeaders });

    if (!looksLikeWafChallenge(response)) {
        return response;
    }

    // Got a WAF challenge — invalidate, re-solve, retry once
    console.log(`[WAF] Challenge detected on ${url}, re-solving...`);
    session.invalidate();
    const freshCookie = await session.getCookieHeader();

    const retryHeaders = {
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
        Cookie: freshCookie,
    };

    const retryResponse = await nodeFetch(url, { ...options, headers: retryHeaders });

    if (looksLikeWafChallenge(retryResponse)) {
        throw new Error(`[WAF] Still getting challenge after re-solve for ${url}`);
    }

    return retryResponse;
}

module.exports = wafFetch;
