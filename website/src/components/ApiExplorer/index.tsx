import React, {useEffect, useRef, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import {useColorMode} from '@docusaurus/theme-common';
import type {MapDocument} from '@crosswalkjs/core';
import type {Mapper} from '@crosswalkjs/canvas';
import {orderMap} from '../../examples/order';
import {Toggles} from '../Controls';
import {EventLog, hookLines, hooks, useEventLog} from '../EventLog';
import styles from './styles.module.css';

/**
 * The editor's API, live: every hook it calls, switched on or off, logged as
 * it fires with what it was given; buttons for its methods; and the code for
 * the hooks that are on.
 */
export default function ApiExplorer(): ReactNode {
  return (
    <BrowserOnly fallback={<div className={styles.loading}>Loading the editor…</div>}>
      {() => <Explorer />}
    </BrowserOnly>
  );
}

// The order map, split over two pages, so there's a page to change to.
const map: MapDocument = {
  ...orderMap,
  pages: [
    {id: 'header', name: 'Header'},
    {id: 'lines', name: 'Lines'},
  ],
  nodes: orderMap.nodes.map((node) => ({...node, page: node.id === 'units' ? 'lines' : 'header'})),
  loops: orderMap.loops?.map((loop) => ({...loop, page: 'lines'})),
};

function Explorer() {
  const host = useRef<HTMLDivElement>(null);
  const mapper = useRef<Mapper | null>(null);
  const {colorMode} = useColorMode();
  const {listening, flip, log, add, clear, handlers} = useEventLog();

  useEffect(() => {
    let disposed = false;
    void import('@crosswalkjs/canvas').then((canvas) => {
      if (disposed || !host.current) return;
      // The site's own look is ink and paper, so its editors match it, light or dark with the site.
      const ink = canvas.resolveTheme('ink');
      canvas.registerTheme({id: 'docs-light', label: 'Ink (light)', extends: 'ink', scheme: 'light'});
      canvas.registerTheme({id: 'docs-dark', label: 'Ink (dark)', extends: 'ink', scheme: 'dark', colors: ink.darkColors});
      mapper.current = canvas.createMapper(host.current, {
        document: map,
        theme: colorMode === 'dark' ? 'docs-dark' : 'docs-light',
        toolboxCollapsed: true,
        ...handlers,
      });
    });
    return () => {
      disposed = true;
      mapper.current?.destroy();
    };
    // Made once; the theme is applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapper.current?.setTheme(colorMode === 'dark' ? 'docs-dark' : 'docs-light');
  }, [colorMode]);

  const methods: [string, () => unknown][] = [
    ['getSelection()', () => mapper.current?.getSelection()],
    ['getIssues()', () => mapper.current?.getIssues()],
    ['getDocument()', () => mapper.current?.getDocument()],
    ['undo()', () => mapper.current?.undo()],
    ['redo()', () => mapper.current?.redo()],
  ];

  const code = [
    'import { createMapper } from "@crosswalkjs/canvas";',
    '',
    'const mapper = createMapper(element, {',
    '  document: map,',
    ...hookLines(listening),
    '});',
    '',
    '// At any time:',
    'mapper.getSelection();',
    'mapper.getIssues();',
  ].join('\n');

  return (
    <div className={styles.frame}>
      <div ref={host} className={styles.editor} />
      <div className={styles.controls}>
        <div className={styles.row}>
          <span className={styles.label}>Listen to</span>
          <Toggles
            items={hooks.map((hook) => ({key: hook.key, label: hook.key, on: listening[hook.key]}))}
            onToggle={flip}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.label}>Call</span>
          <div className={styles.methods}>
            {methods.map(([name, call]) => (
              <button key={name} type="button" className={styles.method} onClick={() => add(name, call(), true)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <EventLog log={log} onClear={clear} />
      <div className={styles.code}>
        <CodeBlock language="ts">{code}</CodeBlock>
      </div>
    </div>
  );
}
