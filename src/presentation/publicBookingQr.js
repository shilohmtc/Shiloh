'use strict';

const QRCode = require('qrcode');

// Generated locally from the same public link displayed beside it. No tracking,
// account data, remote image service or browser permission is involved.
function publicBookingQr(url) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const margin = 4;
  const size = modules.size + margin * 2;
  const cells = [];
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) cells.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    }
  }
  return `<svg class="booking-phone-qr" data-booking-phone-qr role="img" aria-label="Scan with your phone camera to continue your booking" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="200" height="200" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${cells.join('')}" fill="#000"/></svg>`;
}

module.exports = { publicBookingQr };
