import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper with Anti-Captcha integration 🚀');
});

app.post('/scrape', async (req, res) => {
  const { url, instructions, captchaSolution } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser;
  try {
    const executablePath = await chromium.executablePath();
    
    // ✅ CONFIGURAÇÃO ROBUSTA PARA EVITAR ETXTBSY
    const browserConfig = {
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      executablePath,
      headless: true, // Forçar headless
      ignoreHTTPSErrors: true
    };

    console.log('🚀 Iniciando browser com configuração robusta...');
    browser = await puppeteer.launch(browserConfig);

    const page = await browser.newPage();
    
    // ✅ CONFIGURAR BLOQUEIO DE RECURSOS DESNECESSÁRIOS
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url().toLowerCase();
      
      // Bloquear imagens, vídeos, fonts, CSS e arquivos baixáveis
      const blockedTypes = ['image', 'media', 'font', 'stylesheet'];
      const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.avi', '.mov', '.pdf', '.zip', '.rar'];
      
      const isBlockedType = blockedTypes.includes(resourceType);
      const isBlockedExtension = blockedExtensions.some(ext => requestUrl.includes(ext));
      
      if (isBlockedType || isBlockedExtension) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Configurar user agent para parecer mais legítimo
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`🌐 Navegando para: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle2', // ✅ Mudar para networkidle2
      timeout: 15000 // ✅ Reduzir timeout
    });

    // ✅ DETECÇÃO SIMPLIFICADA DE CAPTCHA
    const captchaInfo = await page.evaluate(() => {
      const captchaImage = document.querySelector('img[src*="captcha"], img[alt*="captcha"], img[src*="CAPTCHA"]');
      const captchaInput = document.querySelector('input[name*="captcha"], input[id*="captcha"], input[name*="Captcha"]');
      const bodyText = document.body.innerText.toLowerCase();
      const hasCaptchaText = bodyText.includes('captcha');
      const hasRecaptcha = !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"]');
      
      return {
        hasCaptcha: !!(captchaImage || captchaInput || hasCaptchaText),
        hasRecaptcha: hasRecaptcha,
      };
    });

    console.log('🔍 CAPTCHA Analysis:', captchaInfo);
    console.log('📝 Instructions:', instructions);

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

    // ✅ SE TEM CAPTCHA SIMPLES - RETORNAR RAPIDAMENTE
    if (captchaInfo.hasCaptcha) {
      console.log('🛡️ CAPTCHA detected, returning early...');
      await browser.close();
      return res.json({ 
        captcha: true,
        captchaType: 'simple',
        message: 'CAPTCHA detected - requires manual solution',
        instructions: instructions
      });
    }

    // ✅ SUCESSO - EXTRAIR CONTEÚDO SIMPLES
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
      instructions: instructions,
      success: true,
      contentLength: text.length,
      linksFound: links.length
    });
    
  } catch (err) {
    console.error('❌ Error in scraper:', err.message);
    if (browser) await browser.close();
    
    // ✅ RESPOSTA DE ERRO MAIS INFORMATIVA
    res.status(500).json({ 
      success: false,
      error: `Scraping failed: ${err.message}`,
      instructions: instructions,
      url: url
    });
  }
});

// ✅ ENDPOINT DE SCRAPING EM LOTE ATUALIZADO
app.post('/scrape-batch', async (req, res) => {
  console.log('📦 Recebendo requisição de scraping em lote...');
  
  const { urls, instructions } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Array de URLs é obrigatório' 
    });
  }

  console.log(`🎯 Processando ${urls.length} URLs com instruções: ${instructions}`);

  let browser;
  try {
    const executablePath = await chromium.executablePath();
    
    // ✅ CONFIGURAÇÃO ROBUSTA PARA O LOTE TAMBÉM
    const browserConfig = {
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ],
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true
    };

    browser = await puppeteer.launch(browserConfig);

    const results = [];
    const urlsToProcess = urls.slice(0, 3); // ✅ Reduzir para 3 URLs

    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i];
      
      try {
        console.log(`🌐 [${i + 1}/${urlsToProcess.length}] Processando: ${url}`);
        
        const page = await browser.newPage();
        
        // ✅ BLOQUEAR RECURSOS DESNECESSÁRIOS NO LOTE
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const resourceType = request.resourceType();
          const requestUrl = request.url().toLowerCase();
          const blockedTypes = ['image', 'media', 'font', 'stylesheet'];
          const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.avi', '.mov', '.pdf', '.zip', '.rar'];
          
          const isBlocked = blockedTypes.includes(resourceType) || 
                           blockedExtensions.some(ext => requestUrl.includes(ext));
          
          if (isBlocked) {
            request.abort();
          } else {
            request.continue();
          }
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.goto(url, { 
          waitUntil: 'networkidle2', // ✅ Mudar para networkidle2
          timeout: 10000 // ✅ Reduzir timeout
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
            skipped: true,
            instructions: instructions
          });
          await page.close();
          continue;
        }

        // Extrair conteúdo simples
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
          linksFound: links.length,
          instructions: instructions
        });

        console.log(`✅ URL ${i + 1} processada com sucesso`);

      } catch (error) {
        console.log(`❌ Erro processando URL ${i + 1}:`, error.message);
        results.push({
          success: false,
          url: url,
          error: error.message,
          instructions: instructions
        });
      }

      // Pequena pausa entre requests
      if (i < urlsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // ✅ Aumentar pausa
      }
    }

    await browser.close();

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
      instructions: instructions,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erro geral no scraping em lote:', error.message);
    if (browser) await browser.close();
    
    res.status(500).json({
      success: false,
      error: 'Erro no scraping em lote: ' + error.message,
      method: 'puppeteer-batch',
      instructions: instructions
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Puppeteer scraper running on port ${PORT}`);
  console.log(`🚫 Bloqueia: imagens, vídeos, CSS, fonts e arquivos baixáveis`);
  console.log(`📝 Segue instruções da planilha`);
  console.log(`🔧 Configuração robusta para evitar ETXTBSY`);
});