import path from 'node:path';
import type {PrismTheme} from 'prism-react-renderer';

// Code in ink on paper: nearly no colour, so it reads like the rest of the page. Keywords are bold, comments and
// punctuation the second ink, strings a step lighter.
const inkCode = (ink: string, ink2: string, string: string, background: string): PrismTheme => ({
  plain: {color: ink, backgroundColor: background},
  styles: [
    {types: ['comment', 'prolog', 'doctype', 'cdata'], style: {color: ink2, fontStyle: 'italic'}},
    {types: ['keyword', 'builtin', 'important', 'atrule', 'boolean'], style: {fontWeight: 'bold'}},
    {types: ['string', 'char', 'attr-value', 'regex', 'template-string'], style: {color: string}},
    {types: ['punctuation', 'operator'], style: {color: ink2}},
    {types: ['property', 'attr-name', 'tag', 'function', 'class-name'], style: {color: ink, fontWeight: '500'}},
  ],
});
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const repo = 'https://github.com/crosswalkjs/crosswalk';

const config: Config = {
  title: 'Crosswalk',
  tagline: 'A visual mapper for JSON. Drag fields from one shape to another, and through operators on the way.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://crosswalkjs.github.io',
  baseUrl: '/crosswalk/',
  organizationName: 'crosswalkjs',
  projectName: 'crosswalk',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {onBrokenMarkdownLinks: 'throw'},
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    // The docs embed the real editor, built from this repo's packages.
    function crosswalkPackages() {
      return {
        name: 'crosswalk-packages',
        configureWebpack() {
          return {
            resolve: {
              alias: {
                '@crosswalkjs/core': path.resolve(__dirname, '../packages/core/dist/index.js'),
                '@crosswalkjs/canvas': path.resolve(__dirname, '../packages/canvas/dist/index.js'),
              },
            },
            // Sandbox files are loaded as text with raw-loader. A .json file
            // would otherwise still be parsed as JSON after it.
            module: {
              rules: [{test: /src[\\/]sandboxes[\\/].+\.json$/, type: 'javascript/auto'}],
            },
          };
        },
      };
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${repo}/tree/main/website/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Crosswalk',
      logo: {
        alt: 'Crosswalk',
        src: 'img/logo.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
        {to: '/playground', label: 'Playground', position: 'left'},
        {href: 'https://www.npmjs.com/package/@crosswalkjs/canvas', label: 'npm', position: 'right'},
        {href: repo, label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting started', to: '/docs/getting-started'},
            {label: 'Operators', to: '/docs/operators/reference'},
            {label: 'Themes', to: '/docs/themes/built-in'},
          ],
        },
        {
          title: 'Packages',
          items: [
            {label: '@crosswalkjs/core', href: 'https://www.npmjs.com/package/@crosswalkjs/core'},
            {label: '@crosswalkjs/canvas', href: 'https://www.npmjs.com/package/@crosswalkjs/canvas'},
          ],
        },
        {
          title: 'Project',
          items: [
            {label: 'GitHub', href: repo},
            {label: 'Issues', href: `${repo}/issues`},
          ],
        },
      ],
      copyright: `MIT licensed. © ${new Date().getFullYear()} James Mann.`,
    },
    prism: {
      // On the paper itself, with a hairline rule round it, as Little Office's code is.
      theme: inkCode('#15171c', '#4a4d55', '#5a5c63', '#fafaf8'),
      darkTheme: inkCode('#f2f1ec', '#b8b9bd', '#c9c7c0', '#15171c'),
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
