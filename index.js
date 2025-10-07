import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper with Anti-Captcha integration 🚀');
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
    
    // Configurar user agent para parecer mais legítimo
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });

    // ✅ DETECÇÃO AVANÇADA DE CAPTCHA
    const captchaInfo = await page.evaluate(() => {
      // Elementos visuais de CAPTCHA
      const captchaImage = document.querySelector('img[src*="captcha"], img[alt*="captcha"], img[src*="CAPTCHA"]');
      const captchaInput = document.querySelector('input[name*="captcha"], input[id*="captcha"], input[name*="Captcha"]');
      
      // Textos indicativos
      const bodyText = document.body.innerText.toLowerCase();
      const hasCaptchaText = bodyText.includes('captcha');
      const hasSecurityCode = bodyText.includes('security code');
      const hasVerification = bodyText.includes('verification code');
      const hasEnterText = bodyText.includes('enter the text');
      const hasRobot = bodyText.includes('robot');
      
      // reCAPTCHA (vamos evitar)
      const hasRecaptcha = !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
      
      return {
        hasCaptcha: !!(captchaImage || captchaInput || hasCaptchaText || hasSecurityCode || hasVerification || hasEnterText),
        hasRecaptcha: hasRecaptcha,
        captchaImage: !!captchaImage,
        captchaInput: !!captchaInput,
        captchaText: hasCaptchaText,
        securityCode: hasSecurityCode,
        verificationCode: hasVerification,
        enterText: hasEnterText,
        robotText: hasRobot
      };
    });

    console.log('🔍 CAPTCHA Analysis:', captchaInfo);

    // ✅ SE TEM CAPTCHA COMPLEXO (reCAPTCHA), EVITAR
    if (captchaInfo.hasRecaptcha) {
      await browser.close();
      return res.json({ 
        captcha: true,
        captchaType: 'recaptcha',
        error: "reCAPTCHA detected - too complex for automatic solving",
        skip: true
      });
    }

    // ✅ SE TEM CAPTCHA SIMPLES
    if (captchaInfo.hasCaptcha) {
      console.log('🛡️ Simple CAPTCHA detected');
      
      // SE TEM SOLUÇÃO, TENTAR APLICAR
      if (captchaSolution) {
        console.log('🔄 Applying CAPTCHA solution:', captchaSolution);
        
        const solutionResult = await page.evaluate((solution) => {
          try {
            // Estratégia 1: Campos específicos de CAPTCHA
            const specificSelectors = [
              'input[name="captcha"]',
              'input[name="captcha_code"]',
              'input[name="captcha_text"]',
              'input[name="security_code"]',
              'input[name="verification_code"]',
              'input#captcha',
              'input#captcha_code',
              'textarea[name="captcha"]'
            ];
            
            for (const selector of specificSelectors) {
              const input = document.querySelector(selector);
              if (input) {
                input.value = solution;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('✅ Solution applied to specific field:', selector);
                return { success: true, method: 'specific', field: selector };
              }
            }
            
            // Estratégia 2: Campos genéricos com contexto
            const allTextInputs = document.querySelectorAll('input[type="text"], textarea');
            for (const input of allTextInputs) {
              // Verificar contexto do campo
              const parent = input.closest('div, form, p, td');
              const parentText = parent ? parent.textContent.toLowerCase() : '';
              const placeholder = input.placeholder?.toLowerCase() || '';
              const name = input.name?.toLowerCase() || '';
              const id = input.id?.toLowerCase() || '';
              
              const isCaptchaField = 
                parentText.includes('captcha') ||
                parentText.includes('security code') ||
                parentText.includes('verification') ||
                parentText.includes('enter text') ||
                placeholder.includes('captcha') ||
                placeholder.includes('code') ||
                name.includes('captcha') ||
                name.includes('code') ||
                id.includes('captcha') ||
                id.includes('code');
              
              if (isCaptchaField) {
                input.value = solution;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                console.log('✅ Solution applied to contextual field:', name || placeholder || id);
                return { success: true, method: 'contextual', field: name || placeholder || id };
              }
            }
            
            // Estratégia 3: Primeiro campo de texto visível
            const visibleInputs = Array.from(document.querySelectorAll('input[type="text"], textarea'))
              .filter(input => {
                const style = window.getComputedStyle(input);
                return style.display !== 'none' && style.visibility !== 'hidden';
              });
              
            if (visibleInputs.length > 0) {
              visibleInputs[0].value = solution;
              visibleInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
              console.log('✅ Solution applied to first visible field');
              return { success: true, method: 'fallback', field: 'first_visible' };
            }
            
            return { success: false, error: 'No suitable field found' };
            
          } catch (error) {
            return { success: false, error: error.message };
          }
        }, captchaSolution);

        console.log('🔧 Solution application result:', solutionResult);

        if (solutionResult.success) {
          // Tentar submeter o formulário
          const submitted = await page.evaluate(() => {
            const submitSelectors = [
              'input[type="submit"]',
              'button[type="submit"]',
              'button:contains("Submit")',
              'button:contains("Verify")',
              'button:contains("Continue")',
              'form input[type="submit"]',
              'form button[type="submit"]'
            ];
            
            for (const selector of submitSelectors) {
              try {
                const element = document.querySelector(selector);
                if (element && element.offsetParent !== null) { // Está visível
                  element.click();
                  console.log('✅ Form submitted via:', selector);
                  return true;
                }
              } catch (e) {
                console.log('⚠️ Error clicking:', selector, e);
              }
            }
            
            // Fallback: pressionar Enter
            console.log('🔄 Trying Enter key as fallback');
            return false;
          });

          if (!submitted) {
            // Se não encontrou botão, pressionar Enter
            await page.keyboard.press('Enter');
          }

          // Aguardar processamento
          await page.waitForTimeout(4000);
          
          // Tentar navegação
          try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
            console.log('✅ Navigation detected after CAPTCHA submission');
          } catch (e) {
            console.log('⚠️ No navigation detected, continuing...');
          }
        }
      } else {
        // SE NÃO TEM SOLUÇÃO, RETORNAR SCREENSHOT
        console.log('📸 Taking CAPTCHA screenshot for solving');
        const screenshot = await page.screenshot({ 
          encoding: 'base64',
          fullPage: false // Apenas a área visível
        });
        await browser.close();
        return res.json({ 
          captcha: true, 
          screenshot,
          captchaType: 'simple',
          captchaInfo: captchaInfo,
          message: 'Simple CAPTCHA detected - ready for solving'
        });
      }
    }

    // ✅ VERIFICAR SE CAPTCHA AINDA EXISTE APÓS TENTATIVA
    const stillHasCaptcha = await page.evaluate(() => {
      const currentText = document.body.innerText.toLowerCase();
      const hasError = currentText.includes('invalid') || 
                      currentText.includes('incorrect') || 
                      currentText.includes('wrong') ||
                      currentText.includes('error');
      
      const stillHasCaptchaElement = !!document.querySelector('img[src*="captcha"]') ||
                                    currentText.includes('captcha');
      
      return hasError || stillHasCaptchaElement;
    });

    if (stillHasCaptcha) {
      console.log('❌ CAPTCHA still present or incorrect solution');
      const screenshot = await page.screenshot({ encoding: 'base64' });
      await browser.close();
      return res.json({ 
        captcha: true, 
        screenshot,
        captchaType: 'simple',
        captchaSolutionUsed: !!captchaSolution,
        message: 'CAPTCHA still present after solution attempt'
      });
    }

    // ✅ SUCESSO - EXTRAIR CONTEÚDO
    console.log('✅ CAPTCHA resolved, extracting content...');
    
    const text = await page.evaluate(() => {
      // Limpar elementos indesejados
      const unwanted = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
      unwanted.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });
      return document.body.innerText;
    });

    const links = await page.evaluate(() => {
      const origin = window.location.origin;
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      return allLinks
        .map(a => {
          try {
            const href = a.href;
            // Resolver URLs relativas
            if (href.startsWith('/')) {
              return origin + href;
            }
            if (href.startsWith('./')) {
              return origin + href.slice(1);
            }
            return href;
          } catch (e) {
            return null;
          }
        })
        .filter(href => href && href.startsWith(origin))
        .slice(0, 10);
    });

    await browser.close();
    
    res.json({ 
      captcha: false, 
      text, 
      links,
      captchaSolutionUsed: !!captchaSolution,
      success: true,
      contentLength: text.length,
      linksFound: links.length
    });
    
  } catch (err) {
    console.error('❌ Error in scraper:', err.message);
    if (browser) await browser.close();
    res.status(500).json({ 
      error: err.message,
      captcha: false,
      success: false
    });
  }
});

// ✅ NOVO ENDPOINT: SCRAPING EM LOTE
app.post('/scrape-batch', async (req, res) => {
  console.log('📦 Recebendo requisição de scraping em lote...');
  
  const { urls, instructions } = req.body;
  
  // Validação
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Array de URLs é obrigatório' 
    });
  }

  console.log(`🎯 Processando ${urls.length} URLs`);

  let browser;
  try {
    const executablePath = await chromium.executablePath();
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath,
      headless: chromium.headless,
    });

    const results = [];
    // Limitar para não sobrecarregar - processar apenas 5 URLs para teste
    const urlsToProcess = urls.slice(0, 5);

    // Processar cada URL sequencialmente
    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i];
      
      try {
        console.log(`🌐 [${i + 1}/${urlsToProcess.length}] Processando: ${url}`);
        
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(url, { 
          waitUntil: 'domcontentloaded', 
          timeout: 20000 
        });

        // Verificação rápida de CAPTCHA
        const hasCaptcha = await page.evaluate(() => {
          const bodyText = document.body.innerText.toLowerCase();
          return bodyText.includes('captcha') || 
                 !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
        });

        if (hasCaptcha) {
          console.log(`🛡️ CAPTCHA detectado em ${url}, pulando...`);
          results.push({
            success: false,
            url: url,
            error: 'CAPTCHA detected',
            skipped: true
          });
          await page.close();
          continue;
        }

        // Extrair conteúdo
        const text = await page.evaluate(() => {
          const unwanted = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
          unwanted.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.remove());
          });
          return document.body.innerText;
        });

        const links = await page.evaluate(() => {
          const origin = window.location.origin;
          const allLinks = Array.from(document.querySelectorAll('a[href]'));
          return allLinks
            .map(a => {
              try {
                const href = a.href;
                if (href.startsWith('/')) return origin + href;
                if (href.startsWith('./')) return origin + href.slice(1);
                return href;
              } catch (e) {
                return null;
              }
            })
            .filter(href => href && href.startsWith('http'))
            .slice(0, 5);
        });

        await page.close();

        results.push({
          success: true,
          url: url,
          mainContent: text,
          contentLength: text.length,
          links: links,
          linksFound: links.length
        });

        console.log(`✅ URL ${i + 1} processada com sucesso`);

      } catch (error) {
        console.log(`❌ Erro processando URL ${i + 1}:`, error.message);
        results.push({
          success: false,
          url: url,
          error: error.message
        });
      }

      // Pequena pausa entre requests para evitar bloqueios
      if (i < urlsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    await browser.close();

    // Combinar resultados
    const successfulScrapes = results.filter(r => r.success);
    const combinedContent = successfulScrapes
      .map(result => `--- URL: ${result.url} ---\n${result.mainContent}`)
      .join('\n\n');

    console.log(`✅ Lote finalizado: ${successfulScrapes.length}/${urlsToProcess.length} sucessos`);

    res.json({
      success: true,
      method: 'puppeteer-batch',
      urlsProcessed: urlsToProcess.length,
      successfulScrapes: successfulScrapes.length,
      failedScrapes: results.length - successfulScrapes.length,
      combinedContent: combinedContent,
      totalContentLength: combinedContent.length,
      individualResults: results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erro geral no scraping em lote:', error.message);
    if (browser) await browser.close();
    
    res.status(500).json({
      success: false,
      error: 'Erro no scraping em lote: ' + error.message,
      method: 'puppeteer-batch'
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Puppeteer scraper with Batch support running on port ${PORT}`);
  console.log(`🔑 Anti-Captcha Key: 3582d06717ccd04bf3290f5c1799bc70`);
  console.log(`📦 Endpoints disponíveis: /scrape e /scrape-batch`);
});