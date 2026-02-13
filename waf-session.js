const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class WafSession {
    constructor(baseUrl, cookieFile) {
        this.baseUrl = baseUrl;
        this.cookies = null;
        this._solving = null; // mutex: shared promise while a solve is in-flight

        // Default cookie file: config/cookies-<sanitized-origin>.json
        if (cookieFile) {
            this._cookieFile = cookieFile;
        } else {
            const sanitized = new URL(baseUrl).origin.replace(/[^a-zA-Z0-9]/g, '_');
            this._cookieFile = path.join(__dirname, 'config', `cookies-${sanitized}.json`);
        }

        // Attempt to load persisted cookies
        try {
            const data = fs.readFileSync(this._cookieFile, 'utf8');
            this.cookies = JSON.parse(data);
        } catch {
            // Missing or corrupt file — will solve on first use
        }
    }

    /** Solve the WAF challenge and extract cookies. */
    async solve() {
        // If another call is already solving, piggy-back on it
        if (this._solving) return this._solving;

        this._solving = this._doSolve().finally(() => {
            this._solving = null;
        });
        return this._solving;
    }

    async _doSolve() {
        console.log(`[WAF] Solving challenge for ${this.baseUrl} ...`);
        let browser;
        try {
            browser = await chromium.launch({ headless: true });
            const context = await browser.newContext({
                userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            });
            const page = await context.newPage();

            await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Wait for WAF challenge JS to execute and set cookies
            await page.waitForTimeout(5000);

            const browserCookies = await context.cookies();
            this.cookies = browserCookies;

            console.log(`[WAF] Challenge solved. Got ${browserCookies.length} cookies: ${browserCookies.map(c => c.name).join(', ')}`);

            // Persist cookies to disk
            try {
                fs.mkdirSync(path.dirname(this._cookieFile), { recursive: true });
                fs.writeFileSync(this._cookieFile, JSON.stringify(browserCookies, null, 2));
                console.log(`[WAF] Cookies saved to ${this._cookieFile}`);
            } catch (writeErr) {
                console.warn(`[WAF] Failed to save cookies: ${writeErr.message}`);
            }
        } catch (err) {
            console.error(`[WAF] Failed to solve challenge: ${err.message}`);
            throw err;
        } finally {
            if (browser) await browser.close();
        }
    }

    /** Return a Cookie header string, solving first if needed. */
    async getCookieHeader() {
        if (!this.cookies) await this.solve();
        return this.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    }

    /** Mark cookies as stale so the next getCookieHeader() re-solves. */
    invalidate() {
        this.cookies = null;
        try {
            fs.unlinkSync(this._cookieFile);
        } catch {
            // File may not exist — that's fine
        }
    }
}

module.exports = WafSession;
