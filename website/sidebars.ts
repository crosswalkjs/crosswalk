import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Maps',
      collapsed: false,
      items: [
        'maps/map-document',
        'maps/schemas',
        'maps/xml',
        {
          type: 'category',
          label: 'Flat files',
          collapsed: false,
          link: {type: 'doc', id: 'maps/flat-files'},
          items: ['maps/formats/csv', 'maps/formats/fixed-width', 'maps/formats/hl7', 'maps/formats/x12', 'maps/formats/edifact'],
        },
        'maps/how-maps-run',
      ],
    },
    {
      type: 'category',
      label: 'Operators',
      collapsed: false,
      items: ['operators/reference', 'operators/custom-operators'],
    },
    {
      type: 'category',
      label: 'Editor',
      collapsed: false,
      items: ['editor/using-the-editor', 'editor/embedding', 'editor/read-only-view', 'editor/big-maps', 'editor/server'],
    },
    {
      type: 'category',
      label: 'Frameworks',
      collapsed: false,
      link: {type: 'doc', id: 'frameworks/overview'},
      items: [
        'frameworks/react',
        'frameworks/vue',
        'frameworks/svelte',
        'frameworks/angular',
        'frameworks/solid',
        'frameworks/astro',
        'frameworks/web-components',
        'frameworks/plain-javascript',
      ],
    },
    {
      type: 'category',
      label: 'Themes',
      collapsed: false,
      items: ['themes/built-in', 'themes/custom-themes'],
    },
    'dotnet',
    'api',
  ],
};

export default sidebars;
