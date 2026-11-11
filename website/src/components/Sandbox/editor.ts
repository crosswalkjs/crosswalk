import {basicSetup} from 'codemirror';
import {EditorState, type Extension} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {json} from '@codemirror/lang-json';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';

// Colours are CSS variables, set for light and dark in styles.module.css, so
// switching the site's theme needs nothing from here.
const highlight = HighlightStyle.define([
  {tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.operatorKeyword], color: 'var(--sb-keyword)', fontWeight: '700'},
  {tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--sb-string)'},
  {tag: [tags.number, tags.bool, tags.null], color: 'var(--sb-number)'},
  {tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--sb-comment)', fontStyle: 'italic'},
  {tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--sb-function)'},
  {tag: [tags.propertyName, tags.attributeName], color: 'var(--sb-property)'},
  {tag: [tags.typeName, tags.className, tags.tagName], color: 'var(--sb-type)'},
  {tag: [tags.definition(tags.variableName)], color: 'var(--sb-definition)'},
  {tag: [tags.punctuation, tags.bracket, tags.operator], color: 'var(--sb-punctuation)'},
]);

const look = EditorView.theme({
  '&': {maxHeight: '320px', fontSize: '13px', backgroundColor: 'var(--sb-background)', color: 'var(--sb-text)'},
  '.cm-scroller': {overflow: 'auto', fontFamily: 'var(--ifm-font-family-monospace)', lineHeight: '1.55'},
  '.cm-content': {caretColor: 'var(--sb-text)'},
  '.cm-gutters': {backgroundColor: 'var(--sb-background)', color: 'var(--sb-gutter)', border: 'none'},
  '.cm-activeLine, .cm-activeLineGutter': {backgroundColor: 'var(--sb-active-line)'},
  '&.cm-focused': {outline: 'none'},
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {backgroundColor: 'var(--sb-selection) !important'},
  '.cm-cursor': {borderLeftColor: 'var(--sb-text)'},
});

const languageFor = (name: string): Extension => (name.endsWith('.html') ? html() : name.endsWith('.json') ? json() : javascript());

/** One editor showing one file at a time, keeping each file's own undo history. */
export class FileEditor {
  readonly #view: EditorView;
  #states = new Map<string, EditorState>();
  #active: string;

  constructor(
    parent: HTMLElement,
    files: Record<string, string>,
    active: string,
    private readonly onChange: (name: string, text: string) => void,
  ) {
    this.#active = active;
    this.#makeStates(files);
    this.#view = new EditorView({parent, state: this.#states.get(active)!});
  }

  #makeStates(files: Record<string, string>) {
    this.#states = new Map(
      Object.entries(files).map(([name, text]) => [
        name,
        EditorState.create({
          doc: text,
          extensions: [
            basicSetup,
            languageFor(name),
            syntaxHighlighting(highlight),
            look,
            EditorView.updateListener.of((update) => {
              if (update.docChanged) this.onChange(name, update.state.doc.toString());
            }),
          ],
        }),
      ]),
    );
  }

  show(name: string) {
    this.#states.set(this.#active, this.#view.state);
    this.#active = name;
    this.#view.setState(this.#states.get(name)!);
  }

  reset(files: Record<string, string>) {
    this.#makeStates(files);
    this.#view.setState(this.#states.get(this.#active)!);
  }

  destroy() {
    this.#view.destroy();
  }
}
