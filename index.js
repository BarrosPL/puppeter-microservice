import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper is running 🚀');
});

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Detecta CAPTCHA simples
    const hasCaptcha = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('captcha') || !!document.querySelector('iframe[src*="captcha"]');
    });

    if (hasCaptcha) {
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ captcha: true, screenshot });
    }

    // Extrai texto principal
    const text = await page.evaluate(() => document.body.innerText);

    // Extrai até 10 links internos
    const links = await page.evaluate(() => {
      const origin = location.origin;
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(h => h.startsWith(origin))
        .slice(0, 10);
    });

    await browser.close();
    res.json({ captcha: false, text, links });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scraper running on port ${PORT}`));
