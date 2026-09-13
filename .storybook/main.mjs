const config = {
  stories: ['../stories/**/*.stories.js'],
  staticDirs: ['../public'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/html-vite',
    options: {},
  },
};
export default config;
