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
    return " // Todo: yet to implement ";
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

const renderPlugin = ViewPlugin.fromClass (
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      // rebuild decoration if cursor is moved or suggestions changed
      const suggestionChanged = update.transactions.some( (transaction) =>
        transaction.effects.some((effect) => effect.is
        (setSuggestionEffect))
      );
    }
  }
)

export const suggestion = (fileName: string) => [
  suggestionState, // our state storage
  renderPlugin, // renders the ghost text
]