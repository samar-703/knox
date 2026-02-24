import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view"
import { StateField, StateEffect, Transaction } from "@codemirror/state"

// StateEffect: A way to send "messages" to update state.
const setSuggestionEffect = StateEffect.define<string | null>();


//StateField: holds our suggestion state in editor
// - create(): returns the initial value when editor loads
// - update(): called on every transaction (keystroke etc) to potentially update the value.
const suggestionState = StateField.define<string | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    // check each effect in this transaction
    // If we find our setsuggestionEffect return its new value
    // otherwise we keep the current value unchanged
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestionEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});


class SuggestionWidget extends WidgetType {
  constructor(readonly text:string) {
    super();
  }

  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.opacity = "0.4"; //ghost text appearance
    span.style.pointerEvents = "none"; // dont interfere with clicks
    return span;
  }
}

let debounceTimer: number | null = null;
let isWaitingForSuggestion = false;
const DEBOUNCE_DELAY = 300;

const generateFakeSuggestion = (textBeforeCursor: string): string | null => {
  const trimmed = textBeforeCursor.trimEnd();
  if (trimmed.endsWith("const")) return "myVariable = ";
  if (trimmed.endsWith("function")) return "myFunction() {\n \n} ";
  if (trimmed.endsWith("console.")) return "log()";
  if (trimmed.endsWith("return")) return "null";
  return null;
};

const createDebouncePlugin = (fileName: string) =>{
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.triggerSuggestion(view);
      }

      update(update:ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.triggerSuggestion(update.view);
        }
      }

      triggerSuggestion(view: EditorView ) {
        if(debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }

        isWaitingForSuggestion = true;
        debounceTimer = window.setTimeout(async () => {
          // fake suggestion (delete this block in stage 3)
          const cursor = view.state.selection.main.head;
          const line = view.state.doc.lineAt(cursor);
          const textBeforeCursor = line.text.slice(0, cursor-line.from);
          const suggestion = generateFakeSuggestion(textBeforeCursor);

          isWaitingForSuggestion = false;
          view.dispatch({
            effects: setSuggestionEffect.of(suggestion),
          });
        }, DEBOUNCE_DELAY)
      }

      destroy() {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
      }
    }
  )
}

const renderPlugin = ViewPlugin.fromClass (
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      // rebuild decoration if cursor is moved or suggestions changed
      const suggestionChanged = update.transactions.some((transaction) => {
        return transaction.effects.some((effect) => {
          return effect.is(setSuggestionEffect);
        });
      });

      const shouldRebuild = update.docChanged || update.selectionSet || suggestionChanged;
      if (shouldRebuild) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {

      if (isWaitingForSuggestion) {
        return Decoration.none;
      }

      // get current suggestion from state
      const suggestion = view.state.field(suggestionState);
      if (!suggestion) {
        return Decoration.none;
      }

      // widget decoration at cursor position
      const cursor = view.state.selection.main.head;
      return Decoration.set([
        Decoration.widget({
          widget: new SuggestionWidget(suggestion),
          side: 1, // render after cursor (side:1). not before (side: -1)
        }).range(cursor),
      ])
    }
  },
  {decorations: (plugin => plugin.decorations)} //tells codemirror to use our decorations
);

const acceptSuggestionKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const suggestion = view.state.field(suggestionState);
      if (!suggestion) {
        return false; // No suggestion? Let tab do its normal work
      }

      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: { from: cursor, insert: suggestion },
        selection: { anchor: cursor + suggestion.length},
        effects: setSuggestionEffect.of(null),
      });
      return true; // we handled tab, dont intend
    },
  },
]);

export const suggestion = (fileName: string) => [
  suggestionState, // our state storage
  createDebouncePlugin(fileName), // triggers suggestions on typping
  renderPlugin, // renders the ghost text
  acceptSuggestionKeymap, // Tab to accept
]