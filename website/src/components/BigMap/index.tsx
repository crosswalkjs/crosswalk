import React, {useEffect, useRef, useState, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import type {Mapper} from '@crosswalkjs/canvas';
import {Segmented} from '../Controls';
import styles from './styles.module.css';

const sizes = [
  {value: '1', label: '1 order'},
  {value: '2', label: '2'},
  {value: '4', label: '4'},
  {value: '8', label: '8 orders'},
];

/**
 * The big order-to-ERP map in the real editor, with a readout of how it's
 * coping: the size of the map, frames per second, how long the lines take to
 * redraw and an edit takes to render, and how long the map takes to run.
 */
export default function BigMap(): ReactNode {
  return (
    <BrowserOnly fallback={<div className={styles.loading}>Loading the editor…</div>}>
      {() => <Demo />}
    </BrowserOnly>
  );
}

interface Readout {
  operators: number;
  lines: number;
  fields: number;
  fps: number;
  redraw: number;
  redrawWorst: number;
  render: number;
  run: number;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

function Demo() {
  const host = useRef<HTMLDivElement>(null);
  const mapper = useRef<Mapper | null>(null);
  const {colorMode} = useColorMode();
  const [copies, setCopies] = useState('1');
  const [readout, setReadout] = useState<Readout | null>(null);
  // Timings arrive far faster than they're worth showing, so they're kept here and shown four times a second.
  const timings = useRef({redraws: [] as number[], render: 0, run: 0, frames: [] as number[]});
  const counts = useRef({operators: 0, lines: 0, fields: 0});

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [core, canvas, big] = await Promise.all([import('@crosswalkjs/core'), import('@crosswalkjs/canvas'), import('../../examples/bigmap')]);
      if (disposed || !host.current) return;
      // The site's own look is ink and paper, so its editors match it, light or dark with the site.
      const ink = canvas.resolveTheme('ink');
      canvas.registerTheme({id: 'docs-light', label: 'Ink (light)', extends: 'ink', scheme: 'light'});
      canvas.registerTheme({id: 'docs-dark', label: 'Ink (dark)', extends: 'ink', scheme: 'dark', colors: ink.darkColors});

      const n = Number(copies);
      const map = big.buildMap(n);
      const input = big.buildInput(n);
      const registry = core.createRegistry();
      const run = (document: typeof map) => {
        try {
          const transform = core.createTransform(document, {registry});
          const started = performance.now();
          transform(input);
          timings.current.run = performance.now() - started;
        } catch {
          timings.current.run = NaN;
        }
      };
      const count = (document: typeof map) => {
        const fields = core.listFields(document.source).length + core.listFields(document.target).length;
        counts.current = {operators: document.nodes.length, lines: document.links.length + (document.loops?.length ?? 0), fields};
      };
      count(map);
      run(map);
      timings.current.redraws = [];

      mapper.current?.destroy();
      mapper.current = canvas.createMapper(host.current, {
        document: map,
        registry,
        theme: colorMode === 'dark' ? 'docs-dark' : 'docs-light',
        toolboxCollapsed: true,
        zoom: 0.8,
        onChange: (next) => {
          count(next);
          run(next);
        },
        onPerformance: ({kind, ms}) => {
          if (kind === 'render') timings.current.render = ms;
          else timings.current.redraws = [...timings.current.redraws.slice(-59), ms];
        },
      });
    })();
    return () => {
      disposed = true;
    };
    // The theme is applied in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copies]);

  useEffect(() => () => mapper.current?.destroy(), []);

  useEffect(() => {
    mapper.current?.setTheme(colorMode === 'dark' ? 'docs-dark' : 'docs-light');
  }, [colorMode]);

  // Counts frames over the last second, and refreshes the readout.
  useEffect(() => {
    let frame = 0;
    const tick = (time: number) => {
      const frames = timings.current.frames;
      frames.push(time);
      while (frames.length > 0 && frames[0]! < time - 1000) frames.shift();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const show = setInterval(() => {
      const {redraws, render, run, frames} = timings.current;
      setReadout({
        ...counts.current,
        fps: frames.length,
        redraw: median(redraws.slice(-20)),
        redrawWorst: Math.max(0, ...redraws.slice(-20)),
        render,
        run,
      });
    }, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(show);
    };
  }, []);

  const ms = (value: number | undefined) => (value === undefined || Number.isNaN(value) ? '–' : value < 10 ? value.toFixed(1) : Math.round(value).toString());

  return (
    <div className={styles.frame}>
      <div className={styles.bar}>
        <Segmented label="Orders in the map" options={sizes} value={copies} onChange={setCopies} />
        <span className={styles.hint}>Drag an operator, hover a field, zoom out, or switch pages, and watch the numbers.</span>
      </div>
      <div ref={host} className={styles.editor} />
      <dl className={styles.readout} aria-live="off">
        <div>
          <dt>Operators</dt>
          <dd>{readout?.operators.toLocaleString() ?? '–'}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{readout?.lines.toLocaleString() ?? '–'}</dd>
        </div>
        <div>
          <dt>Fields</dt>
          <dd>{readout?.fields.toLocaleString() ?? '–'}</dd>
        </div>
        <div>
          <dt>Frames a second</dt>
          <dd>{readout?.fps ?? '–'}</dd>
        </div>
        <div title="The middle of the last 20 redraws, and the slowest of them">
          <dt>Redraw</dt>
          <dd>
            {ms(readout?.redraw)} ms <span className={styles.aside}>worst {ms(readout?.redrawWorst)}</span>
          </dd>
        </div>
        <div title="Rebuilding the editor after the last edit, including the browser laying it out">
          <dt>Last edit</dt>
          <dd>{ms(readout?.render)} ms</dd>
        </div>
        <div title="Running the map on the sample order, as a server would">
          <dt>Running the map</dt>
          <dd>{ms(readout?.run)} ms</dd>
        </div>
      </dl>
    </div>
  );
}
