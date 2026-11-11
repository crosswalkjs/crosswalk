import React, {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import CodeBlock from '@theme/CodeBlock';
import {sandboxes, type SandboxName} from '@site/src/sandboxes';
import type {Packages, SandboxMessage} from './page';
import styles from './styles.module.css';

export interface SandboxProps {
  /** Which example to load, from src/sandboxes. */
  example: SandboxName;
  /** The preview's height in pixels. */
  height?: number;
}

/**
 * A live, editable example: the files in an editor, run in a sandboxed iframe
 * as you type, with the console underneath. Without JavaScript it shows the
 * files as ordinary code blocks.
 */
export default function Sandbox({example, height = 420}: SandboxProps): ReactNode {
  const files = sandboxes[example];
  return (
    <BrowserOnly
      fallback={
        <div>
          {Object.entries(files).map(([name, code]) => (
            <CodeBlock key={name} title={name} language={languageOf(name)}>
              {code}
            </CodeBlock>
          ))}
        </div>
      }>
      {() => <Live files={files} height={height} />}
    </BrowserOnly>
  );
}

const languageOf = (name: string) => (name.endsWith('.html') ? 'html' : name.endsWith('.json') ? 'json' : 'js');

/** A line in the console. */
type Entry = Omit<Extract<SandboxMessage, {level: unknown}>, 'crosswalkSandbox'>;

// The packages and the editor load once, and only on pages with a sandbox.
// raw-loader gives each package's built file as text; TypeScript would
// otherwise take these for the modules themselves.
type Text = Promise<{default: string}>;
let loaded: Promise<{packages: Packages; editor: typeof import('./editor')}> | undefined;
const load = () =>
  (loaded ??= Promise.all([
    import('!!raw-loader!../../../../packages/core/dist/index.js') as unknown as Text,
    import('!!raw-loader!../../../../packages/canvas/dist/index.js') as unknown as Text,
    import('./editor'),
  ]).then(([core, canvas, editor]) => ({packages: {core: core.default, canvas: canvas.default}, editor})));

let runs = 0;

function Live({files: original, height}: {files: Record<string, string>; height: number}) {
  const names = Object.keys(original);
  // The first file is the one to look at first.
  const [active, setActive] = useState(names[0]!);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [changed, setChanged] = useState(false);
  const [ready, setReady] = useState(false);
  const files = useRef({...original});
  const frame = useRef<HTMLIFrameElement>(null);
  const editorHost = useRef<HTMLDivElement>(null);
  const editor = useRef<import('./editor').FileEditor | null>(null);
  const packages = useRef<Packages | null>(null);
  const run = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What the example saved to localStorage, kept across reruns until Reset.
  const storage = useRef<Record<string, string>>({});
  const box = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    if (!frame.current || !packages.current) return;
    run.current = ++runs;
    setEntries([]);
    // The site paints its background on <html>, and its text colour on <body>.
    const html = document.documentElement;
    void import('./page').then(({buildPage}) => {
      if (!frame.current || !packages.current) return;
      frame.current.srcdoc = buildPage(files.current, packages.current, {
        run: run.current,
        background: getComputedStyle(html).backgroundColor,
        color: getComputedStyle(document.body).color,
        dark: html.dataset.theme === 'dark',
        storage: storage.current,
      });
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    // A page can have several sandboxes, so each starts only as it comes into view.
    const seen = new IntersectionObserver(
      (sightings) => {
        if (!sightings.some((sighting) => sighting.isIntersecting)) return;
        seen.disconnect();
        begin();
      },
      {rootMargin: '300px'},
    );
    if (box.current) seen.observe(box.current);
    const begin = () => void load().then(({packages: loadedPackages, editor: module}) => {
      if (disposed || !editorHost.current) return;
      packages.current = loadedPackages;
      editor.current = new module.FileEditor(editorHost.current, files.current, active, (name, text) => {
        files.current[name] = text;
        setChanged(true);
        clearTimeout(timer.current);
        // Runs once typing pauses, not on every key.
        timer.current = setTimeout(start, 500);
      });
      setReady(true);
      start();
    });
    const listen = (event: MessageEvent) => {
      const message = event.data as SandboxMessage | undefined;
      if (!message || event.source !== frame.current?.contentWindow || message.crosswalkSandbox !== run.current) return;
      if ('storage' in message) {
        storage.current = message.storage;
        return;
      }
      setEntries((current) => [...current.slice(-199), {level: message.level, text: message.text, where: message.where}]);
    };
    window.addEventListener('message', listen);
    return () => {
      disposed = true;
      seen.disconnect();
      clearTimeout(timer.current);
      window.removeEventListener('message', listen);
      editor.current?.destroy();
    };
    // The editor owns the files once it's created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The preview takes the page's colours when it runs, so it runs again when they change.
  const {colorMode} = useColorMode();
  const lastMode = useRef(colorMode);
  useEffect(() => {
    if (colorMode === lastMode.current) return;
    lastMode.current = colorMode;
    start();
  }, [colorMode, start]);

  const show = (name: string) => {
    setActive(name);
    editor.current?.show(name);
  };

  const reset = () => {
    files.current = {...original};
    storage.current = {};
    editor.current?.reset(files.current);
    setChanged(false);
    start();
  };

  return (
    <div className={styles.sandbox} ref={box}>
      <div className={styles.bar}>
        <div className={styles.tabs} role="tablist" aria-label="Files">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === active}
              className={name === active ? styles.activeTab : styles.tab}
              onClick={() => show(name)}>
              {name}
            </button>
          ))}
        </div>
        <button type="button" className={styles.run} onClick={start} disabled={!ready}>
          Run again
        </button>
        <button type="button" className={styles.button} onClick={reset} disabled={!changed}>
          Reset
        </button>
      </div>
      <div className={styles.panes}>
        <div className={styles.code} ref={editorHost}>
          {!ready && <div className={styles.loading}>Loading the editor…</div>}
        </div>
        <div className={styles.output}>
          <iframe ref={frame} className={styles.preview} style={{height}} sandbox="allow-scripts" title="Preview" />
          <div className={styles.console} aria-live="polite">
            <div className={styles.consoleTitle}>Console</div>
            {entries.length === 0 ? (
              <div className={styles.empty}>Nothing logged.</div>
            ) : (
              entries.map((entry, index) => (
                <div key={index} className={`${styles.entry} ${styles[entry.level]}`}>
                  <span className={styles.text}>{entry.text}</span>
                  {entry.where && <span className={styles.where}>{entry.where}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
