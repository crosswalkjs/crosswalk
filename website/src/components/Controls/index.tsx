import React, {type ReactNode} from 'react';
import styles from './styles.module.css';

// The controls the docs' live examples share: a theme dropdown, two-way
// switches, and on/off pills.

/** A theme a reader can pick. */
export interface ThemeChoice {
  id: string;
  label: string;
  group: string;
}

/** The value that means "follow the site's light or dark mode". */
export const SITE = '';

/** Every theme a reader can pick, from the loaded canvas package, skipping the docs' own. */
export function themesFrom(canvas: typeof import('@crosswalkjs/canvas')): ThemeChoice[] {
  return canvas
    .listThemes()
    .filter((theme) => !theme.id.startsWith('docs-'))
    .map((theme) => ({id: theme.id, label: theme.label, group: theme.group ?? 'Themes'}));
}

/** A dropdown of themes, grouped. The first choice follows the site's light or dark mode. */
export function ThemePicker({themes, value, onChange}: {themes: ThemeChoice[]; value: string; onChange: (id: string) => void}): ReactNode {
  const groups = [...new Set(themes.map((theme) => theme.group))];
  return (
    <select className={styles.select} value={value} onChange={(event) => onChange(event.target.value)} aria-label="Theme">
      <option value={SITE}>Match the site</option>
      {groups.map((group) => (
        <optgroup key={group} label={group}>
          {themes
            .filter((theme) => theme.group === group)
            .map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Every theme as a button, a row to each group, for a page about themes where one click should switch. */
export function ThemeSwitcher({themes, value, onChange}: {themes: ThemeChoice[]; value: string; onChange: (id: string) => void}): ReactNode {
  const groups = [...new Set(themes.map((theme) => theme.group))];
  const choice = (id: string, label: string) => (
    <button key={id || 'site'} type="button" role="radio" aria-checked={id === value} className={id === value ? styles.segmentChosen : styles.segment} onClick={() => onChange(id)}>
      {label}
    </button>
  );
  return (
    <div className={styles.themeSwitcher} role="radiogroup" aria-label="Theme">
      {groups.map((group, index) => (
        <div key={group} className={styles.themeGroup}>
          <span className={styles.themeGroupLabel}>{group}</span>
          <div className={styles.themeChoices}>
            {/* The site's own light or dark, first among Crosswalk's own. */}
            {index === 0 && choice(SITE, 'Match the site')}
            {themes.filter((theme) => theme.group === group).map((theme) => choice(theme.id, theme.label))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two or three choices side by side, one chosen. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: {value: T; label: string}[];
  value: T;
  onChange: (value: T) => void;
}): ReactNode {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? styles.segmentChosen : styles.segment}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Toggle {
  key: string;
  label: string;
  on: boolean;
  /** Why it can't be changed right now, shown when it's disabled. */
  unavailable?: string;
}

/** On/off pills. A note underneath explains any that can't be changed. */
export function Toggles({items, onToggle}: {items: Toggle[]; onToggle: (key: string) => void}): ReactNode {
  const reasons = [...new Set(items.flatMap((item) => (item.unavailable ? [item.unavailable] : [])))];
  return (
    <div>
      <div className={styles.toggles}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="switch"
            aria-checked={item.on && !item.unavailable}
            disabled={item.unavailable !== undefined}
            className={item.on && !item.unavailable ? styles.toggleOn : styles.toggle}
            onClick={() => onToggle(item.key)}>
            <span className={styles.knob} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>
      {reasons.map((reason) => (
        <p key={reason} className={styles.reason}>
          {reason}
        </p>
      ))}
    </div>
  );
}

/** The panel the controls sit in, one labelled row each. `flat` drops its own box, for inside another. */
export function Panel({rows, flat = false}: {rows: {label: string; content: ReactNode}[]; flat?: boolean}): ReactNode {
  return (
    <div className={flat ? styles.panelFlat : styles.panel}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <div className={styles.rowLabel}>{row.label}</div>
          <div className={styles.rowContent}>{row.content}</div>
        </div>
      ))}
    </div>
  );
}
