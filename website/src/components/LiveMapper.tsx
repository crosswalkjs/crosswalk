import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import {useColorMode} from '@docusaurus/theme-common';
import type {JsonValue, MapDocument} from '@crosswalkjs/core';
import type {Mapper, MapperOptions, MapViewOptions} from '@crosswalkjs/canvas';
import {Panel, Segmented, SITE, themesFrom, ThemePicker, ThemeSwitcher, Toggles, type ThemeChoice} from './Controls';
import styles from './LiveMapper.module.css';

export interface Example {
  label: string;
  map: MapDocument;
  input: JsonValue;
}

export interface LiveMapperProps {
  /** The map to show, with the sample input it runs on. Or give several `examples` to switch between. */
  map?: MapDocument;
  input?: JsonValue;
  examples?: Record<string, Example>;
  /** The read-only view, rather than the editor. */
  view?: boolean;
  /** Height of the editor in pixels. The read-only view sizes itself. */
  height?: number;
  /** Which sections start open. By default the options and the input and output are, and the code isn't. */
  open?: {options?: boolean; code?: boolean; data?: boolean};
  /** Every theme as a button above the editor, rather than in a dropdown with the options. */
  themeSwitcher?: boolean;
}

/**
 * The real Crosswalk editor, or read-only view, running in the page. Around
 * it are three sections a reader can open and close: the theme and options,
 * the code that makes what they see, and the input and output.
 */
export default function LiveMapper(props: LiveMapperProps): ReactNode {
  const height = props.height ?? 480;
  return (
    <BrowserOnly fallback={<div className={styles.loading} style={{height}}>Loading the editor…</div>}>
      {() => <Demo {...props} height={height} />}
    </BrowserOnly>
  );
}

/**
 * A switch for each option, named for what the reader sees, in the row it
 * sits in, with the option it sets and whether it's on by default.
 */
export const editorSwitches = [
  {row: 'Show', key: 'toolbox', label: 'Toolbox', option: 'toolboxCollapsed', onByDefault: true},
  {row: 'Show', key: 'pages', label: 'Pages', option: 'hidePages', onByDefault: true},
  {row: 'Show', key: 'search', label: 'Search', option: 'hideSearch', onByDefault: true},
  {row: 'Show', key: 'types', label: 'Data types', option: 'hideTypes', onByDefault: true},
  {row: 'Show', key: 'notes', label: 'Notes', option: 'hideNotes', onByDefault: true},
  {row: 'Options', key: 'samples', label: 'Live preview', option: 'preview', onByDefault: false},
  {row: 'Options', key: 'readOnly', label: 'Read-only', option: 'readOnly', onByDefault: false},
  {row: 'Options', key: 'mappedOnly', label: 'Mapped only', option: 'mappedOnly', onByDefault: false},
  {row: 'Options', key: 'autoLayout', label: 'Auto layout', option: 'autoLayout', onByDefault: false},
];

export const viewSwitches = [
  {row: 'Show', key: 'operators', label: 'Operators', option: 'hideOperators', onByDefault: true},
  {row: 'Show', key: 'pages', label: 'Pages', option: 'hidePages', onByDefault: true},
  {row: 'Show', key: 'search', label: 'Search', option: 'hideSearch', onByDefault: true},
  {row: 'Show', key: 'types', label: 'Data types', option: 'hideTypes', onByDefault: true},
  {row: 'Show', key: 'notes', label: 'Notes', option: 'hideNotes', onByDefault: true},
  {row: 'Options', key: 'grid', label: 'Mapping area', option: 'hideGrid', onByDefault: true},
  {row: 'Options', key: 'unmapped', label: 'All fields', option: 'showUnmapped', onByDefault: false},
  {row: 'Options', key: 'saved', label: 'Editor positions', option: 'savedLayout', onByDefault: false},
  {row: 'Options', key: 'samples', label: 'Sample values', option: 'preview', onByDefault: false},
];

export type Switch = (typeof editorSwitches)[number];

/** A heading that opens and closes the section under it. */
function Section({title, open, onToggle, children}: {title: string; open: boolean; onToggle: () => void; children: ReactNode}) {
  return (
    <div className={styles.section}>
      <button type="button" className={styles.sectionHead} aria-expanded={open} onClick={onToggle}>
        <span className={styles.chevron} aria-hidden="true" />
        {title}
      </button>
      {open && <div className={styles.sectionBody}>{children}</div>}
    </div>
  );
}

function Demo({map, input, examples, view = false, height, open = {}, themeSwitcher = false}: LiveMapperProps & {height: number}) {
  const host = useRef<HTMLDivElement>(null);
  const mapper = useRef<(Pick<Mapper, 'setTheme' | 'destroy'> & Partial<Pick<Mapper, 'getDocument'>>) | null>(null);
  const {colorMode} = useColorMode();
  const choices: Record<string, Example> = examples ?? {only: {label: '', map: map!, input: input ?? {}}};
  const [example, setExample] = useState(Object.keys(choices)[0]!);
  const [output, setOutput] = useState('');
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState(SITE);
  const [themes, setThemes] = useState<ThemeChoice[]>([]);
  const switches: Switch[] = view ? viewSwitches : editorSwitches;
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(switches.map((s) => [s.key, s.onByDefault])));
  // The toolbox starts folded. Whether it's open is kept apart from the
  // options, so folding it in the editor doesn't remake the editor.
  const toolboxOpen = useRef(false);
  const [toolboxShown, setToolboxShown] = useState(false);
  const [remake, setRemake] = useState(0);
  const shownOn = (key: string) => (key === 'toolbox' ? toolboxShown : on[key]!);
  const [shown, setShown] = useState({options: open.options ?? true, code: open.code ?? false, data: open.data ?? true});
  const flip = (section: keyof typeof shown) => setShown((current) => ({...current, [section]: !current[section]}));

  // Studio follows the operating system, but the site has its own toggle, so
  // the docs pin Studio's light or dark colours to match it.
  const themeId = theme === SITE ? (colorMode === 'dark' ? 'docs-dark' : 'docs-light') : theme;
  const sample = choices[example]!.input;
  // In the read-only view, operators and notes need the mapping area, and pages need the operators too.
  const needsGrid = (key: string) =>
    view && (((key === 'operators' || key === 'notes' || key === 'pages') && !on.grid) || (key === 'pages' && !on.operators));

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [core, canvas, extras] = await Promise.all([import('@crosswalkjs/core'), import('@crosswalkjs/canvas'), import('../examples/operators')]);
      if (disposed || !host.current) return;
      // The site's own look is ink and paper, so its editors match it, light or dark with the site.
      const ink = canvas.resolveTheme('ink');
      canvas.registerTheme({id: 'docs-light', label: 'Ink (light)', extends: 'ink', scheme: 'light'});
      canvas.registerTheme({id: 'docs-dark', label: 'Ink (dark)', extends: 'ink', scheme: 'dark', colors: ink.darkColors});
      setThemes(themesFrom(canvas));

      const registry = core.createRegistry({categories: extras.categories, operators: extras.operators});
      const run = (document: MapDocument) => {
        const errors = core.analyseMap(document, registry).issues.filter((issue) => issue.severity === 'error');
        if (errors.length > 0) {
          setFailed(true);
          setOutput(errors.map((issue) => `• ${issue.message}`).join('\n'));
          return;
        }
        try {
          setFailed(false);
          setOutput(JSON.stringify(core.createTransform(document, {registry})(sample), null, 2));
        } catch (error) {
          setFailed(true);
          setOutput((error as Error).message);
        }
      };
      // A new option carries on from whatever's been mapped so far; a new example starts afresh.
      const changedExample = host.current.dataset.example !== example;
      host.current.dataset.example = example;
      const current = (!changedExample && mapper.current?.getDocument?.()) || choices[example]!.map;
      mapper.current?.destroy();
      if (view) {
        const options: MapViewOptions = {
          document: current,
          registry,
          theme: themeId,
          hideOperators: !on.operators,
          hideGrid: !on.grid,
          hideTypes: !on.types,
          hideNotes: !on.notes,
          hidePages: !on.pages,
          hideSearch: !on.search,
          showUnmapped: on.unmapped,
          savedLayout: on.saved,
          ...(on.samples ? {preview: {input: sample}} : {}),
        };
        mapper.current = canvas.createMapView(host.current, options);
      } else {
        const options: MapperOptions = {
          document: current,
          registry,
          theme: themeId,
          // Folded, so the map has the column's width, until the reader opens it.
          toolboxCollapsed: !toolboxOpen.current,
          // The switch follows the editor's own fold button.
          onToolboxToggle: (collapsed) => {
            toolboxOpen.current = !collapsed;
            setToolboxShown(!collapsed);
          },
          onChange: run,
          readOnly: on.readOnly,
          mappedOnly: on.mappedOnly,
          autoLayout: on.autoLayout,
          hideTypes: !on.types,
          hideNotes: !on.notes,
          hidePages: !on.pages,
          hideSearch: !on.search,
          // Maps drawn for a wide editor would run off the edge of the docs' column.
          zoom: 0.9,
          ...(on.samples ? {preview: {input: sample}} : {}),
        };
        mapper.current = canvas.createMapper(host.current, options);
      }
      run(current);
    })();
    return () => {
      disposed = true;
    };
    // The editor owns the map once it's made. The theme is applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, example, remake]);

  useEffect(() => () => mapper.current?.destroy(), []);

  useEffect(() => {
    mapper.current?.setTheme(themeId);
  }, [themeId]);

  const rows = [...new Set(switches.map((s) => s.row))];

  return (
    <div className={styles.live}>
      {themeSwitcher && (
        <div className={styles.switcher}>
          <ThemeSwitcher themes={themes} value={theme} onChange={setTheme} />
        </div>
      )}
      <Section title={themeSwitcher ? 'Options' : 'Theme and options'} open={shown.options} onToggle={() => flip('options')}>
        <Panel
          flat
          rows={[
            ...(examples
              ? [
                  {
                    label: 'Example',
                    content: (
                      <Segmented label="Example" options={Object.entries(choices).map(([value, {label}]) => ({value, label}))} value={example} onChange={setExample} />
                    ),
                  },
                ]
              : []),
            ...(themeSwitcher ? [] : [{label: 'Theme', content: <ThemePicker themes={themes} value={theme} onChange={setTheme} />}]),
            // Short rows, so none wraps in the docs' column.
            ...rows.map((row) => ({
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
            })),
          ]}
        />
      </Section>
      {/* The read-only view sizes itself to its content. */}
      <div ref={host} className={styles.editor} style={view ? undefined : {height}} />
      <Section title="Code" open={shown.code} onToggle={() => flip('code')}>
        <CodeBlock language="ts">{code(view, switches, {...on, toolbox: toolboxShown}, theme === SITE ? 'ink' : theme, needsGrid)}</CodeBlock>
      </Section>
      <Section title="Input and output" open={shown.data} onToggle={() => flip('data')}>
        <div className={styles.data}>
          <div>
            <div className={styles.label}>Input</div>
            <pre className={styles.pane}>{JSON.stringify(sample, null, 2)}</pre>
          </div>
          <div>
            <div className={styles.label}>{failed ? 'Issues' : view ? 'Output' : 'Output (updates as you edit)'}</div>
            <pre className={`${styles.pane} ${failed ? styles.failed : ''}`}>{output}</pre>
          </div>
        </div>
      </Section>
    </div>
  );
}

/** The `createMapper` or `createMapView` call for the switches as they are, leaving out options at their defaults. */
function code(view: boolean, switches: Switch[], on: Record<string, boolean>, theme: string, needsGrid: (key: string) => boolean): string {
  const name = view ? 'createMapView' : 'createMapper';
  const options = [
    'document: map',
    theme !== 'ink' && `theme: "${theme}"`,
    ...switches
      .filter(({key, onByDefault}) => on[key] !== onByDefault && !needsGrid(key))
      .map(({option}) => (option === 'preview' ? 'preview: { input: sample }' : `${option}: true`)),
    !view && 'zoom: 0.9',
    !view && 'onChange: (next) => save(next)',
  ].filter(Boolean);
  return `import { ${name} } from "@crosswalkjs/canvas";\n\nconst ${view ? 'view' : 'mapper'} = ${name}(element, {\n${options.map((o) => `  ${o},`).join('\n')}\n});`;
}
