const { chromium } = require('playwright');

class WafSession {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cookies = null;
        this._solving = null; // mutex: shared promise while a solve is in-flight
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
    }
}

module.exports = WafSession;
