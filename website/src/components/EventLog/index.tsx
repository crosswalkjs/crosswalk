import React, {useRef, useState, type ReactNode} from 'react';
import type {MapDocument} from '@crosswalkjs/core';
import type {MapperOptions} from '@crosswalkjs/canvas';
import styles from './styles.module.css';

/** Every hook the editor calls, with what a host might do in it, for the code samples. */
export const hooks = [
  {key: 'onChange', args: 'map', body: 'save(map);'},
  {key: 'onSelectionChange', args: 'selection', body: 'showPanel(selection);'},
  {key: 'onPageChange', args: 'page, submap', body: 'remember(page);'},
  {key: 'onIssuesChange', args: 'issues', body: 'listProblems(issues);'},
  {key: 'onToolboxToggle', args: 'collapsed, automatic', body: '{ if (!automatic) remember(collapsed); }'},
  {key: 'onPerformance', args: '{ kind, ms }', body: 'record(kind, ms);'},
] as const;

export type HookName = (typeof hooks)[number]['key'];

/** The hooks listened to at first. Timings come so often they'd drown the rest, so they start off. */
export const listenedAtFirst: Record<HookName, boolean> = {
  onChange: true,
  onSelectionChange: true,
  onPageChange: true,
  onIssuesChange: true,
  onToolboxToggle: true,
  onPerformance: false,
};

/** The hooks that are on, as lines of a `createMapper` call. */
export function hookLines(listening: Record<HookName, boolean>): string[] {
  return hooks
    .filter((hook) => listening[hook.key])
    .map((hook) => `  ${hook.key}: (${hook.args}) => ${hook.body.startsWith('{') ? hook.body : hook.body.replace(/;$/, '')},`);
}

interface Entry {
  id: number;
  name: string;
  /** A method's result, rather than an event. */
  call: boolean;
  detail: string;
  count: number;
}

/** A short, readable account of what a hook was given or a method returned. */
function summarise(name: string, value: unknown): string {
  if (name === 'onChange' || name === 'getDocument()') {
    const document = value as MapDocument;
    return `a map: ${document.nodes.length} operators, ${document.links.length} links`;
  }
  if (name === 'onIssuesChange' || name === 'getIssues()') {
    const issues = value as {code: string}[];
    return issues.length === 0 ? '[] (no issues)' : `${issues.length}: ${issues.map((issue) => issue.code).join(', ')}`;
  }
  if (name === 'onPerformance') {
    const timing = value as {kind: string; ms: number};
    return `{ kind: "${timing.kind}", ms: ${timing.ms.toFixed(1)} }`;
  }
  if (value === undefined) return 'undefined';
  return JSON.stringify(value);
}

/**
 * A log of what the editor said, and which hooks are listened to. `handlers`
 * are the hooks to give `createMapper`; they read what's switched on as it is
 * now, so they needn't be given again when it changes.
 */
export function useEventLog() {
  const [listening, setListening] = useState(listenedAtFirst);
  const listeningNow = useRef(listening);
  listeningNow.current = listening;
  const [log, setLog] = useState<Entry[]>([]);
  const next = useRef(0);

  const add = (name: string, value: unknown, call = false) =>
    setLog((current) => {
      const detail = summarise(name, value);
      // The same thing again, straight after, is counted rather than listed again.
      if (current[0]?.name === name && current[0].detail === detail) return [{...current[0], count: current[0].count + 1}, ...current.slice(1)];
      return [{id: next.current++, name, call, detail, count: 1}, ...current].slice(0, 60);
    });
  const heard = (name: HookName) => (value: unknown) => listeningNow.current[name] && add(name, value);

  const handlers = {
    onChange: heard('onChange'),
    onSelectionChange: heard('onSelectionChange'),
    onPageChange: (page, submap) => heard('onPageChange')(submap === undefined ? {page} : {page, submap}),
    onIssuesChange: heard('onIssuesChange'),
    onToolboxToggle: (collapsed, automatic) => heard('onToolboxToggle')({collapsed, automatic}),
    onPerformance: heard('onPerformance'),
  } satisfies Partial<MapperOptions>;

  const flip = (key: string) => setListening((current) => ({...current, [key]: !current[key as HookName]}));
  return {listening, flip, log, add, clear: () => setLog([]), handlers};
}

/** The log, newest first. `fill` lets it take the height it's given, rather than a fixed one. */
export function EventLog({log, onClear, fill = false}: {log: Entry[]; onClear: () => void; fill?: boolean}): ReactNode {
  return (
    <div className={fill ? styles.fill : undefined}>
      <div className={styles.logHead}>
        <span>What the editor said</span>
        <button type="button" className={styles.clear} onClick={onClear}>
          Clear
        </button>
      </div>
      <ol className={`${styles.log} ${fill ? styles.logFill : ''}`} aria-live="polite">
        {log.length === 0 && <li className={styles.empty}>Select an operator, switch pages, move a line or fold the toolbox. Events show up here, newest first.</li>}
        {log.map((entry) => (
          <li key={entry.id} className={styles.entry}>
            <code className={entry.call ? styles.callName : styles.eventName}>{entry.name}</code>
            <span className={styles.detail}>{entry.detail}</span>
            {entry.count > 1 && <span className={styles.count}>×{entry.count}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
