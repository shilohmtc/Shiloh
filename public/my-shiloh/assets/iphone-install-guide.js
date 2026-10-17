/* Shared presentation only: no installation, authentication or storage actions. */
function renderIphoneInstallGuide(list, browser, { appName = 'My Shiloh', handoff = false } = {}) {
  const doc = list.ownerDocument;
  const steps = [];
  if (handoff) {
    steps.push(['browser', browser ? `Open in ${browser === 'safari' ? 'Safari' : 'Chrome'}` : 'Open in Safari or Chrome', 'Use Open in browser in the Google app’s Share menu.']);
    steps.push(['link', 'Open My Shiloh', 'If you see share.google, enter app.shilohmtc.co.za/my-shiloh/ in your browser.']);
  }
  if (browser === 'safari') steps.push(['page-menu', 'Open Safari’s Page Menu', 'If Share is already visible, use it instead.']);
  if (browser === 'safari' || browser === 'chrome') {
    steps.push(['share', 'Tap Share', browser === 'chrome' ? 'Look beside the address bar.' : 'Choose Share from the menu.']);
    steps.push(['more', 'Tap View More, if shown', 'Tap the down arrow to expand the options. Otherwise, continue below.']);
    steps.push(['home', 'Add to Home Screen', browser === 'safari' ? 'Scroll down to find it. If missing, use Edit Actions.' : 'Scroll down and select this option.']);
    steps.push(['add', 'Tap Add', 'If you see Open as Web App, leave it switched on.']);
  }
  const paths = {
    'page-menu': 'M4 6h16M4 12h16M4 18h10.5',
    share: 'M12 15V3m0 0-4 4m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8',
    more: 'm6 9 6 6 6-6',
    home: 'M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm6 5v8m-4-4h8',
    browser: 'M14 4h6v6M20 4 10 14M10 5H5v15h15v-5',
    link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-5-5l4-4a4 4 0 0 1 5 0m2 0 1-1a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-5 0',
  };
  list.classList.add('iphone-guide-steps');
  list.replaceChildren(...steps.map(([kind, title, copy], index) => {
    const row = doc.createElement('li');
    row.dataset.iphoneGuideStep = kind;
    const number = doc.createElement('span');
    number.className = 'iphone-guide-number';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(index + 1);
    const ring = doc.createElement('span');
    ring.className = 'iphone-control-ring';
    ring.setAttribute('aria-hidden', 'true');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('iphone-control-icon', `iphone-control-${kind}`);
    if (kind === 'add') {
      const text = doc.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', '12'); text.setAttribute('y', '15');
      text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'system-ui, sans-serif'); text.setAttribute('font-weight', '700');
      text.textContent = 'Add'; svg.appendChild(text);
    } else {
      const path = doc.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', paths[kind]); path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.8');
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
    }
    ring.appendChild(svg);
    const content = doc.createElement('div'); content.className = 'iphone-guide-copy';
    const heading = doc.createElement('strong'); heading.dataset.installStepTitle = String(index + 1);
    heading.textContent = title;
    const description = doc.createElement('span'); description.dataset.installStepCopy = String(index + 1);
    description.textContent = copy;
    content.append(heading, description); row.append(number, ring, content); return row;
  }));
  let finish = list.nextElementSibling;
  if (!finish?.hasAttribute('data-iphone-guide-finish')) {
    finish = doc.createElement('p'); finish.dataset.iphoneGuideFinish = '';
    finish.className = 'iphone-guide-finish'; list.after(finish);
  }
  finish.hidden = !['safari', 'chrome'].includes(browser);
  finish.textContent = `Open ${appName} from your Home Screen.`;
}

if (typeof module !== 'undefined' && module.exports) module.exports = renderIphoneInstallGuide;
else globalThis.ShilohIphoneInstallGuide = renderIphoneInstallGuide;
