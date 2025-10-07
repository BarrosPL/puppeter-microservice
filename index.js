import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/scrape', async (req, res) => {
  const { url, captchaSolution, captchaType } = req.body;
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
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ✅ SE é reCAPTCHA, usar método específico
    if (captchaSolution && captchaType === 'recaptcha') {
      console.log('🔄 Aplicando token reCAPTCHA:', captchaSolution.substring(0, 50) + '...');
      
      const recaptchaSuccess = await page.evaluate((token) => {
        try {
          // Método 1: Encontrar o textarea do reCAPTCHA
          const recaptchaResponse = document.querySelector('textarea#g-recaptcha-response');
          if (recaptchaResponse) {
            recaptchaResponse.value = token;
            recaptchaResponse.style.display = 'block'; // Tornar visível se necessário
            recaptchaResponse.dispatchEvent(new Event('input', { bubbles: true }));
            recaptchaResponse.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('✅ reCAPTCHA token aplicado no textarea');
            return true;
          }
          
          // Método 2: Encontrar input hidden
          const recaptchaHidden = document.querySelector('input[name="g-recaptcha-response"]');
          if (recaptchaHidden) {
            recaptchaHidden.value = token;
            recaptchaHidden.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('✅ reCAPTCHA token aplicado no input hidden');
            return true;
          }
          
          // Método 3: Executar callback do reCAPTCHA
          if (window.grecaptcha) {
            console.log('🔄 grecaptcha encontrado, executando callback...');
            // Tentar encontrar o widget ID
            const widgets = document.querySelectorAll('.g-recaptcha');
            for (const widget of widgets) {
              const widgetId = widget.getAttribute('data-sitekey');
              if (widgetId) {
                try {
                  window.grecaptcha.execute(widgetId, { action: 'submit' })
                    .then((recaptchaToken) => {
                      console.log('✅ reCAPTCHA executado via grecaptcha.execute');
                    });
                  return true;
                } catch (e) {
                  console.log('❌ Erro no grecaptcha.execute:', e);
                }
              }
            }
          }
          
          console.log('❌ Nenhum método reCAPTCHA funcionou');
          return false;
        } catch (error) {
          console.log('❌ Erro no reCAPTCHA:', error);
          return false;
        }
      }, captchaSolution);

      if (recaptchaSuccess) {
        // Aguardar um pouco e tentar submeter
        await page.waitForTimeout(2000);
        
        // Tentar submeter automaticamente
        const submitted = await page.evaluate(() => {
          const submitButtons = [
            'input[type="submit"]',
            'button[type="submit"]',
            'button:contains("Submit")',
            'button:contains("Verify")',
            'form button',
            '#recaptcha-submit',
            '.g-recaptcha ~ button'
          ];
          
          for (const selector of submitButtons) {
            try {
              const element = document.querySelector(selector);
              if (element) {
                element.click();
                console.log('✅ Botão clicado:', selector);
                return true;
              }
            } catch (e) {}
          }
          return false;
        });

        if (submitted) {
          await page.waitForTimeout(5000);
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
          } catch (e) {
            console.log('⚠️ Navegação não detectada, continuando...');
          }
        }
      }
    }

    // Verificar se CAPTCHA ainda existe
    const hasCaptcha = await page.evaluate(() => {
      return !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]') ||
             document.body.innerText.toLowerCase().includes('captcha');
    });

    if (hasCaptcha) {
      console.log('❌ reCAPTCHA ainda presente');
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ 
        captcha: true, 
        screenshot,
        message: 'reCAPTCHA still present after token application'
      });
    }

    // Extrair conteúdo se sucesso
    const text = await page.evaluate(() => document.body.innerText);
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
      success: true
    });
    
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ reCAPTCHA-aware scraper running on port ${PORT}`));