import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper with CAPTCHA support 🚀');
});

app.post('/scrape', async (req, res) => {
  const { url, captchaSolution } = req.body; 
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

    // ✅ SE temos solução de CAPTCHA, tentar usar
    if (captchaSolution) {
      console.log('🔄 Tentando usar solução CAPTCHA fornecida:', captchaSolution);
      
      // Tentar preencher campos de CAPTCHA comuns
      const captchaResult = await page.evaluate((solution) => {
        // Procurar por diferentes tipos de campos CAPTCHA
        const captchaSelectors = [
          'input[name="captcha"]',
          'input#captcha',
          '.captcha-input',
          'input[type="text"]',
          'textarea[name="captcha"]',
          'input[name="g-recaptcha-response"]'
        ];
        
        for (const selector of captchaSelectors) {
          const input = document.querySelector(selector);
          if (input) {
            input.value = solution;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('✅ CAPTCHA preenchido no seletor:', selector);
            return { success: true, selector };
          }
        }
        
        // Se não encontrou campos específicos, tentar método genérico
        const allInputs = document.querySelectorAll('input[type="text"], textarea');
        for (const input of allInputs) {
          const placeholder = input.placeholder?.toLowerCase() || '';
          const name = input.name?.toLowerCase() || '';
          if (placeholder.includes('captcha') || name.includes('captcha') || 
              placeholder.includes('code') || name.includes('code')) {
            input.value = solution;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('✅ CAPTCHA preenchido em campo genérico:', name || placeholder);
            return { success: true, selector: 'generic' };
          }
        }
        
        return { success: false, error: 'No CAPTCHA field found' };
      }, captchaSolution);

      if (captchaResult.success) {
        // Tentar submeter o formulário
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        
        // Aguardar possível redirecionamento
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
          .catch(() => console.log('⚠️ No navigation after CAPTCHA submission'));
      }
    }

    // ✅ Verificar se ainda tem CAPTCHA após tentativa de solução
    const hasCaptcha = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      const hasCaptchaText = text.includes('captcha') || 
                            text.includes('robot') || 
                            text.includes('verification');
      const hasCaptchaIframe = !!document.querySelector('iframe[src*="captcha"], iframe[src*="recaptcha"]');
      
      return hasCaptchaText || hasCaptchaIframe;
    });

    if (hasCaptcha) {
      console.log('❌ CAPTCHA ainda presente após tentativa de solução');
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ 
        captcha: true, 
        screenshot,
        captchaSolutionUsed: !!captchaSolution,
        message: 'CAPTCHA still present after solution attempt'
      });
    }

    // ✅ Extrair conteúdo se CAPTCHA foi resolvido ou não existe
    const text = await page.evaluate(() => document.body.innerText);

    // Extrair até 10 links internos
    const links = await page.evaluate(() => {
      const origin = location.origin;
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(h => h.startsWith(origin))
        .slice(0, 10);
    });

    await browser.close();
    
    res.json({ 
      captcha: false, 
      text, 
      links,
      captchaSolutionUsed: !!captchaSolution,
      success: true
    });
    
  } catch (err) {
    if (browser) await browser.close();
    console.error('❌ Error in scraper:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scraper with CAPTCHA support running on port ${PORT}`));