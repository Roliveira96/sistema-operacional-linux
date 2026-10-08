import QRCode from 'qrcode';

/**
 * Gera de forma síncrona um SVG vetorial de QR Code real e escaneável para validação de certificados.
 */
export function gerarQrCodeSvgSincrono(url: string): string {
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const size: number = qr.modules.size;
    const margin: number = 1;
    const total: number = size + margin * 2;
    let path: string = '';

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c)) {
          path += `M${c + margin} ${r + margin}h1v1h-1z`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" width="100%" height="100%"><rect width="${total}" height="${total}" fill="#ffffff"/><path fill="#231F20" d="${path}"/></svg>`;
  } catch (erro) {
    console.error('Erro ao gerar QR code:', erro);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30" width="100%" height="100%"><rect width="30" height="30" fill="#ffffff"/><rect x="2" y="2" width="8" height="8" fill="#231F20"/><rect x="20" y="2" width="8" height="8" fill="#231F20"/><rect x="2" y="20" width="8" height="8" fill="#231F20"/><text x="15" y="17" font-size="5" text-anchor="middle" fill="#231F20">UTFPR</text></svg>`;
  }
}
