import express from 'express';
import puppeteer from 'puppeteer';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    const hasCaptcha = await page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('captcha')
    );

    if (hasCaptcha) {
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ captcha: true, screenshot });
    }

    const text = await page.evaluate(() => document.body.innerText);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(h => h.startsWith(location.origin))
        .slice(0, 10)
    );

    await browser.close();
    res.json({ captcha: false, text, links });
  } catch (err) {
    await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Scraper ativo na porta 3000'));
