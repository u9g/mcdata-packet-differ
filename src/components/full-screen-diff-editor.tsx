"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useEffect, useState, useRef, useReducer } from "react";
import { DiffEditor, DiffEditorProps, useMonaco } from "@monaco-editor/react";

import prettier from "prettier/standalone";
import * as prettierPluginTypescript from "prettier/plugins/typescript";
import * as prettierPluginEstree from "prettier/plugins/estree";

// Function to move the cursor and scroll to a specific position
function goToPosition(
  offset: [number, number, number, number],
  editor: ReturnType<
    NonNullable<ReturnType<typeof useMonaco>>["editor"]["create"]
  >
) {
  // Move the cursor to the specified position
  editor.setPosition({ lineNumber: offset[0] + 1, column: offset[1] + 1 });

  // Scroll the editor to reveal the specified position
  editor.revealPositionInCenter({
    lineNumber: offset[0] + 1,
    column: offset[1] + 1,
  });
}

type X = [string, [number, number, number, number]][];

import * as wasm from "pkg";

async function callWasm(): Promise<
  | {
      json2ts: typeof wasm.json2ts;
      ts2locs: typeof wasm.ts2locs;
    }
  | undefined
> {
  try {
    await wasm.default({
      initial: 512, // Allocate 512 pages (32MB) of memory
      maximum: 1024, // Allow growth up to 1024 pages (64MB)
    });

    try {
      return wasm;
    } catch (e) {
      console.error("Error processing JSON:", e);
    }
  } catch (e) {
    console.error("Error initializing WASM:", e);
  }
}

async function generateData(version: string): Promise<{
  ts: string;
  locs: X;
}> {
  const response = await fetch(
    `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/refs/heads/master/data/pc/${version}/protocol.json`
  );
  const data = await response.json();

  const _wasm = await callWasm();
  if (!_wasm) throw new Error("Failed to initialize WASM");

  const { json2ts, ts2locs } = _wasm;

  const unformatted = await json2ts(JSON.stringify(data));

  const ts = await prettier.format(unformatted, {
    parser: "typescript",
    plugins: [prettierPluginTypescript, prettierPluginEstree],
  });

  const locs = await ts2locs(ts);

  return { ts, locs: JSON.parse(locs) };
}

const EMPTY = { ts: "", locs: [] };

function reducer(
  state: Record<string, { ts: string; locs: X } | null> | null,
  action:
    | { type: "set_versions"; versions: string[] }
    | { type: "set"; version: string; data: { ts: string; locs: X } }
    | { type: "fetching"; version: string }
) {
  if (action.type === "set") {
    return { ...state, [action.version]: action.data };
  } else if (action.type === "set_versions") {
    return Object.fromEntries(
      action.versions.map((version) => {
        return [version, null];
      })
    );
  } else if (action.type === "fetching") {
    return { ...state, [action.version]: EMPTY };
  }
  return state;
}

export function FullScreenDiffEditor() {
  // const [data, setData] = useState<Record<
  //   string,
  //   { ts: string; locs: X }
  // > | null>(null);

  const [data, dispatch] = useReducer(reducer, null);

  useEffect(() => {
    fetch(
      "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/refs/heads/master/data/dataPaths.json"
    )
      .then((x) => x.json())
      .then((x) => {
        return [
          ...new Set(
            Object.entries(x["pc"] as Record<string, any>)
              .map((x) => x[1].protocol)
              .filter((x: string | undefined): x is string => x !== undefined)
              .map((x: string) => x.split("/")[1])
          ),
        ];
      })
      .then((versions) => {
        dispatch({ type: "set_versions", versions });
      });
  }, []);
  const [modifiedSelected /*, setModifiedSelected*/] =
    useState<string>("1.21.1");

  const [selectedButton, setSelectedButton] = useState<string>("1.8");
  const [selectedHighlight, setSelectedHighlight] = useState<string>("none");
  const diffEditorRef =
    useRef<
      ReturnType<NonNullable<typeof monaco>["editor"]["createDiffEditor"]>
    >(null);
  const originalDecorationsRef = useRef<any>(null);
  const modifiedDecorationsRef = useRef<any>(null);
  const monaco = useMonaco();

  const handleButtonClick = (button: string) => {
    setSelectedButton(button);
  };

  const handleHighlightChange = (value: string) => {
    setSelectedHighlight(value);
  };

  function requestSpecific(version: string) {
    if (data === null) {
      return EMPTY;
    } else if (data[version] !== null) {
      return data[version];
    } else {
      dispatch({ type: "fetching", version });
      generateData(version).then((data) => {
        console.trace({ type: "set", version, data });
        dispatch({ type: "set", version, data });
      });

      return EMPTY;
    }
  }

  useEffect(() => {
    if (
      !data ||
      !modifiedDecorationsRef.current ||
      !monaco ||
      !diffEditorRef.current ||
      selectedHighlight == "none"
    )
      return;

    const originalHighlight = requestSpecific(selectedButton).locs.find(
      (x) => x[0] === selectedHighlight
    );
    const modifiedHighlight = requestSpecific(modifiedSelected).locs.find(
      (x) => x[0] === selectedHighlight
    )!;

    // Clear existing decorations
    originalDecorationsRef.current?.clear();
    modifiedDecorationsRef.current?.clear();

    if (selectedHighlight !== "none") {
      modifiedDecorationsRef.current?.set([
        {
          range: new monaco.Range(
            modifiedHighlight[1][0] + 1,
            modifiedHighlight[1][1] + 1,
            modifiedHighlight[1][2] + 1,
            modifiedHighlight[1][3] + 1
          ),
          options: { inlineClassName: "highlighted-text" },
        },
      ]);

      goToPosition(
        modifiedHighlight[1],
        diffEditorRef.current.getModifiedEditor()
      );

      if (originalHighlight) {
        originalDecorationsRef.current?.set([
          {
            range: new monaco.Range(
              originalHighlight[1][0] + 1,
              originalHighlight[1][1] + 1,
              originalHighlight[1][2] + 1,
              originalHighlight[1][3] + 1
            ),
            options: { inlineClassName: "highlighted-text" },
          },
        ]);
      } else {
        originalDecorationsRef.current?.set([]);
      }
    }
  }, [selectedButton, selectedHighlight, modifiedDecorationsRef, data]);

  const options: DiffEditorProps["options"] = {
    renderSideBySide: true,
    minimap: { enabled: false },
    readOnly: true,
    originalEditable: false,
  };

  useEffect(() => {
    const handleResize = () => {
      const editorElement = document.getElementById("monaco-diff-editor");
      if (editorElement) {
        editorElement.style.height = `${window.innerHeight - 60}px`; // 60px for the button container
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    handleButtonClick("1.8"); // Set initial content
  }, []);

  useEffect(() => {
    if (monaco) {
      monaco.editor.defineTheme("customTheme", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
          "editor.selectionBackground": "#5E5E5E",
        },
      });
      monaco.editor.setTheme("customTheme");
    }
  }, [monaco]);

  return (
    <div className="flex flex-col h-screen">
      {data === null ? (
        <div>Loading...</div>
      ) : (
        <>
          <div className="flex justify-between items-center p-4 bg-gray-800 text-white">
            <div className="flex space-x-2">
              <ScrollArea className="rounded-md whitespace-nowrap w-[90vw]">
                {Object.keys(data).map((x) => (
                  <Button
                    key={x}
                    onClick={() => handleButtonClick(x)}
                    disabled={selectedButton === x}
                    aria-pressed={selectedButton === x}
                    variant={selectedButton === x ? "default" : "outline"}
                    className="bg-gray-700 text-white border-gray-600 hover:bg-gray-600"
                  >
                    {x}
                  </Button>
                ))}
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
            <Select
              value={selectedHighlight}
              onValueChange={handleHighlightChange}
            >
              <SelectTrigger className="w-[180px] bg-gray-700 border-gray-600">
                <SelectValue placeholder="Select Highlight" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem key="none" value="none">
                  No packet selected
                </SelectItem>
                {requestSpecific(modifiedSelected).locs.map((x) => (
                  <SelectItem key={x[0]} value={x[0]}>
                    {x[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div id="monaco-diff-editor" className="flex-grow">
            <DiffEditor
              original={requestSpecific(selectedButton).ts}
              modified={requestSpecific(modifiedSelected).ts}
              language="javascript"
              theme="customTheme"
              options={options}
              height="100%"
              onMount={(editor) => {
                (diffEditorRef.current as any) = editor;
                originalDecorationsRef.current = editor
                  .getOriginalEditor()
                  .createDecorationsCollection();
                modifiedDecorationsRef.current = editor
                  .getModifiedEditor()
                  .createDecorationsCollection();
              }}
            />
          </div>
          <style jsx global>{`
            .highlighted-text {
              background-color: #4a4a4a;
              border-radius: 3px;
            }
          `}</style>
        </>
      )}
    </div>
  );
}
