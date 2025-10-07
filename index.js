import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper with advanced CAPTCHA support 🚀');
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
    
    // Configurar timeouts
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // ✅ SE temos solução de CAPTCHA, aplicar estratégias avançadas
    if (captchaSolution) {
      console.log('🔄 Aplicando solução CAPTCHA:', captchaSolution);
      
      // Estratégia 1: Tentar reCAPTCHA v2 (mais comum)
      const recaptchaSolved = await page.evaluate((solution) => {
        try {
          // Para reCAPTCHA v2, precisamos injetar a resposta no textarea oculto
          const recaptchaResponse = document.querySelector('textarea#g-recaptcha-response');
          if (recaptchaResponse) {
            recaptchaResponse.value = solution;
            recaptchaResponse.dispatchEvent(new Event('input', { bubbles: true }));
            recaptchaResponse.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('✅ reCAPTCHA v2 preenchido');
            return true;
          }
          
          // Para reCAPTCHA v2 em iframe
          const recaptchaHidden = document.querySelector('input[name="g-recaptcha-response"]');
          if (recaptchaHidden) {
            recaptchaHidden.value = solution;
            recaptchaHidden.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('✅ reCAPTCHA hidden field preenchido');
            return true;
          }
          
          return false;
        } catch (error) {
          console.log('❌ Erro no reCAPTCHA:', error);
          return false;
        }
      }, captchaSolution);

      if (recaptchaSolved) {
        console.log('✅ reCAPTCHA resolvido, tentando submeter...');
        
        // Tentar encontrar e clicar no botão de submit
        const submitted = await page.evaluate(() => {
          const submitSelectors = [
            'input[type="submit"]',
            'button[type="submit"]',
            'button:contains("Submit")',
            'button:contains("Verify")',
            'button:contains("Continue")',
            'form button',
            '.g-recaptcha ~ button',
            '.g-recaptcha ~ input[type="submit"]'
          ];
          
          for (const selector of submitSelectors) {
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
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
          } catch (e) {
            console.log('⚠️ Navegação não detectada após submit');
          }
        }
      } else {
        // Estratégia 2: CAPTCHA de texto tradicional
        console.log('🔄 Tentando CAPTCHA de texto tradicional...');
        
        const traditionalSolved = await page.evaluate((solution) => {
          try {
            // Procurar por campos de CAPTCHA visíveis
            const captchaSelectors = [
              'input[name="captcha"]',
              'input#captcha',
              '.captcha-input',
              'input[type="text"]',
              'textarea',
              'input[name="captcha_text"]',
              'input[name="captcha_code"]',
              '.captcha-text'
            ];
            
            for (const selector of captchaSelectors) {
              const inputs = document.querySelectorAll(selector);
              for (const input of inputs) {
                // Verificar se é um campo de CAPTCHA (baseado em contexto)
                const parentText = input.closest('div, form')?.textContent?.toLowerCase() || '';
                if (parentText.includes('captcha') || 
                    parentText.includes('robot') || 
                    parentText.includes('verification') ||
                    parentText.includes('code')) {
                  input.value = solution;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                  console.log('✅ CAPTCHA tradicional preenchido:', selector);
                  return true;
                }
              }
            }
            
            // Última tentativa: qualquer campo de texto que pareça ser CAPTCHA
            const allTextInputs = document.querySelectorAll('input[type="text"], textarea');
            for (const input of allTextInputs) {
              const placeholder = input.placeholder?.toLowerCase() || '';
              const name = input.name?.toLowerCase() || '';
              const id = input.id?.toLowerCase() || '';
              
              if (placeholder.includes('captcha') || name.includes('captcha') || id.includes('captcha') ||
                  placeholder.includes('code') || name.includes('code') || id.includes('code') ||
                  placeholder.includes('enter') || placeholder.includes('type')) {
                input.value = solution;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('✅ Campo genérico preenchido:', name || placeholder || id);
                return true;
              }
            }
            
            return false;
          } catch (error) {
            console.log('❌ Erro no CAPTCHA tradicional:', error);
            return false;
          }
        }, captchaSolution);

        if (traditionalSolved) {
          // Tentar submeter formulário
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
          } catch (e) {
            console.log('⚠️ Navegação não detectada após Enter');
          }
        }
      }
    }

    // ✅ Verificação MELHORADA de CAPTCHA
    const hasCaptcha = await page.evaluate(() => {
      // Verificar por elementos visuais de CAPTCHA
      const captchaIndicators = [
        // reCAPTCHA
        '.g-recaptcha',
        '.rc-anchor',
        'iframe[src*="google.com/recaptcha"]',
        'iframe[src*="recaptcha"]',
        
        // CAPTCHA tradicional
        'img[src*="captcha"]',
        '.captcha-container',
        '.captcha-image',
        '#captcha',
        
        // Textos indicativos
        document.body.innerText.toLowerCase().includes('captcha'),
        document.body.innerText.toLowerCase().includes('robot'),
        document.body.innerText.toLowerCase().includes('verification'),
        document.body.innerText.toLowerCase().includes('i am not a robot'),
        
        // Formulários bloqueados
        document.querySelector('form[style*="hidden"]'),
        document.querySelector('form[style*="none"]')
      ];
      
      return captchaIndicators.some(indicator => {
        if (typeof indicator === 'boolean') return indicator;
        if (typeof indicator === 'string') return !!document.querySelector(indicator);
        return false;
      });
    });

    if (hasCaptcha) {
      console.log('❌ CAPTCHA ainda presente após tentativa');
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ 
        captcha: true, 
        screenshot,
        captchaSolutionUsed: !!captchaSolution,
        message: 'CAPTCHA still present after advanced solution attempt'
      });
    }

    // ✅ Extrair conteúdo se CAPTCHA foi resolvido
    console.log('✅ CAPTCHA aparentemente resolvido, extraindo conteúdo...');
    
    const text = await page.evaluate(() => {
      // Remover elementos indesejados antes de extrair texto
      const unwantedSelectors = ['script', 'style', 'nav', 'header', 'footer'];
      unwantedSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });
      return document.body.innerText;
    });

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
app.listen(PORT, () => console.log(`✅ Advanced CAPTCHA scraper running on port ${PORT}`));