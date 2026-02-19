import { useEffect, useMemo, useRef } from "react"
import { keymap, EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

import { customTheme } from "../extensions/theme";
import { getLanguageExtension } from "../extensions/language-extension";
import { minimap } from "../extensions/minimap";
import { customSetup } from "../extensions/custom-setup";


interface Props {
  fileName: string;
}

export const CodeEditor = ({fileName}: Props) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const languageExtension = useMemo(() => { return getLanguageExtension(fileName)}, [fileName])

  useEffect(() => {
    if (!editorRef.current) return;

    const view = new EditorView({
      doc: `const Counter = () => {
        const [value, setValue] = useState(0);

        const onIncrease = setValue((value) => value + 1);
        const onDecrease = setValue((value) => value - 1);

        return (
          <div>
            <button onClick={onIncrease}>{value}</button>
          </div>
        );
      }`,
      parent: editorRef.current,
      extensions: [
        oneDark,
        customTheme,
        customSetup,
        languageExtension,
        keymap.of([indentWithTab]),
        minimap(),
        indentationMarkers(),
      ],
    });

    viewRef.current = view;

    return () => {
      view.destroy();
    };
  }, [])

  return (
    <div  ref={editorRef} className="size-full pl-4 bg-background" />
  )
}