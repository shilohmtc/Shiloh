import presentation from '../src/presentation/workspacePwa.js';

const { workspaceInstallPage, bindWorkspaceIosInstallBrowser } = presentation;

export default {
  title: 'Staff/Workspace installation',
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
};

export const SamsungDoorway = {
  render: () => {
    const html = workspaceInstallPage();
    const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
    const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] || '';
    const root = document.createElement('div');
    root.innerHTML = `<style>${styles}</style>${body}`;
    return root;
  },
};


function iPhoneDoorway(browser) {
  const root = SamsungDoorway.render();
  root.classList.add('workspace-iphone-guide');
  root.querySelector('[data-workspace-install-intro]').hidden = true;
  root.querySelector('[data-workspace-install-status]').hidden = true;
  root.querySelector('.mark').src = '/assets/pwa/shiloh-pwa-192.png';
  root.querySelector('[data-workspace-install-title]').textContent = 'Add Shiloh Workspace to your iPhone.';
  root.querySelector('[data-workspace-android-steps]').hidden = true;
  root.querySelector('[data-workspace-ios-steps]').hidden = false;
  root.querySelector('[data-workspace-install-status]').textContent = 'Use the steps for Safari or Chrome below.';
  const action = root.querySelector('[data-workspace-install-doorway]');
  action.hidden = true;
  action.textContent = 'Show iPhone steps';
  action.addEventListener('click', () => root.querySelector('[data-workspace-ios-guide]').scrollIntoView({ block: 'center' }));
  bindWorkspaceIosInstallBrowser(root, browser);
  return root;
}

export const IPhoneSafariDoorway = { render: () => iPhoneDoorway('safari') };
export const IPhoneChromeDoorway = { render: () => iPhoneDoorway('chrome') };
