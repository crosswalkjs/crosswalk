import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import {useColorMode} from '@docusaurus/theme-common';
import {
  analyseMap,
  createRegistry,
  createTransform,
  jsonToXml,
  readFlatFile,
  resolveSchema,
  writeFlatFile,
  xmlToJson,
  type JsonValue,
  type MapDocument,
  type Schema,
} from '@crosswalkjs/core';
import type {Mapper} from '@crosswalkjs/canvas';
import {Panel, Segmented, SITE, themesFrom, ThemePicker, Toggles, type ThemeChoice} from '../Controls';
import {EventLog, hookLines, hooks, useEventLog, type HookName} from '../EventLog';
import {editorSwitches, viewSwitches, type Example} from '../LiveMapper';
import {categories, operators} from '../../examples/operators';
import {french} from '../../examples/french';
import styles from './styles.module.css';

export interface PlaygroundProps {
  examples: Record<string, Example>;
  /** What goes in the bar's "How it works". */
  help: ReactNode;
}

/**
 * The whole editor on one page: a bar of controls along the top, the editor,
 * and beside it a panel with the output, the input, the map itself, what the
 * editor says as you work, and the code for what you see.
 */
export default function Playground(props: PlaygroundProps): ReactNode {
  return (
    <BrowserOnly fallback={<div className={styles.loading}>Loading the editor…</div>}>
      {() => <Workbench {...props} />}
    </BrowserOnly>
  );
}

/** Options only the playground has room for, on top of the docs' switches. */
const editorExtras = [
  {row: 'Options', key: 'schemas', label: 'Edit schemas', option: 'editSchemas', onByDefault: false},
  {row: 'Options', key: 'fit', label: 'Fit content', option: 'fitContent', onByDefault: false},
];
const viewExtras = [{row: 'Options', key: 'fill', label: 'Fill the space', option: 'fillContainer', onByDefault: false}];

type Switch = {row: string; key: string; label: string; option: string; onByDefault: boolean};
const switchesFor = (viewing: boolean): Switch[] => (viewing ? [...viewSwitches, ...viewExtras] : [...editorSwitches, ...editorExtras]);

const zooms = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** The parts of the editor, or the view, the playground calls. The view has no selection or undo. */
type Handle = Pick<Mapper, 'getDocument' | 'setDocument' | 'setTheme' | 'getIssues' | 'setPreviewInput' | 'destroy'> &
  Partial<Pick<Mapper, 'getSelection' | 'undo' | 'redo'>>;

type Format = 'json' | 'xml' | 'flat';

/** What a schema says its data is written as: XML or a flat file if it has their hints, otherwise JSON. */
function formatOf(schema: Schema): Format {
  const resolved = resolveSchema(schema);
  return resolved.xml ? 'xml' : resolved.flat ? 'flat' : 'json';
}

const formatNames: Record<Format, string> = {json: 'JSON', xml: 'XML', flat: 'a flat file'};

function read(text: string, schema: Schema): JsonValue {
  const format = formatOf(schema);
  return format === 'xml' ? xmlToJson(text, schema) : format === 'flat' ? readFlatFile(text, schema) : (JSON.parse(text) as JsonValue);
}

function write(value: JsonValue, schema: Schema): string {
  const format = formatOf(schema);
  return format === 'xml' ? jsonToXml(value, schema) : format === 'flat' ? writeFlatFile(value, schema) : JSON.stringify(value, null, 2);
}

const pretty = (document: MapDocument) => JSON.stringify(document, null, 2);

function Workbench({examples, help}: PlaygroundProps) {
  const host = useRef<HTMLDivElement>(null);
  const mapper = useRef<Handle | null>(null);
  const {colorMode} = useColorMode();
  const registry = useMemo(() => createRegistry({categories, operators}), []);

  const first = Object.keys(examples)[0]!;
  const [example, setExample] = useState(first);
  // The map as it stands, kept in step with the editor, and in a ref for when the editor is made again.
  const [document, setDocumentState] = useState(examples[first]!.map);
  const latest = useRef(document);
  const setDocument = (next: MapDocument) => {
    latest.current = next;
    setDocumentState(next);
  };
  const [inputText, setInputText] = useState(() => JSON.stringify(examples[first]!.input, null, 2));

  const [viewing, setViewing] = useState(false);
  const switches = switchesFor(viewing);
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([...switchesFor(false), ...switchesFor(true)].map((s) => [s.key, s.onByDefault])),
  );
  // The toolbox starts folded. Whether it's open is kept apart from the
  // options, so folding it in the editor doesn't remake the editor.
  const toolboxOpen = useRef(false);
  const [toolboxShown, setToolboxShown] = useState(false);
  const [remake, setRemake] = useState(0);
  const shownOn = (key: string) => (key === 'toolbox' ? toolboxShown : on[key]!);
  const [zoom, setZoom] = useState(1);
  const [wording, setWording] = useState<'english' | 'french'>('english');
  const [theme, setTheme] = useState(SITE);
  const [themes, setThemes] = useState<ThemeChoice[]>([]);
  const themeId = theme === SITE ? (colorMode === 'dark' ? 'docs-dark' : 'docs-light') : theme;

  const [side, setSide] = useState(true);
  const [tab, setTab] = useState<'output' | 'input' | 'map' | 'events' | 'code'>('output');
  const events = useEventLog();

  // The input, read as the source schema says it's written.
  const inputFormat = formatOf(document.source);
  const input = useMemo((): {value: JsonValue} | {error: string} => {
    try {
      return {value: read(inputText, document.source)};
    } catch (error) {
      return {error: (error as Error).message};
    }
  }, [inputText, document.source]);
  const inputValue = 'value' in input ? input.value : undefined;

  // The output, written as the target schema says, or what stops the map running.
  const {output, failed} = useMemo(() => {
    if ('error' in input) return {failed: true, output: `The input isn't ${formatNames[inputFormat]} the source schema can read:\n${input.error}`};
    const errors = analyseMap(document, registry).issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) return {failed: true, output: errors.map((issue) => `• ${issue.message}`).join('\n')};
    try {
      return {failed: false, output: write(createTransform(document, {registry})(input.value), document.target)};
    } catch (error) {
      return {failed: true, output: (error as Error).message};
    }
  }, [document, input, inputFormat, registry]);

  // In the read-only view, operators and notes need the mapping area, and pages need the operators too.
  const needsGrid = (key: string) =>
    viewing && (((key === 'operators' || key === 'notes' || key === 'pages') && !on.grid) || (key === 'pages' && !on.operators));

  useEffect(() => {
    let disposed = false;
    void import('@crosswalkjs/canvas').then((canvas) => {
      if (disposed || !host.current) return;
      // The site's own look is ink and paper, so its editors match it, light or dark with the site.
      const ink = canvas.resolveTheme('ink');
      canvas.registerTheme({id: 'docs-light', label: 'Ink (light)', extends: 'ink', scheme: 'light'});
      canvas.registerTheme({id: 'docs-dark', label: 'Ink (dark)', extends: 'ink', scheme: 'dark', colors: ink.darkColors});
      setThemes(themesFrom(canvas));

      mapper.current?.destroy();
      const shared = {
        document: latest.current,
        registry,
        theme: themeId,
        hideTypes: !on.types,
        hideNotes: !on.notes,
        hidePages: !on.pages,
        hideSearch: !on.search,
        ...(wording === 'french' ? {labels: french} : {}),
        ...(on.samples && inputValue !== undefined ? {preview: {input: inputValue}} : {}),
        onPerformance: events.handlers.onPerformance,
      };
      mapper.current = viewing
        ? canvas.createMapView(host.current, {
            ...shared,
            hideOperators: !on.operators,
            hideGrid: !on.grid,
            showUnmapped: on.unmapped,
            savedLayout: on.saved,
            fillContainer: on.fill,
          })
        : canvas.createMapper(host.current, {
            ...shared,
            ...events.handlers,
            // Folded, so the map has the room, until it's opened.
            toolboxCollapsed: !toolboxOpen.current,
            // The switch follows the editor's own fold button.
            onToolboxToggle: (collapsed, automatic) => {
              toolboxOpen.current = !collapsed;
              setToolboxShown(!collapsed);
              events.handlers.onToolboxToggle(collapsed, automatic);
            },
            onChange: (next) => {
              setDocument(next);
              events.handlers.onChange(next);
            },
            readOnly: on.readOnly,
            mappedOnly: on.mappedOnly,
            autoLayout: on.autoLayout,
            editSchemas: on.schemas,
            fitContent: on.fit,
            zoom,
          });
    });
    return () => {
      disposed = true;
    };
    // The editor owns the map once it's made. The theme and the input are applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing, on, example, remake, zoom, wording]);

  useEffect(() => () => mapper.current?.destroy(), []);

  useEffect(() => {
    mapper.current?.setTheme(themeId);
  }, [themeId]);

  useEffect(() => {
    if (on.samples && inputValue !== undefined) mapper.current?.setPreviewInput(inputValue);
  }, [inputValue, on.samples]);

  const chooseExample = (key: string) => {
    setDocument(examples[key]!.map);
    setInputText(JSON.stringify(examples[key]!.input, null, 2));
    setExample(key);
  };

  /** Shows a map someone brought, in the editor as it is, so it can be undone. */
  const load = (next: MapDocument) => {
    mapper.current?.setDocument(next);
    setDocument(next);
  };

  const toggleRows = [...new Set(switches.map((s) => s.row))].map((row) => ({
    label: row,
    content: (
      <Toggles
        items={switches
          .filter((s) => s.row === row)
          .map(({key, label}) => ({
            key,
            label,
            on: shownOn(key),
            ...(needsGrid(key)
              ? {unavailable: key === 'pages' ? 'Pages need the operators and the mapping area.' : 'Operators and notes need the mapping area.'}
              : {}),
          }))}
        onToggle={(key) => {
          const next = !shownOn(key);
          if (key === 'toolbox') {
            toolboxOpen.current = next;
            setToolboxShown(next);
            setRemake((count) => count + 1);
          } else {
            setOn((current) => ({...current, [key]: next}));
          }
        }}
      />
    ),
  }));

  // The view only reports how long it took to draw.
  const listenable = viewing ? hooks.filter((hook) => hook.key === 'onPerformance') : hooks;
  const listening = Object.fromEntries(listenable.map((hook) => [hook.key, events.listening[hook.key]])) as Record<HookName, boolean>;

  const methods: [string, () => unknown][] = [
    ...(viewing ? [] : ([['getSelection()', () => mapper.current?.getSelection?.()]] as [string, () => unknown][])),
    ['getIssues()', () => mapper.current?.getIssues()],
    ['getDocument()', () => mapper.current?.getDocument()],
    ...(viewing
      ? []
      : ([
          ['undo()', () => after(() => mapper.current?.undo?.())],
          ['redo()', () => after(() => mapper.current?.redo?.())],
        ] as [string, () => unknown][])),
  ];
  // Undo and redo don't tell `onChange`, so the panel catches up with the editor itself.
  const after = (call: () => void) => {
    call();
    if (mapper.current) setDocument(mapper.current.getDocument());
    return undefined;
  };

  const code = codeFor({
    viewing,
    switches,
    on: {...on, toolbox: toolboxShown},
    needsGrid,
    theme: theme === SITE ? 'ink' : theme,
    zoom,
    french: wording === 'french',
    hooks: hookLines(listening),
  });

  return (
    <div className={styles.page}>
      <div className={styles.bar}>
        <Segmented
          label="Show"
          options={[
            {value: 'editor', label: 'Editor'},
            {value: 'view', label: 'Read-only view'},
          ]}
          value={viewing ? 'view' : 'editor'}
          onChange={(value) => setViewing(value === 'view')}
        />
        <Segmented label="Example" options={Object.entries(examples).map(([value, {label}]) => ({value, label}))} value={example} onChange={chooseExample} />
        <ThemePicker themes={themes} value={theme} onChange={setTheme} />
        <Popover label="Options">
          <Panel
            flat
            rows={[
              ...toggleRows,
              ...(viewing
                ? []
                : [
                    {
                      label: 'Zoom',
                      content: (
                        <select className={styles.select} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom">
                          {zooms.map((z) => (
                            <option key={z} value={z}>
                              {z * 100}%
                            </option>
                          ))}
                        </select>
                      ),
                    },
                  ]),
              {
                label: 'Wording',
                content: (
                  <Segmented
                    label="Wording"
                    options={[
                      {value: 'english', label: 'English'},
                      {value: 'french', label: 'French'},
                    ]}
                    value={wording}
                    onChange={setWording}
                  />
                ),
              },
            ]}
          />
        </Popover>
        <Popover label="How it works">{help}</Popover>
        <button type="button" className={styles.barButton} aria-pressed={side} onClick={() => setSide(!side)}>
          {side ? 'Hide panel' : 'Show panel'}
        </button>
      </div>
      <div className={styles.body}>
        <div ref={host} className={styles.editor} />
        {side && (
          <aside className={styles.side}>
            <div className={styles.tabs}>
              <Segmented
                label="Panel"
                options={[
                  {value: 'output', label: failed ? 'Issues' : 'Output'},
                  {value: 'input', label: 'Input'},
                  {value: 'map', label: 'Map'},
                  {value: 'events', label: 'Events'},
                  {value: 'code', label: 'Code'},
                ]}
                value={tab}
                onChange={setTab}
              />
            </div>
            <div className={styles.sideBody}>
              {tab === 'output' && <pre className={`${styles.pane} ${failed ? styles.failed : ''}`}>{output}</pre>}
              {tab === 'input' && (
                <div className={styles.stack}>
                  <div className={styles.note}>
                    <span>Read as {formatNames[inputFormat]}, as the source schema says. Change it and the output follows.</span>
                    <button type="button" className={styles.link} onClick={() => setInputText(JSON.stringify(examples[example]!.input, null, 2))}>
                      Reset
                    </button>
                  </div>
                  <textarea className={styles.text} value={inputText} spellCheck={false} onChange={(event) => setInputText(event.target.value)} aria-label="Input" />
                </div>
              )}
              {tab === 'map' && <MapTab document={document} onLoad={load} />}
              {tab === 'events' && (
                <div className={styles.stack}>
                  <div className={styles.listen}>
                    <div className={styles.label}>Listen to</div>
                    <Toggles items={listenable.map(({key}) => ({key, label: key, on: events.listening[key]}))} onToggle={events.flip} />
                    <div className={styles.label}>Call</div>
                    <div className={styles.methods}>
                      {methods.map(([name, call]) => (
                        <button key={name} type="button" className={styles.method} onClick={() => events.add(name, call(), true)}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <EventLog log={events.log} onClear={events.clear} fill />
                </div>
              )}
              {tab === 'code' && <CodeBlock language="ts">{code}</CodeBlock>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** The map as JSON: edit it or paste one in and apply it, open a file, or take a copy away. */
function MapTab({document, onLoad}: {document: MapDocument; onLoad: (next: MapDocument) => void}) {
  // What's typed here is kept until it's applied or thrown away; until then it follows the editor.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [problem, setProblem] = useState('');
  const [copied, setCopied] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const text = draft ?? pretty(document);

  const apply = (json: string) => {
    try {
      const next = JSON.parse(json) as MapDocument;
      if (next?.version !== 1 || !next.source || !next.target || !Array.isArray(next.nodes) || !Array.isArray(next.links)) {
        throw new Error('A map needs "version": 1, a source and target schema, and lists of nodes and links.');
      }
      onLoad(next);
      setDraft(undefined);
      setProblem('');
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  const download = () => {
    const link = window.document.createElement('a');
    link.href = URL.createObjectURL(new Blob([pretty(document)], {type: 'application/json'}));
    link.download = 'map.json';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.note}>
        <span>{draft === undefined ? 'The map as JSON, as you edit it. Change it here, or paste one in.' : 'Edited here. Apply it to show it in the editor.'}</span>
      </div>
      <div className={styles.actions}>
        {draft !== undefined && (
          <>
            <button type="button" className={styles.method} onClick={() => apply(draft)}>
              Apply
            </button>
            <button
              type="button"
              className={styles.method}
              onClick={() => {
                setDraft(undefined);
                setProblem('');
              }}>
              Throw away
            </button>
          </>
        )}
        <button type="button" className={styles.method} onClick={() => file.current?.click()}>
          Open a file…
        </button>
        <button type="button" className={styles.method} onClick={download}>
          Download
        </button>
        <button
          type="button"
          className={styles.method}
          onClick={() => {
            void navigator.clipboard.writeText(pretty(document)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) void chosen.text().then(apply);
          }}
        />
      </div>
      {problem && <p className={styles.problem}>{problem}</p>}
      <textarea className={styles.text} value={text} spellCheck={false} onChange={(event) => setDraft(event.target.value)} aria-label="Map" />
    </div>
  );
}

/** A button in the bar that opens a box under it. A click anywhere else closes it. */
function Popover({label, children}: {label: string; children: ReactNode}) {
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (box.current?.open && !box.current.contains(event.target as Node)) box.current.open = false;
    };
    window.document.addEventListener('pointerdown', close);
    return () => window.document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details ref={box} className={styles.popover}>
      <summary className={styles.barButton}>{label}</summary>
      <div className={styles.popoverBody}>{children}</div>
    </details>
  );
}

/** The `createMapper` or `createMapView` call for what's on screen, leaving out options at their defaults. */
function codeFor({
  viewing,
  switches,
  on,
  needsGrid,
  theme,
  zoom,
  french,
  hooks,
}: {
  viewing: boolean;
  switches: Switch[];
  on: Record<string, boolean>;
  needsGrid: (key: string) => boolean;
  theme: string;
  zoom: number;
  french: boolean;
  hooks: string[];
}): string {
  const name = viewing ? 'createMapView' : 'createMapper';
  const options = [
    'document: map',
    'registry, // the built-in operators and the examples\' own',
    theme !== 'ink' && `theme: "${theme}",`,
    ...switches
      .filter(({key, onByDefault}) => on[key] !== onByDefault && !needsGrid(key))
      .map(({option}) => (option === 'preview' ? 'preview: { input: sample }' : `${option}: true`)),
    !viewing && zoom !== 1 && `zoom: ${zoom}`,
    french && 'labels: french, // { operators: "Opérateurs", … }',
  ]
    .filter((line): line is string => typeof line === 'string')
    .map((line) => `  ${line.endsWith(',') || line.includes('//') ? line : `${line},`}`);
  return `import { ${name} } from "@crosswalkjs/canvas";\n\nconst ${viewing ? 'view' : 'mapper'} = ${name}(element, {\n${[...options, ...hooks].join('\n')}\n});`;
}
