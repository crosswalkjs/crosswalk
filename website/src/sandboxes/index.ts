// Each sandbox's files, as text, in the order their tabs show; the first is
// the one it opens on. The files are real files beside this one, so they read
// as code, not as strings. Files in shared/ are used by several sandboxes.
import orderMap from '!!raw-loader!./shared/order.map.json';
import sampleOrder from '!!raw-loader!./shared/sample-order.json';
import emptyOrderMap from '!!raw-loader!./shared/empty-order.map.json';
import lineMap from '!!raw-loader!./shared/order-line.map.json';
import personMap from '!!raw-loader!./shared/person.map.json';
import customerMap from '!!raw-loader!./shared/customer.map.json';
import initials from '!!raw-loader!./shared/initials.js';
import withOutput from '!!raw-loader!./shared/with-output.html';

import plainIndex from '!!raw-loader!./plain-javascript/index.html';
import plainMain from '!!raw-loader!./plain-javascript/main.js';
import builtinsModule from '!!raw-loader!./builtins/crosswalk.js';
import builtinsMain from '!!raw-loader!./builtins/main.js';
import operatorModule from '!!raw-loader!./custom-operator/crosswalk.js';
import operatorMain from '!!raw-loader!./custom-operator/main.js';
import asyncModule from '!!raw-loader!./async-operator/crosswalk.js';
import asyncMain from '!!raw-loader!./async-operator/main.js';
import aggregateModule from '!!raw-loader!./aggregate-operator/crosswalk.js';
import aggregateMain from '!!raw-loader!./aggregate-operator/main.js';
import teamMap from '!!raw-loader!./aggregate-operator/team.map.json';
import categoriesModule from '!!raw-loader!./categories/crosswalk.js';
import categoriesMain from '!!raw-loader!./categories/main.js';
import serverModule from '!!raw-loader!./operators-from-server/crosswalk.js';
import serverMain from '!!raw-loader!./operators-from-server/main.js';
import optionsMain from '!!raw-loader!./embedding-options/main.js';
import labelsMain from '!!raw-loader!./labels/main.js';
import openApiIndex from '!!raw-loader!./schemas-openapi/index.html';
import openApiMain from '!!raw-loader!./schemas-openapi/main.js';
import shopApi from '!!raw-loader!./schemas-openapi/api/shop.json';
import bundleMain from '!!raw-loader!./schemas-bundle/main.js';
import xmlMain from '!!raw-loader!./xml-roundtrip/main.js';
import flatMain from '!!raw-loader!./flat-files/main.js';
import flatSchemas from '!!raw-loader!./flat-files/schemas.js';
import paymentsCsv from '!!raw-loader!./flat-files/api/payments.csv';
import orderXsd from '!!raw-loader!./xml-roundtrip/api/order.xsd';
import invoiceXsd from '!!raw-loader!./xml-roundtrip/api/invoice.xsd';
import orderXml from '!!raw-loader!./xml-roundtrip/api/order.xml';
import bundleOrder from '!!raw-loader!./schemas-bundle/api/schemas/order.json';
import bundleCustomer from '!!raw-loader!./schemas-bundle/api/schemas/customer.json';
import bundleTypes from '!!raw-loader!./schemas-bundle/api/schemas/common/types.json';
import eventsMain from '!!raw-loader!./editor-events/main.js';
import methodsIndex from '!!raw-loader!./editor-methods/index.html';
import methodsMain from '!!raw-loader!./editor-methods/main.js';
import savingMain from '!!raw-loader!./saving/main.js';
import liveOutputMain from '!!raw-loader!./live-output/main.js';
import themeModule from '!!raw-loader!./custom-theme/crosswalk.js';
import themeMain from '!!raw-loader!./custom-theme/main.js';
import auroraModule from '!!raw-loader!./theme-aurora/crosswalk.js';
import auroraMain from '!!raw-loader!./theme-aurora/main.js';
import registerIndex from '!!raw-loader!./theme-register/index.html';
import registerMain from '!!raw-loader!./theme-register/main.js';
import savedThemeMain from '!!raw-loader!./theme-from-server/main.js';
import customerTheme from '!!raw-loader!./theme-from-server/api/customer-theme.json';
import tamperedTheme from '!!raw-loader!./theme-from-server/api/tampered-theme.json';
import settingsModule from '!!raw-loader!./theme-settings/crosswalk.js';
import settingsMain from '!!raw-loader!./theme-settings/main.js';
import lightDarkIndex from '!!raw-loader!./theme-light-dark/index.html';
import lightDarkMain from '!!raw-loader!./theme-light-dark/main.js';

export const sandboxes = {
  // Frameworks: plain JavaScript
  'plain-javascript': {'main.js': plainMain, 'index.html': plainIndex, 'order.map.json': orderMap, 'sample-order.json': sampleOrder},

  // Your own operators
  builtins: {'crosswalk.js': builtinsModule, 'main.js': builtinsMain, 'order-line.map.json': lineMap},
  'custom-operator': {'crosswalk.js': operatorModule, 'main.js': operatorMain, 'index.html': withOutput, 'person.map.json': personMap},
  'async-operator': {'crosswalk.js': asyncModule, 'main.js': asyncMain, 'index.html': withOutput, 'customer.map.json': customerMap},
  'aggregate-operator': {'crosswalk.js': aggregateModule, 'main.js': aggregateMain, 'index.html': withOutput, 'team.map.json': teamMap},
  categories: {'crosswalk.js': categoriesModule, 'initials.js': initials, 'main.js': categoriesMain, 'person.map.json': personMap},
  'operators-from-server': {'crosswalk.js': serverModule, 'main.js': serverMain, 'customer.map.json': customerMap},

  // Embedding the editor
  'embedding-options': {'main.js': optionsMain, 'order.map.json': orderMap},
  labels: {'main.js': labelsMain, 'order.map.json': orderMap},

  // Schemas
  'schemas-openapi': {'main.js': openApiMain, 'index.html': openApiIndex, 'api/shop.json': shopApi},
  'flat-files': {'main.js': flatMain, 'schemas.js': flatSchemas, 'index.html': withOutput, 'api/payments.csv': paymentsCsv},
  'xml-roundtrip': {'main.js': xmlMain, 'index.html': withOutput, 'api/order.xsd': orderXsd, 'api/invoice.xsd': invoiceXsd, 'api/order.xml': orderXml},
  'schemas-bundle': {
    'main.js': bundleMain,
    'index.html': withOutput,
    'api/schemas/order.json': bundleOrder,
    'api/schemas/customer.json': bundleCustomer,
    'api/schemas/common/types.json': bundleTypes,
  },
  'editor-events': {'main.js': eventsMain, 'index.html': withOutput, 'order.map.json': orderMap},
  'editor-methods': {'main.js': methodsMain, 'index.html': methodsIndex, 'order.map.json': orderMap, 'order-line.map.json': lineMap},
  saving: {'main.js': savingMain, 'empty-order.map.json': emptyOrderMap},
  'live-output': {'main.js': liveOutputMain, 'index.html': withOutput, 'order.map.json': orderMap, 'sample-order.json': sampleOrder},

  // Your own themes
  'custom-theme': {'crosswalk.js': themeModule, 'main.js': themeMain, 'order.map.json': orderMap},
  'theme-aurora': {'crosswalk.js': auroraModule, 'main.js': auroraMain, 'initials.js': initials, 'person.map.json': personMap},
  'theme-register': {'main.js': registerMain, 'index.html': registerIndex, 'order.map.json': orderMap},
  'theme-from-server': {
    'main.js': savedThemeMain,
    'api/customer-theme.json': customerTheme,
    'api/tampered-theme.json': tamperedTheme,
    'order.map.json': orderMap,
  },
  'theme-settings': {'crosswalk.js': settingsModule, 'main.js': settingsMain, 'order.map.json': orderMap},
  'theme-light-dark': {'main.js': lightDarkMain, 'index.html': lightDarkIndex, 'order.map.json': orderMap},
} satisfies Record<string, Record<string, string>>;

export type SandboxName = keyof typeof sandboxes;
