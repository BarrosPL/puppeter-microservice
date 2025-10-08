import express from 'express';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.send('Puppeteer scraper - Configuração robusta 🚀');
});

// 🔥 CONFIGURAÇÃO GLOBAL DO CHROMIUM
const getBrowserConfig = () => {
  return {
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection'
    ],
    executablePath: process.env.IS_LOCAL ? 
      '/usr/bin/chromium-browser' : 
      chromium.executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    dumpio: false
  };
};

// 🔥 FUNÇÃO PARA INICIAR BROWSER DE FORMA SEGURA
const launchBrowserSafely = async () => {
  let browser = null;
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      console.log(`🚀 Tentativa ${attempts + 1} de iniciar browser...`);
      const executablePath = await chromium.executablePath();
      console.log(`🔧 Executable path: ${executablePath}`);
      
      const browserConfig = getBrowserConfig();
      browserConfig.executablePath = executablePath;
      
      browser = await puppeteer.launch(browserConfig);
      console.log('✅ Browser iniciado com sucesso');
      return browser;
      
    } catch (error) {
      attempts++;
      console.error(`❌ Erro na tentativa ${attempts}:`, error.message);
      
      if (attempts >= maxAttempts) {
        throw new Error(`Falha após ${maxAttempts} tentativas: ${error.message}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

app.post('/scrape', async (req, res) => {
  const { url, instructions, captchaSolution } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser;
  try {
    console.log(`🌐 Iniciando scraping para: ${url}`);
    
    browser = await launchBrowserSafely();
    const page = await browser.newPage();
    
    await page.setDefaultNavigationTimeout(30000);
    await page.setDefaultTimeout(15000);
    
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const requestUrl = request.url().toLowerCase();
      
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
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`🌐 Navegando para: ${url}`);
    
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
    } catch (navError) {
      console.log('⚠️ Timeout na navegação, tentando continuar...');
    }

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

    if (captchaInfo.hasRecaptcha) {
      await browser.close();
      return res.json({ 
        captcha: true,
        captchaType: 'recaptcha',
        error: "reCAPTCHA detected - too complex for automatic solving",
        skip: true
      });
    }

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

    // ✅ SUCESSO - EXTRAIR CONTEÚDO
    console.log('✅ CAPTCHA resolved, extracting content...');
    
    const text = await page.evaluate(() => {
      const unwanted = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
      unwanted.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });
      return document.body.innerText;
    });

    // 🔥 REMOVIDO: Extração de links (não precisamos mais)
    console.log('✅ Conteúdo extraído, sem busca por novos links');

    await browser.close();
    
    res.json({ 
      captcha: false, 
      text, 
      links: [], // 🔥 RETORNAR ARRAY VAZIO - SEM NOVOS LINKS
      url: url,
      instructions: instructions,
      success: true,
      contentLength: text.length,
      linksFound: 0 // 🔥 ZERO LINKS ENCONTRADOS
    });
    
  } catch (err) {
    console.error('❌ Error in scraper:', err.message);
    if (browser) await browser.close();
    
    res.status(500).json({ 
      success: false,
      error: `Scraping failed: ${err.message}`,
      instructions: instructions,
      url: url
    });
  }
});

// 🔥 SCRAPE-BATCH MODIFICADO - APENAS CONTEÚDO, SEM NOVOS LINKS
app.post('/scrape-batch', async (req, res) => {
  console.log('📦 Recebendo requisição de scraping em lote...');
  
  const { urls, instructions, main_url, original_url } = req.body;
  
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Array de URLs é obrigatório' 
    });
  }

  const mainUrl = main_url || original_url;
  
  if (!mainUrl) {
    console.log('❌ ERRO: URL principal não fornecida');
    return res.status(400).json({
      success: false,
      error: 'URL principal (main_url ou original_url) é obrigatória'
    });
  }

  console.log(`🎯 Processando ${urls.length} sublinks APENAS para conteúdo`);
  console.log(`🌐 URL principal: ${mainUrl}`);

  let browser;
  try {
    browser = await launchBrowserSafely();
    const results = [];
    const urlsToProcess = urls; // Limitar para performance

    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i];
      
      try {
        console.log(`🌐 [${i + 1}/${urlsToProcess.length}] Extraindo conteúdo de: ${url}`);
        
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(20000);
        await page.setDefaultTimeout(15000);
        
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
        
        try {
          await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });
        } catch (navError) {
          console.log(`⚠️ Timeout navegando para ${url}, continuando...`);
        }

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
            main_url: mainUrl,
            error: 'CAPTCHA detected',
            skipped: true,
            instructions: instructions
          });
          await page.close();
          continue;
        }

        // 🔥 APENAS EXTRAIR CONTEÚDO - SEM BUSCAR NOVOS LINKS
        const text = await page.evaluate(() => {
          const unwanted = ['script', 'style', 'nav', 'header', 'footer', 'aside'];
          unwanted.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.remove());
          });
          return document.body.innerText;
        });

        await page.close();

        // 🔥 RESULTADO SIMPLIFICADO - SEM LINKS
        results.push({
          success: true,
          url: url,
          main_url: mainUrl,
          original_url: mainUrl,
          mainContent: text,
          contentLength: text.length,
          links: [], // 🔥 ARRAY VAZIO
          linksFound: 0, // 🔥 ZERO
          instructions: instructions
        });

        console.log(`✅ Conteúdo extraído de ${i + 1} (${text.length} chars)`);

      } catch (error) {
        console.log(`❌ Erro processando sublink ${i + 1}:`, error.message);
        results.push({
          success: false,
          url: url,
          main_url: mainUrl,
          error: error.message,
          instructions: instructions
        });
      }

      if (i < urlsToProcess.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await browser.close();

    const successfulScrapes = results.filter(r => r.success);
    const combinedContent = successfulScrapes
      .map(result => `--- URL: ${result.url} ---\n${result.mainContent}`)
      .join('\n\n');

    console.log(`✅ Lote finalizado: ${successfulScrapes.length}/${urlsToProcess.length} sucessos`);
    console.log(`📊 Total de conteúdo: ${combinedContent.length} caracteres`);

    res.json({
      success: true,
      method: 'puppeteer-batch-content-only', // 🔥 INDICAR MUDANÇA
      main_url: mainUrl,
      original_url: mainUrl,
      urlsProcessed: urlsToProcess.length,
      successfulScrapes: successfulScrapes.length,
      failedScrapes: results.length - successfulScrapes.length,
      combinedContent: combinedContent,
      totalContentLength: combinedContent.length,
      individualResults: results,
      instructions: instructions,
      content_only: true, // 🔥 FLAG PARA INDICAR QUE É APENAS CONTEÚDO
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erro geral no scraping em lote:', error.message);
    if (browser) await browser.close();
    
    res.status(500).json({
      success: false,
      error: 'Erro no scraping em lote: ' + error.message,
      method: 'puppeteer-batch',
      main_url: main_url || 'unknown',
      instructions: instructions
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Puppeteer scraper running on port ${PORT}`);
  console.log(`🔧 Modo: Apenas conteúdo - sem extrair novos links`);
});