import React, {useState, type ReactNode} from 'react';
import {cellsOf, linesOf, splitAt, splitCsv, withSubfields, type Column, type ColumnType, type Group, type Kind, type Layout} from './infer';
import {kindOfLine, LineTag, typeLabels} from './Workbench';
import styles from './styles.module.css';

/** What's selected on a CSV file's lines: a field, a part of one at any depth, or a run of fields side by side. */
export type CsvSelection = {tag: string; column: number; path: number[]; last?: number} | null;

/** A column with the part at a path replaced. */
const replacePart = (column: Column, path: number[], next: (part: Column) => Column): Column =>
  path.length === 0 ? next(column) : {...column, parts: column.parts!.map((p, k) => (k === path[0] ? replacePart(p, path.slice(1), next) : p))};

/** The part of a column at a path. */
const partAt = (column: Column, path: number[]): Column | undefined => path.reduce<Column | undefined>((c, j) => c?.parts?.[j], column);

/** Which column a field at a place on a line is, where fields after a list's first item are more items of it. */
function columnFor(kind: Kind, place: number): {column: number; item: number} {
  const g = kind.group;
  if (!g || place < g.from) return {column: place, item: 0};
  const size = g.to - g.from + 1;
  const items = g.count ?? Infinity;
  const item = Math.floor((place - g.from) / size);
  if (item < items) return {column: g.from + ((place - g.from) % size), item};
  return {column: place - (items - 1) * size, item: 0};
}

/** Every value a part takes in the sample: the column's values, split down the path. */
function valuesAt(values: string[], column: Column, path: number[], release?: string): string[] {
  let current = values.flatMap((v) => (column.repeatOn ? splitAt(v, column.repeatOn, release) : [v]));
  let node = column;
  for (const j of path) {
    current = current.map((v) => (node.splitOn ? (splitAt(v, node.splitOn, release)[j] ?? '') : ''));
    node = node.parts?.[j] ?? node;
  }
  return current;
}

/**
 * A CSV file's lines, each field and each part of one a target: click to select it, shift-click another field to
 * select the fields between. A line's tag, at its start, picks its kind of line.
 */
export function CsvLines({
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
  selection: CsvSelection;
  onSelect: (selection: CsvSelection) => void;
  current: string | undefined;
  onPick: (tag: string) => void;
  onKind: (tag: string, patch: Partial<Kind>) => void;
}): ReactNode {
  const lines = linesOf(text, layout).slice(0, 12);
  const sep = (s: string) => <span className={styles.space}>{s === '\t' ? '→' : s}</span>;

  const isSelected = (tag: string, column: number, path: number[]) =>
    !!selection &&
    selection.tag === tag &&
    column >= selection.column &&
    column <= (selection.last ?? selection.column) &&
    (selection.last !== undefined && selection.last !== selection.column ? true : selection.path.join() === path.join());

  // A value, split into its list's items and its parts, each piece clickable.
  const value = (text: string, column: Column, at: {tag: string; column: number}, path: number[], key: string): ReactNode => {
    const leaf = (piece: string, node: Column, here: number[], k: string): ReactNode => {
      if (node.splitOn && node.parts?.length) {
        const pieces = splitAt(piece, node.splitOn, layout.release);
        return (
          <React.Fragment key={k}>
            {pieces.map((p, j) => (
              <React.Fragment key={j}>
                {j > 0 && sep(node.splitOn!)}
                {leaf(p, node.parts![j] ?? node, [...here, j], `${k}.${j}`)}
              </React.Fragment>
            ))}
          </React.Fragment>
        );
      }
      const chosen = isSelected(at.tag, at.column, here);
      return (
        <span
          key={k}
          className={[styles.csvPiece, chosen ? styles.chField : '', piece === '' ? styles.csvEmpty : ''].join(' ')}
          title={[column.name, ...here.map((j, d) => partAt(column, here.slice(0, d + 1))?.name ?? `part${j + 1}`)].join(' › ')}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey && selection && selection.tag === at.tag && selection.path.length === 0 && here.length === 0) {
              const ends = [selection.column, selection.last ?? selection.column, at.column];
              onSelect({tag: at.tag, column: Math.min(...ends), last: Math.max(...ends), path: []});
            } else onSelect({tag: at.tag, column: at.column, path: here});
          }}
        >
          {piece === '' ? '·' : piece}
        </span>
      );
    };
    if (!column.repeatOn) return leaf(text, column, path, key);
    const items = splitAt(text, column.repeatOn, layout.release);
    return (
      <React.Fragment key={key}>
        {items.map((item, n) => (
          <React.Fragment key={n}>
            {n > 0 && sep(column.repeatOn!)}
            <span className={n % 2 ? styles.list1b : styles.list1a}>{leaf(item, column, path, `${key}:${n}`)}</span>
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  };

  return (
    <div className={styles.fixedArea}>
      <div className={styles.fixedInner}>
        {lines.map((line, n) => {
          const kind = kindOfLine(line, layout);
          if (!kind) return null;
          const fields = splitCsv(line, layout);
          // A header line names the columns; it isn't data.
          if (!layout.tagged && layout.header && n === 0)
            return (
              <div key={n} className={[styles.fixedLine, styles.headerLine].join(' ')}>
                {fields.map((f, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && sep(layout.delimiter)}
                    {f}
                  </React.Fragment>
                ))}
              </div>
            );
          const data = layout.tagged ? fields.slice(1) : fields;
          return (
            <div key={n} className={styles.fixedLine}>
              {layout.tagged && <LineTag kind={kind} kinds={layout.kinds} current={kind.tag === current} onPick={onPick} onKind={onKind} />}
              {data.map((field, place) => {
                const {column: index, item} = columnFor(kind, place);
                const column = kind.columns[index];
                return (
                  <React.Fragment key={place}>
                    {(place > 0 || layout.tagged) && sep(layout.delimiter)}
                    <span className={item > 0 ? (item % 2 ? styles.list1b : styles.list1a) : undefined}>
                      {column ? value(field, column, {tag: kind.tag, column: index}, [], `${place}`) : <span className={styles.csvEmpty}>{field}</span>}
                    </span>
                  </React.Fragment>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What can be done with what's selected in a CSV file: name it, set its type, its parts and lists, under the lines. */
export function CsvBar({
  text,
  layout,
  selection,
  onSelect,
  onKind,
}: {
  text: string;
  layout: Layout;
  selection: CsvSelection;
  onSelect: (selection: CsvSelection) => void;
  onKind: (tag: string, patch: Partial<Kind>) => void;
}): ReactNode {
  const [listName, setListName] = useState('');
  if (!selection)
    return (
      <div className={styles.bar2}>
        <span className={styles.name}>
          Click a field or a part of one to name it. Shift-click another field to select the fields between, to make a list of them.
        </span>
      </div>
    );
  const kind = layout.kinds.find((k) => k.tag === selection.tag);
  if (!kind) return null;
  const cells = cellsOf(text, layout, kind);
  const values = (i: number) => cells.map((row) => row[i] ?? '');
  const deeper = layout.separators.subpart ? [layout.separators.subpart] : [];
  const setColumn = (i: number, next: Column) => onKind(kind.tag, {columns: kind.columns.map((c, k) => (k === i ? next : c))});
  const g = kind.group;

  // Several fields side by side: a list of them.
  const last = selection.last ?? selection.column;
  if (last > selection.column) {
    const size = last - selection.column + 1;
    const rows = cells.slice(0, 3).map((row) => {
      const items: string[] = [];
      for (let at = selection.column; at < row.length; at += size) items.push(row.slice(at, at + size).join(layout.delimiter));
      return items;
    });
    const names = kind.columns.slice(selection.column, last + 1).map((c) => c.name);
    return (
      <div className={[styles.bar2, styles.bar2Range].join(' ')}>
        <div className={styles.barRow}>
          <span className={styles.name}>{names.join(', ')}</span>
          <button type="button" className={styles.link} onClick={() => onSelect(null)}>
            Cancel
          </button>
        </div>
        {!layout.tagged && layout.header ? (
          <div className={styles.barRow}>
            <span className={styles.name}>
              A file with a header row can only have a list inside one field: select that field and say what splits its items.
            </span>
          </div>
        ) : (
          <div className={styles.barRow}>
            <span className={styles.name}>Make a list of these fields? Each line would hold</span>
            {rows.map((items, n) => (
              <span key={n} className={styles.previewLine}>
                {items.map((item, i) => (
                  <code key={i} className={styles.previewItem}>
                    {item}
                  </code>
                ))}
              </span>
            ))}
            <form
              className={styles.check}
              onSubmit={(e) => {
                e.preventDefault();
                const group: Group = {from: selection.column, to: last, name: listName.trim() || 'items', count: null};
                onKind(kind.tag, {group});
                onSelect({tag: kind.tag, column: selection.column, path: []});
                setListName('');
              }}
            >
              <input
                className={styles.input}
                placeholder="its name, such as items"
                value={listName}
                aria-label="Name for the list"
                onChange={(e) => setListName(e.target.value)}
              />
              <button type="submit" className={styles.button}>
                Make a list
              </button>
            </form>
          </div>
        )}
      </div>
    );
  }

  const column = kind.columns[selection.column];
  if (!column) return null;
  const node = partAt(column, selection.path);
  if (!node) return null;
  const top = selection.path.length === 0;
  const nodeValues = valuesAt(values(selection.column), column, selection.path, layout.release);
  const change = (next: (c: Column) => Column) => setColumn(selection.column, replacePart(column, selection.path, next));
  const trail = [column.name, ...selection.path.map((_, d) => partAt(column, selection.path.slice(0, d + 1))?.name ?? '')];
  const inList = g && selection.column >= g.from && selection.column <= g.to;
  return (
    <div className={[styles.bar2, styles.bar2Range].join(' ')}>
      <div className={styles.barRow}>
        {inList && <span className={styles.name}>{g!.name} ›</span>}
        {trail.length > 1 && <span className={styles.name}>{trail.slice(0, -1).join(' › ')} ›</span>}
        <input className={styles.input} value={node.name} aria-label="Field name" onChange={(e) => change((c) => ({...c, name: e.target.value}))} />
        {node.splitOn ? (
          <span className={styles.name}>has parts</span>
        ) : (
          <select
            className={styles.select}
            value={node.type}
            aria-label={`Type of ${node.name}`}
            onChange={(e) => change((c) => ({...c, type: e.target.value as ColumnType}))}
          >
            {typeLabels.map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        )}
        {top && column.width !== undefined && (
          <label className={styles.check}>
            padded to
            <input
              type="number"
              min={1}
              className={styles.small}
              value={column.width}
              aria-label="Width it's padded to"
              onChange={(e) => change((c) => ({...c, width: Number(e.target.value) > 0 ? Number(e.target.value) : undefined}))}
            />
            characters
          </label>
        )}
      </div>
      <div className={styles.barRow}>
        {top && (
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={!!column.repeatOn}
              onChange={(e) =>
                setColumn(
                  selection.column,
                  withSubfields(
                    column,
                    values(selection.column),
                    e.target.checked ? layout.separators.repeat || '~' : undefined,
                    column.splitOn,
                    deeper,
                    layout.release,
                  ),
                )
              }
            />
            It's a list, its items split by
            <input
              className={styles.tiny}
              value={column.repeatOn ?? ''}
              maxLength={3}
              aria-label="What splits the list's items"
              onChange={(e) =>
                setColumn(
                  selection.column,
                  withSubfields(column, values(selection.column), e.target.value || undefined, column.splitOn, deeper, layout.release),
                )
              }
            />
          </label>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={!!node.splitOn}
            onChange={(e) =>
              change((c) =>
                withSubfields(
                  c,
                  nodeValues,
                  top ? c.repeatOn : undefined,
                  e.target.checked ? layout.separators.part || '^' : undefined,
                  top ? deeper : [],
                  layout.release,
                ),
              )
            }
          />
          It has parts, split by
          <input
            className={styles.tiny}
            value={node.splitOn ?? ''}
            maxLength={3}
            aria-label="What splits its parts"
            onChange={(e) =>
              change((c) => withSubfields(c, nodeValues, top ? c.repeatOn : undefined, e.target.value || undefined, top ? deeper : [], layout.release))
            }
          />
        </label>
        {inList && (
          <>
            <label className={styles.check}>
              <span className={styles.rowsBadge}>list</span>
              {g!.name}:
              <input
                type="number"
                min={1}
                className={styles.small}
                placeholder="all"
                value={g!.count ?? ''}
                aria-label="How many items the list has"
                onChange={(e) => onKind(kind.tag, {group: {...g!, count: Number(e.target.value) > 0 ? Number(e.target.value) : null}})}
              />
              <span className={styles.name}>{g!.count === null ? 'items, to the end of the line' : 'items in each line'}</span>
            </label>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                onKind(kind.tag, {group: undefined});
                onSelect(null);
              }}
            >
              Make {g!.name} not a list
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The names of a selected field, the list it's in, and the parts down to it, to find it in what's read. */
export function csvHighlight(selection: CsvSelection, kinds: Kind[]): string[] | null {
  if (!selection || (selection.last !== undefined && selection.last !== selection.column)) return null;
  const kind = kinds.find((k) => k.tag === selection.tag);
  const column = kind?.columns[selection.column];
  if (!kind || !column) return null;
  const names = [column.name, ...selection.path.map((_, d) => partAt(column, selection.path.slice(0, d + 1))?.name ?? '')];
  const g = kind.group;
  // The kind of line's own name comes first, so a field named alike in another kind isn't marked too.
  return [kind.name, ...(g && selection.column >= g.from && selection.column <= g.to ? [g.name, ...names] : names)];
}
