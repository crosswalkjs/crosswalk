import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  startsOf,
  widthOf,
  describeAt,
  fieldAt,
  fieldsAt,
  instancesAt,
  isRows,
  levelOf,
  nameRange,
  paint,
  repeatRange,
  replaceAt,
  rowWidth,
  setCount,
  spansOf,
  ungroup,
  update,
  type Field,
  type FixedColumn,
  type Rows,
} from './fields';
import {linesOf, linesOfKind, splitCsv, type ColumnType, type Kind, type Layout} from './infer';
import styles from './styles.module.css';

export const typeLabels: [ColumnType, string][] = [
  ['string', 'Text'],
  ['integer', 'Whole number'],
  ['number', 'Number'],
  ['boolean', 'True or false'],
];

/** What's selected on the lines: some characters of one line, or a field, wherever it is in the nesting. */
export type Selection = {tag: string; line: number; from: number; to: number} | {tag: string; path: number[]; index: number; last?: number} | null;

const isRange = (s: Selection): s is {tag: string; line: number; from: number; to: number} => s !== null && 'line' in s;
const isField = (s: Selection): s is {tag: string; path: number[]; index: number; last?: number} => s !== null && 'path' in s;

/** Which kind of line a line is. */
export const kindOfLine = (line: string, layout: Layout): Kind | undefined =>
  layout.kinds.find((k) =>
    !layout.tagged ? true : layout.format === 'csv' ? splitCsv(line, layout)[0]!.trim() === k.tag : line.startsWith(k.tag) && k.tag.length === layout.tagLength,
  );

/**
 * The sample's lines, each character a target: drag across some to select them, click one to select the field it's
 * in. Fields show as edges, and nested rows as shading, deeper rows darker.
 */
export function FixedLines({
  text,
  layout,
  selection,
  onSelect,
  current,
  onPick,
  onKind,
}: {
  text: string;
  layout: Layout;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  current: string | undefined;
  onPick: (tag: string) => void;
  onKind: (tag: string, patch: Partial<Kind>) => void;
}): ReactNode {
  const [drag, setDrag] = useState<{tag: string; line: number; anchor: number; focus: number; shift: boolean} | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const lines = linesOf(text, layout).slice(0, 12);

  useEffect(() => {
    const up = () => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      const kind = layout.kinds.find((k) => k.tag === d.tag);
      const line = lines[d.line] ?? '';
      const body = line.slice(d.tag.length);
      if (d.anchor === d.focus) {
        // A click: the field there.
        const found = kind?.fields ? fieldAt(kind.fields, d.anchor, Math.max(body.length, kind.length)) : undefined;
        // Shift-click adds the field to the ones already selected beside it, to make a list of several.
        if (found && d.shift && isField(selection) && selection.tag === d.tag && selection.path.join() === found.path.join()) {
          const ends = [selection.index, selection.last ?? selection.index, found.index];
          onSelect({tag: d.tag, path: found.path, index: Math.min(...ends), last: Math.max(...ends)});
        } else onSelect(found ? {tag: d.tag, ...found} : null);
      } else onSelect({tag: d.tag, line: d.line, from: Math.min(d.anchor, d.focus), to: Math.max(d.anchor, d.focus) + 1});
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  return (
    <div className={styles.fixedArea}>
      <div className={[styles.fixedInner, styles.selectable].join(' ')}>
        {lines.map((line, n) => {
          const kind = kindOfLine(line, layout);
          if (!kind) return null;
          const tag = layout.tagged ? kind.tag : '';
          const body = line.slice(tag.length);
          const length = Math.max(body.length, 1);
          const {depth, odd, edge, rowEdge} = paint(kind.fields ?? [], length);
          const fieldSpans =
            isField(selection) && selection.tag === kind.tag && kind.fields
              ? Array.from({length: (selection.last ?? selection.index) - selection.index + 1}, (_, i) =>
                  spansOf(kind.fields!, selection.path, selection.index + i, length),
                ).flat()
              : [];
          const range =
            drag && drag.line === n
              ? {from: Math.min(drag.anchor, drag.focus), to: Math.max(drag.anchor, drag.focus) + 1}
              : isRange(selection) && selection.line === n
                ? selection
                : null;
          return (
            <div key={n} className={styles.fixedLine}>
              {tag && <LineTag kind={kind} kinds={layout.kinds} current={kind.tag === current} onPick={onPick} onKind={onKind} />}
              {Array.from(body, (c, k) => {
                const classes = [styles.ch];
                // Items of a list alternate in shade, deeper lists darker.
                if (depth[k]) classes.push(styles[`list${Math.min(depth[k]!, 3)}${odd[k] ? 'b' : 'a'}`]!);
                if (rowEdge[k]) classes.push(styles.chRowEdge!);
                else if (edge[k]) classes.push(styles.chEdge!);
                if (fieldSpans.some(([a, b]) => a <= k && k < b)) classes.push(styles.chField!);
                if (range && range.from <= k && k < range.to) classes.push(styles.chRange!);
                if (c === ' ') classes.push(styles.space!);
                return (
                  <span
                    key={k}
                    className={classes.join(' ')}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setDrag({tag: kind.tag, line: n, anchor: k, focus: k, shift: e.shiftKey});
                    }}
                    onPointerEnter={() => drag && drag.line === n && setDrag({...drag, focus: k})}
                    // A double-click selects just that character.
                    onDoubleClick={() => onSelect({tag: kind.tag, line: n, from: k, to: k + 1})}
                    title={kind.fields ? describeAt(kind.fields, k, length) : undefined}
                  >
                    {c === ' ' ? '·' : c}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What can be done with what's selected, always in one place under the lines. */
export function ActionBar({
  text,
  layout,
  selection,
  onSelect,
  onFields,
}: {
  text: string;
  layout: Layout;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onFields: (tag: string, fields: Field[]) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setName('');
    setProblem(null);
  }, [selection]);

  if (!selection)
    return (
      <div className={styles.bar2}>
        <span className={styles.name}>
          Click a character to select its field, and shift-click to add the fields beside it. Drag across some characters to name them.
        </span>
      </div>
    );
  const kind = layout.kinds.find((k) => k.tag === selection.tag);
  if (!kind) return null;
  const fields = kind.fields ?? [];
  const lines = linesOfKind(text, layout, kind.tag);

  if (isRange(selection)) {
    const all = linesOf(text, layout);
    const body = (all[selection.line] ?? '').slice(layout.tagged ? kind.tag.length : 0);
    const length = Math.max(body.length, kind.length);
    const level = levelOf(fields, selection.from, selection.to, length);
    const inside = instancesAt(lines, fields, level.path);
    const outer: string[] = [];
    let walk = fields;
    for (const i of level.path) {
      outer.push(walk[i]!.name);
      walk = (walk[i] as Rows).fields;
    }
    const levelLength = level.path.length === 0 ? kind.length : rowWidth(inside.fields);
    const apply = (result: Field[] | string, select?: number) => {
      if (typeof result === 'string') return setProblem(result);
      onFields(kind.tag, replaceAt(fields, level.path, result));
      onSelect(select === undefined ? null : {tag: kind.tag, path: level.path, index: select});
    };
    const nameIt = () => {
      if (!name.trim()) return setProblem('Type a name first.');
      const result = nameRange(inside.fields, level.from, level.to, inside.texts, name.trim());
      if (typeof result === 'string') return setProblem(result);
      apply(
        result,
        result.findIndex((f) => f.name === name.trim()),
      );
    };
    return (
      <div className={[styles.bar2, styles.bar2Range].join(' ')}>
        <div className={styles.barRow}>
          <code className={styles.value}>{body.slice(selection.from, selection.to).replaceAll(' ', '·')}</code>
          {outer.length > 0 && <span className={styles.name}>in {outer.join(' › ')}</span>}
          <form
            className={styles.check}
            onSubmit={(e) => {
              e.preventDefault();
              nameIt();
            }}
          >
            <input
              className={styles.input}
              autoFocus
              placeholder="a name, such as sku"
              value={name}
              aria-label="Name for what's selected"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className={styles.button}>
              Name it
            </button>
          </form>
          <button type="button" className={styles.link} onClick={() => onSelect(null)}>
            Cancel
          </button>
          {problem && <span className={styles.problem}>{problem}</span>}
        </div>
        <MakeList
          lines={lines}
          fields={fields}
          path={level.path}
          inside={inside}
          from={level.from}
          to={level.to}
          length={levelLength}
          outer={outer}
          what="these characters"
          onMake={apply}
        />
      </div>
    );
  }

  // A field: its settings, and its place in the nesting.
  const level = fieldsAt(fields, selection.path);
  const field = level[selection.index];
  if (!field) return null;
  const names: string[] = [];
  let walk = fields;
  for (const i of selection.path) {
    names.push(walk[i]!.name);
    walk = (walk[i] as Rows).fields;
  }
  const change = (patch: Partial<FixedColumn> | Partial<Rows>) => onFields(kind.tag, replaceAt(fields, selection.path, update(level, selection.index, patch)));
  // Making a list of the selected field, or fields, at their level.
  const last = selection.last ?? selection.index;
  const starts = startsOf(level);
  const inside = instancesAt(lines, fields, selection.path);
  const levelLength = selection.path.length === 0 ? kind.length : rowWidth(inside.fields);
  const makeList = (
    <MakeList
      lines={lines}
      fields={fields}
      path={selection.path}
      inside={inside}
      from={starts[selection.index]!}
      to={starts[last]! + widthOf(level[last]!)}
      length={levelLength}
      outer={names}
      what={last > selection.index ? 'these fields' : field.name}
      onMake={(next, index) => {
        onFields(kind.tag, replaceAt(fields, selection.path, next));
        onSelect({tag: kind.tag, path: selection.path, index});
      }}
    />
  );
  if (last > selection.index)
    return (
      <div className={[styles.bar2, styles.bar2Range].join(' ')}>
        <div className={styles.barRow}>
          <span className={styles.name}>
            {names.length > 0 ? `${names.join(' › ')} › ` : ''}
            {level
              .slice(selection.index, last + 1)
              .map((f) => f.name)
              .join(', ')}
          </span>
          <button type="button" className={styles.link} onClick={() => onSelect(null)}>
            Cancel
          </button>
        </div>
        {makeList}
      </div>
    );
  // Stops the nested rows a field is in, or the field itself if it's nested rows, from repeating.
  const stopAt = isRows(field) ? [...selection.path, selection.index] : selection.path;
  const stop = () => {
    const parent = stopAt.slice(0, -1);
    const inside = instancesAt(lines, fields, parent);
    const length = parent.length === 0 ? kind.length : rowWidth(inside.fields);
    onFields(kind.tag, replaceAt(fields, parent, ungroup(inside.fields, stopAt[stopAt.length - 1]!, inside.texts, length)));
    onSelect(null);
  };
  const stopName = stopAt.length > 0 ? fieldsAt(fields, stopAt.slice(0, -1))[stopAt[stopAt.length - 1]!]?.name : undefined;
  return (
    <div className={[styles.bar2, styles.bar2Range].join(' ')}>
      <div className={styles.barRow}>
        {names.length > 0 && <span className={styles.name}>{names.join(' › ')} ›</span>}
        <input className={styles.input} value={field.name} aria-label="Field name" onChange={(e) => change({name: e.target.value})} />
        {isRows(field) ? (
          <CountInput
            field={field}
            canRunOn={selection.path.length === 0 && selection.index === level.length - 1}
            inRow={selection.path.length > 0}
            onCount={(count) => {
              const inside = instancesAt(lines, fields, selection.path);
              const length = selection.path.length === 0 ? kind.length : rowWidth(inside.fields);
              onFields(kind.tag, replaceAt(fields, selection.path, setCount(inside.fields, selection.index, count, inside.texts, length)));
            }}
          />
        ) : (
          <ColumnSettings field={field} onChange={change} />
        )}
        {stopName !== undefined && (
          <button type="button" className={styles.button} onClick={stop}>
            Make {stopName} not a list
          </button>
        )}
      </div>
      {!isRows(field) && makeList}
    </div>
  );
}

/**
 * Making a list of some fields: what each line would hold as a list, before it's made, and a name for it. The
 * selected fields are one item, and the characters after them more items like it.
 */
function MakeList({
  lines,
  fields,
  path,
  inside,
  from,
  to,
  length,
  outer,
  what,
  onMake,
}: {
  lines: string[];
  fields: Field[];
  path: number[];
  inside: {texts: string[]; fields: Field[]};
  from: number;
  to: number;
  length: number;
  outer: string[];
  what: string;
  onMake: (fields: Field[], index: number) => void;
}): ReactNode {
  const [name, setName] = useState('');
  const listed = repeatRange(inside.fields, from, to, inside.texts, path.length === 0, length, outer);
  if (typeof listed === 'string')
    return (
      <div className={styles.barRow}>
        <span className={styles.name}>
          Can't make a list of {what}: {listed}
        </span>
      </div>
    );
  const preview = lines.slice(0, 3).map((line) => instancesAt([line], replaceAt(fields, path, listed.fields), [...path, listed.index]).texts);
  const make = () => {
    const next = [...listed.fields];
    next[listed.index] = {...next[listed.index]!, name: name.trim() || next[listed.index]!.name};
    onMake(next, listed.index);
  };
  return (
    <div className={styles.barRow}>
      <span className={styles.name}>Make a list of {what}? Each line would hold</span>
      {preview.map((items, n) => (
        <span key={n} className={styles.previewLine}>
          {items.length === 0 ? (
            <span className={styles.name}>none</span>
          ) : (
            items.map((item, i) => (
              <code key={i} className={styles.previewItem}>
                {item.replaceAll(' ', '·')}
              </code>
            ))
          )}
        </span>
      ))}
      <form
        className={styles.check}
        onSubmit={(e) => {
          e.preventDefault();
          make();
        }}
      >
        <input
          className={styles.input}
          placeholder="its name, such as items"
          value={name}
          aria-label="Name for the list"
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className={styles.button}>
          Make a list
        </button>
      </form>
    </div>
  );
}

/** How many nested rows there are: a number, or to the end of the line where that's allowed. */
function CountInput({field, canRunOn, inRow, onCount}: {field: Rows; canRunOn: boolean; inRow: boolean; onCount: (count: number | null) => void}) {
  return (
    <label className={styles.check}>
      <span className={styles.rowsBadge}>list</span>
      <input
        type="number"
        min={1}
        className={styles.small}
        placeholder={canRunOn ? 'all' : '1'}
        value={field.count ?? ''}
        aria-label={`How many ${field.name} there are`}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (n > 0) onCount(n);
          else if (canRunOn) onCount(null);
        }}
      />
      <span className={styles.name}>{field.count === null ? 'items, to the end of the line' : `items in each ${inRow ? 'item' : 'line'}`}</span>
    </label>
  );
}

/** A column's type, implied decimals and zero padding. */
function ColumnSettings({field, onChange}: {field: FixedColumn; onChange: (patch: Partial<FixedColumn>) => void}) {
  return (
    <>
      <select
        className={styles.select}
        value={field.type}
        aria-label={`Type of ${field.name}`}
        onChange={(e) => onChange({type: e.target.value as ColumnType})}
      >
        {typeLabels.map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </select>
      {field.type === 'number' && (
        <label className={styles.check}>
          <input
            type="number"
            min={0}
            max={6}
            className={styles.tiny}
            value={field.decimals}
            aria-label={`Implied decimals of ${field.name}`}
            onChange={(e) => onChange({decimals: Math.max(0, Number(e.target.value) || 0)})}
          />
          decimals
        </label>
      )}
      <label className={styles.check}>
        <input type="checkbox" checked={field.zeroPad} onChange={(e) => onChange({zeroPad: e.target.checked})} />
        padded with zeros
      </label>
      <span className={styles.name}>
        {field.width} {field.width === 1 ? 'character' : 'characters'}
      </span>
    </>
  );
}

/** A line's tag, which picks its kind of line to work on, and whether that kind reads as one record or a list. */
export function LineTag({
  kind,
  kinds,
  current,
  onPick,
  onKind,
}: {
  kind: Kind;
  kinds: Kind[];
  current: boolean;
  onPick: (tag: string) => void;
  onKind: (tag: string, patch: Partial<Kind>) => void;
}) {
  // Lines of a kind inside another sit in from it, so what's inside what can be seen.
  let depth = 0;
  for (let parent = kind.parent; parent !== null && depth < 8; depth++) parent = kinds.find((k) => k.tag === parent)?.parent ?? null;
  return (
    <span className={styles.lineTag} style={{paddingLeft: `${depth * 1.5}ch`}}>
      <select
        className={styles.tagSelect}
        value={kind.many ? 'many' : 'one'}
        aria-label={`${kind.tag} lines read as`}
        title={`${kind.tag} lines read as one record, or a list of them`}
        onChange={(e) => onKind(kind.tag, {many: e.target.value === 'many'})}
      >
        <option value="one">record</option>
        <option value="many">list</option>
      </select>
      <button
        type="button"
        className={[styles.tagButton, current ? styles.tagCurrent : ''].join(' ')}
        title={`Work on ${kind.tag} lines`}
        onClick={() => onPick(kind.tag)}
      >
        {kind.tag}
      </button>
    </span>
  );
}

/** JSON, written out with the keys of a field highlighted wherever it appears. */
export function JsonView({value, highlight}: {value: unknown; highlight: string[] | null}): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const rows: ReactNode[] = [];
  const matches = (keys: string[]) =>
    !!highlight && highlight.length > 0 && highlight.length <= keys.length && highlight.every((h, i) => keys[keys.length - highlight.length + i] === h);
  const line = (indent: number, key: string | null, text: ReactNode, marked: boolean) =>
    rows.push(
      <div key={rows.length} className={marked ? styles.jsonMarked : undefined}>
        {'  '.repeat(indent)}
        {key !== null && <span className={styles.jsonKey}>"{key}"</span>}
        {key !== null && ': '}
        {text}
      </div>,
    );
  const walk = (value: unknown, indent: number, key: string | null, keys: string[], last: boolean) => {
    const comma = last ? '' : ',';
    const marked = key !== null && matches(keys);
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      const entries: [string | null, unknown][] = Array.isArray(value) ? value.map((v) => [null, v]) : Object.entries(value);
      const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
      if (entries.length === 0) return line(indent, key, open + close + comma, marked);
      line(indent, key, open, marked);
      entries.forEach(([k, v], i) => walk(v, indent + 1, k, k === null ? keys : [...keys, k], i === entries.length - 1));
      line(indent, null, close + comma, false);
    } else line(indent, key, <span className={styles.jsonValue}>{JSON.stringify(value) + comma}</span>, marked);
  };
  walk(value, 0, null, [], true);
  // Bring the first highlighted key into view, inside the box only.
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>(`.${styles.jsonMarked}`);
    if (box.current && first) box.current.scrollTop = Math.max(0, first.offsetTop - 40);
  }, [highlight?.join('/')]);
  return (
    <div ref={box} className={styles.json}>
      {rows}
    </div>
  );
}
