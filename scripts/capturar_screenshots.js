import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOTS_DIR = path.resolve('docs/screenshots');

async function capturar() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1366, height: 768, deviceScaleFactor: 1.5 }
  });

  // 1. Menu Principal
  {
    console.log('1. Capturando Menu Principal...');
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.menu-instituicao-box');
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-menu-principal.png') });
    await page.close();
  }

  // 2. Exercícios e Lições de Terminal
  {
    console.log('2. Capturando Exercícios e Lições de Terminal (Permissões)...');
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:5173/#/permissoes', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.janela');
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-exercicios-licoes.png') });
    await page.close();
  }

  // 3. Simulado em Andamento (Questões e Terminais)
  {
    console.log('3. Capturando Simulado (Questões e Prova em Tempo Real)...');
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:5173/#/simulado', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sim-hub-card');
    const cards = await page.$$('.sim-hub-card');
    if (cards.length > 0) {
      await cards[0].click();
      await new Promise(r => setTimeout(r, 600));
      const btnIniciar = await page.$('.btn-iniciar-prova');
      if (btnIniciar) {
        await btnIniciar.click();
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-simulado-questoes.png') });
    await page.close();
  }

  // 4. Resultado do Simulado (Placar e Desempenho)
  {
    console.log('4. Capturando Resultado do Simulado...');
    const page = await browser.newPage();
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:5173/#/simulado', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.sim-hub-card');
    const cards = await page.$$('.sim-hub-card');
    if (cards.length > 0) {
      await cards[0].click();
      await new Promise(r => setTimeout(r, 600));
      const btnIniciar = await page.$('.btn-iniciar-prova');
      if (btnIniciar) {
        await btnIniciar.click();
        await new Promise(r => setTimeout(r, 800));
        // Clica para entregar a prova
        const btnEntregar = await page.$('.btn-entregar-prova-rodape') || await page.$('.btn-finalizar-prova-topo');
        if (btnEntregar) {
          await btnEntregar.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    // Aguarda o container do relatório carregar
    await page.waitForSelector('.sim-relatorio-container, .sim-relatorio-divisao');
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-resultado-simulado.png') });
    await page.close();
  }

  // 5. Certificado Oficial com Dados Mockados
  {
    console.log('5. Capturando Certificado Oficial com Dados Mockados...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 840, deviceScaleFactor: 1.5 });
    await page.goto('http://localhost:5173/certificado-exemplo.html', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.folha-diploma');
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05-geracao-certificado.png') });
    await page.close();
  }

  await browser.close();
  console.log('Sucesso absoluto! Todas as 5 imagens foram salvas em docs/screenshots/.');
}

capturar().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
