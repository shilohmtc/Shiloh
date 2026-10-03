const config = {
  stories: ['../stories/**/*.stories.js'],
  staticDirs: ['../public'],
  // Storybook owns these static assets. Vite's separate public copy races it
  // during builds and can fail with EEXIST inside storybook-static.
  viteFinal: async (viteConfig) => ({ ...viteConfig, publicDir: false }),
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
};
export default config;
