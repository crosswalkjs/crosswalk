import React, {useMemo, useState, type ReactNode} from 'react';
import CodeBlock from '@theme/CodeBlock';
import {readFlatFile, writeFlatFile, type JsonValue} from '@crosswalkjs/core';
import {delimiters, descendants, guessKinds, guessLayout, toSchema, type Kind, type Layout} from './infer';
import {ActionBar, FixedLines, JsonView, type Selection} from './Workbench';
import {CsvBar, CsvLines, csvHighlight, type CsvSelection} from './CsvWork';
import {fieldsAt} from './fields';
import styles from './styles.module.css';

const samples: {label: string; text: string}[] = [
  {
    label: 'Bank file, fixed-width',
    text: [
      'FH20260302ACMEPAY   ',
      'BH0001PAYROLL   ',
      'ENANA SMITH       0000125000MARCH SALARY',
      'ENBENJAMIN JONES  0000008950EXPENSES    ',
      'BT0002000000133950',
      'BH0002SUPPLIERS ',
      'ENTEA & CO        0000001225INV 2231    ',
      'BT0001000000001225',
      'FT00020003000000135175',
      '',
    ].join('\n'),
  },
  {
    label: 'Statement, CSV with tags',
    text: 'H|2026-03-02|ACC-1\nD|P-1|100.5|Rent\nD|P-2|50|\nT|2|150.5\n',
  },
  {
    label: 'HL7 message',
    text: [
      'MSH|^~\\&|LAB|HOSP|20260302120000|ORU^R01|MSG001|P|2.5',
      'PID|1||123^^^HOSP&1.2.3&ISO~456^^^LAB||SMITH^JOHN^Q||19800101|M',
      'OBX|1|NM|GLU^Glucose||5.4|mmol/L',
      'OBX|2|NM|HB^Haemoglobin||13.9|g/dL',
      '',
    ].join('\n'),
  },
  {
    label: 'X12 purchase order',
    text: [
      'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260302*1200*^*00501*000000001*0*P*:~',
      'GS*PO*SENDER*RECEIVER*20260302*1200*1*X*005010~',
      'ST*850*0001~',
      'BEG*00*SA*PO-1001**20260302~',
      'PO1*1*10*EA*9.95**VP*A100~',
      'PO1*2*5*EA*19.50**VP*B200~',
      'CTT*2~',
      'SE*6*0001~',
      'GE*1*1~',
      'IEA*1*000000001~',
      '',
    ].join('\n'),
  },
  {
    label: 'EDIFACT order',
    text: [
      "UNB+UNOA:2+SENDER+RECEIVER+260302:1200+1'",
      "UNH+1+ORDERS:D:96A:UN'",
      "BGM+220+PO-1001+9'",
      "NAD+BY+5412345000013::9++ACME?+CO'",
      "LIN+1++A100:SA'",
      "QTY+21:10'",
      "LIN+2++B200:SA'",
      "QTY+21:5'",
      "UNS+S'",
      "UNT+9+1'",
      "UNZ+1+1'",
      '',
    ].join('\n'),
  },
  {
    label: 'Orders, fixed-width with repeating lines',
    text: 'ORD001A100003B200001C300010\nORD002A100001\nORD003D400002E500005\n',
  },
  {
    label: 'Orders with items and sizes, nested twice',
    text: 'ORD001A100003SMB200001L \nORD002A100001S \nORD003D400002MLE500005XS\n',
  },
  {
    label: 'Payments, CSV with a header',
    text: 'Payment ID,Date,Amount,Sort code\nP-1,2026-03-02,100.5,040004\nP-2,2026-03-03,50,040004\n',
  },
];

const delimiterLabels: Record<string, string> = {
  ',': 'Comma',
  '|': 'Bar',
  ';': 'Semicolon',
  '\t': 'Tab',
  '*': 'Star',
  '+': 'Plus',
};
type Base = Omit<Layout, 'kinds'>;

/**
 * A schema for a flat file, built from a sample, on one page: the sample, its lines to select and name, the fields
 * that makes, and what the schema reads, all updating together. Everything is worked out in the page; nothing is
 * sent anywhere.
 */
export default function FlatFileWizard({example}: {example?: Example}): ReactNode {
  const start = (example ? samples.find((s) => s.label === examples[example]) : undefined) ?? samples[0]!;
  const [text, setText] = useState(start.text);
  const [base, setBase] = useState<Base>(() => guessLayout(start.text));
  const [kinds, setKinds] = useState<Kind[]>(() => guessKinds(start.text, guessLayout(start.text)));
  const [current, setCurrent] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [csvSelection, setCsvSelection] = useState<CsvSelection>(null);

  const changeText = (next: string) => {
    const guessed = guessLayout(next);
    setText(next);
    setBase(guessed);
    setKinds(guessKinds(next, guessed));
    setSelection(null);
    setCsvSelection(null);
  };
  const changeBase = (patch: Partial<Base>) => {
    const next = {...base, ...patch};
    setBase(next);
    setKinds(guessKinds(text, next));
    setSelection(null);
    setCsvSelection(null);
  };
  const changeKind = (tag: string, patch: Partial<Kind>) => setKinds((all) => all.map((k) => (k.tag === tag ? {...k, ...patch} : k)));

  const layout: Layout = {...base, kinds};
  const tag = selection?.tag ?? current;
  const kind = kinds.find((k) => k.tag === tag) ?? kinds[0];
  const fixed = base.format === 'fixed';
  const pick = (tag: string) => {
    setCurrent(tag);
    setSelection(null);
    setCsvSelection(null);
  };
  const selectCsv = (next: CsvSelection) => {
    setCsvSelection(next);
    if (next) setCurrent(next.tag);
  };
  const select = (next: Selection) => {
    setSelection(next);
    if (next) setCurrent(next.tag);
  };

  return (
    <div className={styles.frame}>
      <details className={styles.sampleSection}>
        <summary className={styles.sectionTitle}>
          {example ? 'Sample' : 'Sample and format'} <span className={styles.summaryNote}>{summary(text, base)}</span>
        </summary>
        {example ? (
          <OwnSample text={text} example={start.text} onText={changeText} />
        ) : (
          <SampleStep text={text} base={base} onText={changeText} onBase={changeBase} />
        )}
      </details>
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>Lines</div>
        {base.tagged && kind && <KindBar layout={layout} kind={kind} onKind={changeKind} />}
        {fixed ? (
          <>
            <FixedLines text={text} layout={layout} selection={selection} onSelect={select} current={kind?.tag} onPick={pick} onKind={changeKind} />
            <ActionBar text={text} layout={layout} selection={selection} onSelect={select} onFields={(t, fields) => changeKind(t, {fields})} />
            <ResultPanel text={text} layout={layout} highlight={highlightOf(selection, kinds)} />
          </>
        ) : (
          <>
            <CsvLines text={text} layout={layout} selection={csvSelection} onSelect={selectCsv} current={kind?.tag} onPick={pick} onKind={changeKind} />
            <CsvBar text={text} layout={layout} selection={csvSelection} onSelect={selectCsv} onKind={changeKind} />
            <ResultPanel text={text} layout={layout} highlight={csvHighlight(csvSelection, kinds)} />
          </>
        )}
      </div>
    </div>
  );
}

/** A sample in a few words, for when it's folded away. */
const summary = (text: string, base: Base) => {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
  const first = lines[0] ?? '';
  return `${lines.length} lines, ${base.format === 'fixed' ? 'fixed-width' : 'CSV'}: ${first.length > 32 ? `${first.slice(0, 32)}…` : first}`;
};

/** The names of a selected field and the lists it's in, to find it in what's read. */
function highlightOf(selection: Selection, kinds: Kind[]): string[] | null {
  if (!selection || !('path' in selection)) return null;
  const kind = kinds.find((k) => k.tag === selection.tag);
  if (!kind?.fields) return null;
  const names: string[] = [];
  let walk = kind.fields;
  for (const i of selection.path) {
    const rows = walk[i];
    if (!rows || !('fields' in rows)) return null;
    names.push(rows.name);
    walk = rows.fields;
  }
  const field = fieldsAt(kind.fields, selection.path)[selection.index];
  // The kind of line's own name comes first, so a field named alike in another kind isn't marked too.
  return field ? [kind.name, ...names, field.name] : null;
}

/** The kind of line being worked on: which it is, its name, whether there's one or many, and what it's inside. */
function KindBar({layout, kind, onKind}: {layout: Layout; kind: Kind; onKind: (tag: string, patch: Partial<Kind>) => void}) {
  const blocked = descendants(layout.kinds, kind.tag);
  return (
    <div className={styles.kindSettings}>
      <span>
        <code>{kind.tag}</code> lines are called
      </span>
      <input className={styles.input} value={kind.name} aria-label={`Name for ${kind.tag} lines`} onChange={(e) => onKind(kind.tag, {name: e.target.value})} />
      <label className={styles.check}>
        and go inside
        <select className={styles.select} value={kind.parent ?? ''} onChange={(e) => onKind(kind.tag, {parent: e.target.value || null})}>
          <option value="">the file</option>
          {layout.kinds
            .filter((k) => k.tag !== kind.tag && !blocked.has(k.tag))
            .map((k) => (
              <option key={k.tag} value={k.tag}>
                {k.name || k.tag}
              </option>
            ))}
        </select>
      </label>
      <span className={styles.name}>Click a tag on the left to work on other lines.</span>
    </div>
  );
}

/** The example one format's page starts from, by the format's name. */
const examples = {
  csv: 'Payments, CSV with a header',
  fixed: 'Orders with items and sizes, nested twice',
  'fixed-kinds': 'Bank file, fixed-width',
  hl7: 'HL7 message',
  x12: 'X12 purchase order',
  edifact: 'EDIFACT order',
} as const;
export type Example = keyof typeof examples;

/** On a format's own page: its example, to replace with a sample of your own; the layout is worked out from it. */
function OwnSample({text, example, onText}: {text: string; example: string; onText: (text: string) => void}) {
  return (
    <>
      <p className={styles.hint}>
        Paste a few lines of your own file to make a schema for it; the layout is worked out from what you paste.{' '}
        {text !== example && (
          <button type="button" className={styles.link} onClick={() => onText(example)}>
            Back to the example
          </button>
        )}
      </p>
      <textarea
        className={styles.sample}
        value={text}
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
        aria-label="Sample"
        rows={Math.min(10, Math.max(4, text.split('\n').length + 1))}
      />
    </>
  );
}

function SampleStep({text, base, onText, onBase}: {text: string; base: Base; onText: (text: string) => void; onBase: (patch: Partial<Base>) => void}) {
  return (
    <>
      <p className={styles.hint}>
        Paste a few lines of the file, enough to have every kind of line, and a batch or group twice over if it has them. Or start from{' '}
        {samples.map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && (i === samples.length - 1 ? ' or ' : ', ')}
            <button type="button" className={styles.link} onClick={() => onText(s.text)}>
              {s.label.toLowerCase()}
            </button>
          </React.Fragment>
        ))}
        .
      </p>
      <textarea
        className={styles.sample}
        value={text}
        spellCheck={false}
        onChange={(e) => onText(e.target.value)}
        aria-label="Sample"
        rows={Math.min(10, Math.max(4, text.split('\n').length + 1))}
      />
      <div className={styles.settings}>
        <Choice
          label="Format"
          value={base.format}
          options={[
            ['csv', 'CSV'],
            ['fixed', 'Fixed-width'],
          ]}
          onChange={(format) => onBase({format})}
        />
        {base.format === 'csv' && (
          <Choice
            label="Delimiter"
            value={base.delimiter}
            options={delimiters.map((d) => [d, delimiterLabels[d]!])}
            onChange={(delimiter) => onBase({delimiter})}
          />
        )}
        <label className={styles.check}>
          <input type="checkbox" checked={base.tagged} onChange={(e) => onBase({tagged: e.target.checked})} />
          Lines start with a tag saying what kind they are
        </label>
        {base.tagged && base.format === 'fixed' && (
          <label className={styles.check}>
            Tag length
            <input
              type="number"
              min={1}
              max={8}
              className={styles.small}
              value={base.tagLength}
              onChange={(e) => onBase({tagLength: Math.max(1, Number(e.target.value) || 1)})}
            />
          </label>
        )}
        {!base.tagged && base.format === 'csv' && (
          <label className={styles.check}>
            <input type="checkbox" checked={base.header} onChange={(e) => onBase({header: e.target.checked})} />
            The first line names the columns
          </label>
        )}
        <label className={styles.check}>
          Lines end with
          <input
            className={styles.tiny}
            value={base.terminator ?? ''}
            maxLength={3}
            placeholder="↵"
            aria-label="What ends each line, where it isn't a line break"
            onChange={(e) => onBase({terminator: e.target.value || undefined})}
          />
        </label>
        {base.format === 'csv' && (
          <label className={styles.check}>
            Release character
            <input
              className={styles.tiny}
              value={base.release ?? ''}
              maxLength={1}
              aria-label="The character that makes the one after it plain text"
              onChange={(e) => onBase({release: e.target.value || undefined})}
            />
          </label>
        )}
      </div>
    </>
  );
}

function Choice<T extends string>({label, value, options, onChange}: {label: string; value: T; options: [T, string][]; onChange: (value: T) => void}) {
  return (
    <div className={styles.choiceRow}>
      <span className={styles.name}>{label}</span>
      <div className={styles.steps} role="radiogroup" aria-label={label}>
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            className={option === value ? styles.chosen : styles.option}
            onClick={() => onChange(option)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the schema reads from the sample, or the schema itself, and whether it writes the sample back as it was. */
function ResultPanel({text, layout, highlight}: {text: string; layout: Layout; highlight: string[] | null}) {
  const [show, setShow] = useState<'read' | 'schema'>('read');
  const schema = useMemo(() => toSchema(layout), [layout]);
  let read: JsonValue | undefined;
  let problem: string | undefined;
  let differs: number | undefined;
  try {
    read = readFlatFile(text, schema);
    const tidy = (t: string) =>
      t
        .split(/\r\n|\r|\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);
    const before = tidy(text);
    const after = tidy(writeFlatFile(read, schema));
    const at = before.findIndex((line, i) => line !== after[i]);
    if (at !== -1 || after.length !== before.length) differs = (at === -1 ? before.length : at) + 1;
  } catch (error) {
    problem = (error as Error).message;
  }
  return (
    <div className={styles.code}>
      <div className={styles.resultHead}>
        <div className={styles.steps} role="tablist" aria-label="Result">
          <button
            type="button"
            role="tab"
            aria-selected={show === 'read'}
            className={show === 'read' ? styles.chosen : styles.option}
            onClick={() => setShow('read')}
          >
            What it reads
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={show === 'schema'}
            className={show === 'schema' ? styles.chosen : styles.option}
            onClick={() => setShow('schema')}
          >
            Schema
          </button>
        </div>
        <span className={problem ? styles.problem : styles.name}>
          {problem
            ? `It doesn't read the sample: ${problem}.${/isn't a kind of line/.test(problem) ? ' If that kind of line can come more than once, make it a list.' : ''}`
            : differs === undefined
              ? 'Writes the sample back as it was.'
              : `Writes line ${differs} back differently.`}
        </span>
      </div>
      {show === 'schema' ? (
        <CodeBlock language="json">{JSON.stringify(schema, null, 2)}</CodeBlock>
      ) : problem ? null : (
        <JsonView value={read} highlight={highlight} />
      )}
    </div>
  );
}
