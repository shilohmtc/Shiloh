import presentation from '../src/presentation/workspacePwa.js';

const { workspaceInstallPage } = presentation;

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
