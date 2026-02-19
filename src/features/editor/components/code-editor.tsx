import { useEffect, useRef } from "react"
import { basicSetup,EditorView } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

import { customTheme } from "../extensions/theme";

export const CodeEditor = () => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

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
        basicSetup,
        javascript({typescript:true}),
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