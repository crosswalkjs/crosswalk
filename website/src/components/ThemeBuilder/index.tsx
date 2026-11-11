import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import CodeBlock from '@theme/CodeBlock';
import type {Mapper, ResolvedTheme, ThemeColors, ThemeDefinition} from '@crosswalkjs/canvas';
import {orderMap} from '../../examples/order';
import styles from './styles.module.css';

/**
 * A theme made by picking: every setting a theme has, as a control, with the
 * real editor showing the result and the code for it underneath. The code has
 * only what's been changed from the theme it starts from.
 */
export default function ThemeBuilder(): ReactNode {
  return (
    <BrowserOnly fallback={<div className={styles.loading}>Loading the theme builder…</div>}>
      {() => <Builder />}
    </BrowserOnly>
  );
}

type Canvas = typeof import('@crosswalkjs/canvas');

/** What's been changed, as a theme definition without its id and label. */
type Edits = Omit<ThemeDefinition, 'id' | 'label'>;

const ID = 'my-theme';

const sections = ['Start', 'Colours', 'Operators', 'Text and shape', 'Lines and grid'] as const;
type Section = (typeof sections)[number];

const colourLabels: [keyof ThemeColors, string, string][] = [
  ['background', 'Background', 'The grid, and inputs'],
  ['panel', 'Panel', 'Toolbox, trees and inspector'],
  ['text', 'Text', 'Main text'],
  ['muted', 'Muted', 'Secondary text'],
  ['faint', 'Faint', 'Labels and hints'],
  ['border', 'Border', 'Dividers and outlines'],
  ['grid', 'Grid', "The grid's dots or lines"],
  ['hover', 'Hover', 'Rows and buttons under the pointer'],
  ['link', 'Lines', 'Lines between fields and operators'],
  ['accent', 'Accent', 'Selection and highlighted lines'],
  ['accentSoft', 'Soft accent', 'The fill behind a selection'],
  ['error', 'Error', 'Error badges and messages'],
  ['note', 'Notes', 'The tint of notes'],
  ['shadow', 'Shadow', 'A CSS box-shadow for tiles'],
];

const categoryLabels: [string, string][] = [
  ['text', 'Text'],
  ['math', 'Maths'],
  ['logic', 'Logic'],
  ['date', 'Dates'],
  ['convert', 'Convert'],
  ['aggregate', 'Aggregate'],
  ['flow', 'Flow'],
];

const fontFamilies: [string, string][] = [
  ['System sans', '-apple-system, "Segoe UI", system-ui, sans-serif'],
  ['Serif', 'Georgia, "Iowan Old Style", serif'],
  ['Monospace', 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'],
  ['Rounded', 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif'],
];

/** A colour a colour input can show, if the value is one: #rgb or #rrggbb. */
const asHex = (value: string): string | undefined => {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
};

/** The size and family out of a CSS font shorthand such as `13px/1.4 Inter, sans-serif`. */
const splitFont = (font: string) => {
  const match = /^(\d+(?:\.\d+)?)px(?:\/[\d.]+)?\s+(.+)$/.exec(font);
  return match ? {size: Number(match[1]), family: match[2]!} : {size: 13, family: font};
};

/** Writes a value as a TypeScript literal: keys unquoted where they can be, two-space indents. */
function literal(value: unknown, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  const short = entries.map(([key, v]) => `${/^[a-zA-Z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${literal(v, inner)}`);
  const oneLine = `{ ${short.join(', ')} }`;
  if (oneLine.length + indent.length <= 80 && !oneLine.includes('\n')) return oneLine;
  return `{\n${short.map((entry) => `${inner}${entry},`).join('\n')}\n${indent}}`;
}

/** The registerTheme call for what's been changed. */
function code(edits: Edits): string {
  const definition: Record<string, unknown> = {id: ID, label: 'My theme'};
  for (const [key, value] of Object.entries(edits)) {
    if (value === undefined || (typeof value === 'object' && Object.keys(value).length === 0)) continue;
    if (key === 'extends' && value === 'studio') continue;
    definition[key] = value;
  }
  return `import { createMapper, registerTheme } from "@crosswalkjs/canvas";\n\nregisterTheme(${literal(definition)});\n\ncreateMapper(element, { document: map, theme: "${ID}" });`;
}

function Builder() {
  const host = useRef<HTMLDivElement>(null);
  const mapper = useRef<Mapper | null>(null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [edits, setEdits] = useState<Edits>({extends: 'studio'});
  const [section, setSection] = useState<Section>('Start');
  const [problem, setProblem] = useState<string | undefined>();

  useEffect(() => {
    let disposed = false;
    void import('@crosswalkjs/canvas').then((loaded) => {
      if (disposed || !host.current) return;
      loaded.registerTheme({id: ID, label: 'My theme'});
      mapper.current = loaded.createMapper(host.current, {document: orderMap, theme: ID});
      setCanvas(loaded);
    });
    return () => {
      disposed = true;
      mapper.current?.destroy();
    };
  }, []);

  // The theme it starts from, all filled in: what a control shows until it's changed.
  const base: ResolvedTheme | undefined = useMemo(() => canvas?.resolveTheme(edits.extends ?? 'studio'), [canvas, edits.extends]);

  useEffect(() => {
    if (!canvas) return;
    try {
      canvas.registerTheme({id: ID, label: 'My theme', ...edits});
      mapper.current?.setTheme(ID);
      setProblem(undefined);
    } catch (error) {
      // A value typed by hand that isn't valid CSS: say so, and keep the last good look.
      setProblem((error as Error).message);
    }
  }, [canvas, edits]);

  // The editor's element stays the same while the controls load, so the editor isn't lost.
  if (!canvas || !base) {
    return (
      <div className={styles.frame}>
        <div className={styles.controls} />
        <div ref={host} className={styles.editor} />
        <div className={styles.code} />
      </div>
    );
  }

  /** Sets one value in a group, such as colors.accent, or clears it back to the base's when it matches. */
  const setIn = <K extends 'colors' | 'categories' | 'fonts' | 'shape'>(group: K, key: string, value: string | undefined) =>
    setEdits((current) => {
      const next = {...(current[group] as Record<string, string> | undefined)};
      const original = (base[group] as Record<string, string>)[key];
      if (value === undefined || value === original) delete next[key];
      else next[key] = value;
      return {...current, [group]: next};
    });
  const set = <K extends keyof Edits>(key: K, value: Edits[K] | undefined) =>
    setEdits((current) => {
      const next = {...current};
      if (value === undefined || value === (base as unknown as Edits)[key]) delete next[key];
      else next[key] = value;
      return next;
    });

  const resolved = {...base, ...edits, colors: {...base.colors, ...edits.colors}, categories: {...base.categories, ...edits.categories}, fonts: {...base.fonts, ...edits.fonts}, shape: {...base.shape, ...edits.shape}} as ResolvedTheme;
  const changed = (group: 'colors' | 'categories' | 'fonts' | 'shape', key: string) => (edits[group] as Record<string, string> | undefined)?.[key] !== undefined;

  const colour = (label: string, hint: string, value: string, isChanged: boolean, onChange: (value: string | undefined) => void) => (
    <label key={label} className={styles.row} title={hint}>
      <span className={styles.name}>
        {label}
        {isChanged && <span className={styles.changed} aria-label="changed" />}
      </span>
      <input type="color" className={styles.swatch} value={asHex(value) ?? '#000000'} disabled={!asHex(value)} onChange={(event) => onChange(event.target.value)} aria-label={`${label} colour`} />
      <input type="text" className={styles.text} value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} aria-label={label} />
      {isChanged && (
        <button type="button" className={styles.reset} onClick={() => onChange(undefined)} title="Back to the theme it starts from">
          ↺
        </button>
      )}
    </label>
  );

  const choice = <T extends string>(label: string, options: [T, string][], value: T, onChange: (value: T) => void) => (
    <div className={styles.row}>
      <span className={styles.name}>{label}</span>
      <div className={styles.choices} role="radiogroup" aria-label={label}>
        {options.map(([option, text]) => (
          <button key={option} type="button" role="radio" aria-checked={option === value} className={option === value ? styles.chosen : styles.option} onClick={() => onChange(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  const slider = (label: string, value: number, min: number, max: number, step: number, unit: string, onChange: (value: number) => void) => (
    <label className={styles.row}>
      <span className={styles.name}>{label}</span>
      <input type="range" className={styles.slider} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className={styles.value}>
        {value}
        {unit}
      </span>
    </label>
  );

  const radius = (value: string) => (value === '50%' ? 18 : Number.parseFloat(value) || 0);
  const ui = splitFont(resolved.fonts.ui);
  const familyName = fontFamilies.find(([, stack]) => stack === ui.family)?.[0];

  const controls: Record<Section, ReactNode> = {
    Start: (
      <>
        <label className={styles.row}>
          <span className={styles.name}>Start from</span>
          <select className={styles.select} value={edits.extends as string} onChange={(event) => setEdits((current) => ({...current, extends: event.target.value}))}>
            {canvas.themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </select>
        </label>
        {choice('Scheme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Follow the system']], resolved.scheme, (value) => set('scheme', value))}
        {choice('Density', [['compact', 'Compact'], ['regular', 'Regular'], ['roomy', 'Roomy']], resolved.density, (value) => set('density', value))}
        <p className={styles.hint}>
          {resolved.scheme === 'auto'
            ? 'This follows the system, so on a dark screen the dark colours of the theme it starts from show over the colours below.'
            : 'Everything you change is added to the theme it starts from; the code below has only what you changed.'}
        </p>
        <button type="button" className={styles.resetAll} onClick={() => setEdits({extends: edits.extends})}>
          Undo every change
        </button>
      </>
    ),
    Colours: <div className={styles.grid}>{colourLabels.map(([key, label, hint]) => colour(label, hint, resolved.colors[key], changed('colors', key), (value) => setIn('colors', key, value)))}</div>,
    Operators: (
      <div className={styles.grid}>
        {categoryLabels.map(([key, label]) => colour(label, `Operator tiles in ${label}`, resolved.categories[key] ?? '#888888', changed('categories', key), (value) => setIn('categories', key, value)))}
        {colour('Symbol', 'The symbol on every tile', resolved.glyph, edits.glyph !== undefined, (value) => set('glyph', value))}
      </div>
    ),
    'Text and shape': (
      <>
        <label className={styles.row}>
          <span className={styles.name}>Font</span>
          <select
            className={styles.select}
            value={familyName ?? ''}
            onChange={(event) => setIn('fonts', 'ui', `${ui.size}px/1.4 ${fontFamilies.find(([name]) => name === event.target.value)![1]}`)}>
            {familyName === undefined && <option value="">{ui.family.split(',')[0]}</option>}
            {fontFamilies.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {slider('Text size', ui.size, 11, 16, 0.5, 'px', (size) => setIn('fonts', 'ui', `${size}px/1.4 ${ui.family}`))}
        {choice('Symbols', [['inherit', 'Same font'], ['ui-monospace, "SF Mono", Menlo, Consolas, monospace', 'Monospace'], ['Georgia, serif', 'Serif']], resolved.fonts.glyph, (value) => setIn('fonts', 'glyph', value))}
        {slider('Panel corners', radius(resolved.shape.radius), 0, 16, 1, 'px', (value) => setIn('shape', 'radius', `${value}px`))}
        {slider('Operator corners', radius(resolved.shape.node), 0, 18, 1, resolved.shape.node === '50%' ? ' (round)' : 'px', (value) => setIn('shape', 'node', value >= 18 ? '50%' : `${value}px`))}
        {slider('Toolbox corners', radius(resolved.shape.chip), 0, 18, 1, resolved.shape.chip === '50%' ? ' (round)' : 'px', (value) => setIn('shape', 'chip', value >= 18 ? '50%' : `${value}px`))}
      </>
    ),
    'Lines and grid': (
      <>
        {choice('Lines', [['curved', 'Curved'], ['straight', 'Straight'], ['elbow', 'Right angles']], resolved.links, (value) => set('links', value))}
        {slider('Line width', Number.parseFloat(resolved.linkWidth), 1, 3, 0.2, 'px', (value) => set('linkWidth', `${Math.round(value * 10) / 10}px`))}
        {choice('Grid', [['dots', 'Dots'], ['lines', 'Lines'], ['drafting', 'Drafting'], ['none', 'None']], resolved.grid, (value) => set('grid', value))}
        {slider('Grid spacing', resolved.gridSize, 10, 32, 1, 'px', (value) => set('gridSize', value))}
      </>
    ),
  };

  return (
    <div className={styles.frame}>
      <div className={styles.controls}>
        <div className={styles.sections} role="tablist" aria-label="Settings">
          {sections.map((name) => (
            <button key={name} type="button" role="tab" aria-selected={name === section} className={name === section ? styles.chosen : styles.option} onClick={() => setSection(name)}>
              {name}
            </button>
          ))}
        </div>
        <div className={styles.panel} role="tabpanel">
          {controls[section]}
        </div>
        {problem && <p className={styles.problem}>{problem}</p>}
      </div>
      <div ref={host} className={styles.editor} />
      <div className={styles.code}>
        <CodeBlock language="ts">{code(edits)}</CodeBlock>
      </div>
    </div>
  );
}
