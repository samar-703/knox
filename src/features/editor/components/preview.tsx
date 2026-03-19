"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MonitorIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  TabletIcon,
  ZoomInIcon,
  ZoomOutIcon,
  GlobeIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { Id } from "../../../../convex/_generated/dataModel";
import { useProjectFiles } from "@/features/projects/hooks/use-files";
import { useEditor } from "@/features/editor/hooks/use-editor";

const DEVICE_FRAMES = {
  desktop: { label: "Desktop", icon: MonitorIcon, width: "100%", height: "100%" },
  tablet: { label: "Tablet", icon: TabletIcon, width: "768px", height: "100%" },
  mobile: { label: "Mobile", icon: SmartphoneIcon, width: "375px", height: "100%" },
} as const;

type DeviceFrame = keyof typeof DEVICE_FRAMES;

interface PreviewFile {
  _id: string;
  path: string;
  content: string;
}

const isHtmlFile = (path: string) => /\.(html?)$/i.test(path);
const isMarkdownFile = (path: string) => /\.(md|mdx)$/i.test(path);
const isCssFile = (path: string) => /\.(css)$/i.test(path);
const isImageFile = (path: string) => /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(path);

const resolveFilePath = (currentPath: string, relativePath: string): string | null => {
  const currentDir = currentPath.includes("/")
    ? currentPath.substring(0, currentPath.lastIndexOf("/"))
    : "";
  
  let basePath = currentDir ? `${currentDir}/` : "";
  let resolvedPath = relativePath;

  if (relativePath.startsWith("./")) {
    resolvedPath = relativePath.substring(2);
  } else if (relativePath.startsWith("../")) {
    let parentCount = 0;
    let remaining = relativePath;
    while (remaining.startsWith("../")) {
      parentCount++;
      remaining = remaining.substring(3);
    }
    const segments = basePath.split("/").filter(Boolean);
    const newSegments = segments.slice(0, Math.max(0, segments.length - parentCount));
    basePath = newSegments.join("/") + (newSegments.length ? "/" : "");
    resolvedPath = remaining;
  }

  return basePath + resolvedPath;
};

const buildFileMap = (
  files: { _id: string; name: string; parentId?: string; content?: string }[]
): Map<string, { name: string; parentId?: string; content?: string }> => {
  const fileMap = new Map<string, { name: string; parentId?: string; content?: string }>();

  const buildPaths = (parentId: string | undefined, basePath: string) => {
    const children = files.filter((f) => f.parentId === parentId);
    for (const file of children) {
      const filePath = basePath ? `${basePath}/${file.name}` : file.name;
      fileMap.set(filePath.toLowerCase(), file);
      if (!file.content) {
        buildPaths(file._id, filePath);
      }
    }
  };

  buildPaths(undefined, "");
  return fileMap;
};

const createStandaloneHtml = (
  htmlContent: string,
  fileMap: Map<string, { name: string; parentId?: string; content?: string }>,
  basePath: string
): string => {
  let processedHtml = htmlContent;

  processedHtml = processedHtml.replace(
    /<link[^>]+href=["']([^"']+)["'][^>]*>/gi,
    (match, href) => {
      if (href.startsWith("http") || href.startsWith("//") || href.startsWith("data:")) {
        return match;
      }
      const resolvedPath = resolveFilePath(basePath, href);
      if (!resolvedPath) return match;
      const linkedFile = fileMap.get(resolvedPath.toLowerCase());
      if (linkedFile?.content && isCssFile(resolvedPath)) {
        return `<style>${linkedFile.content}</style>`;
      }
      return match;
    }
  );

  processedHtml = processedHtml.replace(
    /<script[^>]+src=["']([^"']+)["'][^>]*>/gi,
    (match, src) => {
      if (src.startsWith("http") || src.startsWith("//")) {
        return match;
      }
      const resolvedPath = resolveFilePath(basePath, src);
      if (!resolvedPath) return match;
      const linkedFile = fileMap.get(resolvedPath.toLowerCase());
      if (linkedFile?.content) {
        return `<script>${linkedFile.content}</script>`;
      }
      return match;
    }
  );

  processedHtml = processedHtml.replace(
    /<(?:img|video|audio|source)[^>]+(?:src|href)=["']([^"']+)["'][^>]*>/gi,
    (match, src) => {
      if (src.startsWith("http") || src.startsWith("//") || src.startsWith("data:")) {
        return match;
      }
      const resolvedPath = resolveFilePath(basePath, src);
      if (!resolvedPath) return match;
      const linkedFile = fileMap.get(resolvedPath.toLowerCase());
      if (linkedFile?.content && isImageFile(resolvedPath)) {
        const ext = resolvedPath.split(".").pop()?.toLowerCase() || "png";
        const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
        const base64 = btoa(linkedFile.content);
        return match.replace(src, `data:${mimeType};base64,${base64}`);
      }
      return match;
    }
  );

  processedHtml = processedHtml.replace(/srcset=["'][^"']+["']/gi, "");
  processedHtml = processedHtml.replace(/@import\s+["']([^"']+)["']/gi, (match, url) => {
    if (url.startsWith("http")) return match;
    const resolvedPath = resolveFilePath(basePath, url);
    if (!resolvedPath) return match;
    const linkedFile = fileMap.get(resolvedPath.toLowerCase());
    if (linkedFile?.content) {
      return linkedFile.content;
    }
    return match;
  });

  return processedHtml;
};

export const Preview = ({ projectId }: { projectId: Id<"projects"> }) => {
  const projectFiles = useProjectFiles(projectId);
  const { previewTabId } = useEditor(projectId);

  const fileMap = useMemo(() => {
    if (!projectFiles) return new Map();
    return buildFileMap(projectFiles);
  }, [projectFiles]);

  const previewFiles = useMemo<PreviewFile[]>(() => {
    if (!projectFiles) return [];

    const files: PreviewFile[] = [];
    const visited = new Set<string>();

    const traverse = (parentId?: string, basePath = "") => {
      const children = projectFiles.filter((f) => f.parentId === parentId);
      for (const file of children) {
        const filePath = basePath ? `${basePath}/${file.name}` : file.name;
        if (visited.has(filePath.toLowerCase())) continue;
        visited.add(filePath.toLowerCase());

        if (file.type === "file" && typeof file.content === "string") {
          files.push({
            _id: file._id,
            path: filePath,
            content: file.content ?? "",
          });
        } else if (file.type === "folder") {
          traverse(file._id, filePath);
        }
      }
    };

    traverse();
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }, [projectFiles]);

  const defaultPreviewPath = useMemo(() => {
    const rootIndex = previewFiles.find((file) => /^index\.html?$/i.test(file.path));
    if (rootIndex) return rootIndex.path;

    const anyHtml = previewFiles.find((file) => isHtmlFile(file.path));
    if (anyHtml) return anyHtml.path;

    const anyMarkdown = previewFiles.find((file) => isMarkdownFile(file.path));
    if (anyMarkdown) return anyMarkdown.path;

    return previewFiles[0]?.path ?? null;
  }, [previewFiles]);

  const initialPreviewState = useMemo(() => ({
    selectedPath: null as string | null,
    urlInput: "",
    history: [] as string[],
    historyIndex: -1,
  }), []);

  const [previewState, setPreviewState] = useState(() => {
    if (defaultPreviewPath) {
      return {
        selectedPath: defaultPreviewPath,
        urlInput: `/${defaultPreviewPath}`,
        history: [defaultPreviewPath],
        historyIndex: 0,
      };
    }
    return initialPreviewState;
  });
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrame>("desktop");
  const [zoom, setZoom] = useState(100);
  const [refreshKey, setRefreshKey] = useState(0);

  const { selectedPath, urlInput, history, historyIndex } = previewState;

  const activePreviewPath = previewTabId
    ? previewFiles.find((f) => f._id === previewTabId)?.path ?? selectedPath
    : selectedPath;

  const selectedPreview = previewFiles.find((f) => f.path === activePreviewPath);

  const displayUrlInput = selectedPreview ? `/${selectedPreview.path}` : urlInput;

  const processedContent = useMemo(() => {
    if (!selectedPreview) return null;

    if (isHtmlFile(selectedPreview.path)) {
      return createStandaloneHtml(selectedPreview.content, fileMap, selectedPreview.path);
    }

    return selectedPreview.content;
  }, [selectedPreview, fileMap]);

  const handleFileSelect = useCallback((path: string) => {
    setPreviewState(prev => {
      const newHistory = prev.history.includes(path)
        ? prev.history
        : [...prev.history.slice(0, prev.historyIndex + 1), path];
      const newIndex = prev.history.includes(path)
        ? prev.history.indexOf(path)
        : newHistory.length - 1;
      return {
        selectedPath: path,
        urlInput: `/${path}`,
        history: newHistory,
        historyIndex: newIndex,
      };
    });
  }, []);

  const handleBack = useCallback(() => {
    setPreviewState(prev => {
      if (prev.historyIndex <= 0 || prev.history.length === 0) return prev;
      const newIndex = prev.historyIndex - 1;
      return {
        ...prev,
        historyIndex: newIndex,
        selectedPath: prev.history[newIndex],
        urlInput: `/${prev.history[newIndex]}`,
      };
    });
  }, []);

  const handleForward = useCallback(() => {
    setPreviewState(prev => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      const newIndex = prev.historyIndex + 1;
      return {
        ...prev,
        historyIndex: newIndex,
        selectedPath: prev.history[newIndex],
        urlInput: `/${prev.history[newIndex]}`,
      };
    });
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  const handleZoomChange = useCallback((value: number) => {
    setZoom(value);
  }, []);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  const renderPreview = () => {
    if (projectFiles === undefined) {
      return (
        <div className="size-full flex items-center justify-center text-sm text-muted-foreground">
          Loading preview...
        </div>
      );
    }

    if (previewFiles.length === 0) {
      return (
        <div className="size-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <GlobeIcon className="size-8 opacity-50" />
          <span>No previewable files found</span>
        </div>
      );
    }

    if (!selectedPreview) {
      return (
        <div className="size-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <GlobeIcon className="size-8 opacity-50" />
          <span>Select a file to preview</span>
        </div>
      );
    }

    if (isMarkdownFile(selectedPreview.path)) {
      return (
        <div className="size-full overflow-auto p-6 bg-background">
          <div className="max-w-3xl mx-auto prose prose-sm dark:prose-invert">
            <MarkdownPreview content={selectedPreview.content} />
          </div>
        </div>
      );
    }

    if (isHtmlFile(selectedPreview.path) && processedContent) {
      const frameWidth = deviceFrame !== "desktop" 
        ? parseInt(DEVICE_FRAMES[deviceFrame].width) 
        : "100%";
      const scaledWidth = typeof frameWidth === "number" 
        ? (frameWidth * 100) / zoom 
        : frameWidth;
      
      return (
        <iframe
          key={`${selectedPreview.path}-${refreshKey}-${zoom}-${deviceFrame}`}
          className="bg-white transition-all duration-200"
          style={{
            width: typeof scaledWidth === "number" ? `${scaledWidth}px` : scaledWidth,
            height: "100%",
            border: deviceFrame !== "desktop" ? "1px solid hsl(var(--border))" : "none",
            borderRadius: deviceFrame !== "desktop" ? "8px" : "0",
            boxShadow: deviceFrame !== "desktop" ? "0 4px 12px rgba(0,0,0,0.15)" : "none",
          }}
          srcDoc={processedContent}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title={`Preview ${selectedPreview.path}`}
        />
      );
    }

    return (
      <div className="size-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <GlobeIcon className="size-8 opacity-50" />
        <span>Cannot preview this file type</span>
      </div>
    );
  };

  return (
    <div className="h-full bg-background flex flex-col">
      <div className="h-9 border-b px-2 flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleBack}
                disabled={!canGoBack}
                className="h-6 w-6"
              >
                <ChevronLeftIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleForward}
                disabled={!canGoForward}
                className="h-6 w-6"
              >
                <ChevronRightIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={handleRefresh}
                className="h-6 w-6"
              >
                <RefreshCwIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 min-w-0 max-w-md">
          <Select
            value={selectedPreview?.path ?? ""}
            onValueChange={handleFileSelect}
          >
            <SelectTrigger className="h-6 w-full text-xs">
              <div className="flex items-center gap-2 truncate">
                <GlobeIcon className="size-3 shrink-0" />
                <SelectValue placeholder="Select a file to preview..." />
              </div>
            </SelectTrigger>
            <SelectContent>
              {previewFiles.map((file) => (
                <SelectItem key={file._id} value={file.path} className="text-xs">
                  {file.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Select value={deviceFrame} onValueChange={(v) => setDeviceFrame(v as DeviceFrame)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger className="h-6 w-6 p-0 border-0">
                  <SelectValue>
                    {(() => {
                      const Icon = DEVICE_FRAMES[deviceFrame].icon;
                      return <Icon className="size-3.5" />;
                    })()}
                  </SelectValue>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent>Device frame</TooltipContent>
            </Tooltip>
            <SelectContent>
              {Object.entries(DEVICE_FRAMES).map(([key, { label, icon: Icon }]) => (
                <SelectItem key={key} value={key} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Icon className="size-3.5" />
                    {label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="h-4 w-px bg-border mx-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => handleZoomChange(Math.max(25, zoom - 25))}
                disabled={zoom <= 25}
                className="h-6 w-6"
              >
                <ZoomOutIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <div className="w-16">
            <Slider
              value={[zoom]}
              onValueChange={([v]) => handleZoomChange(v)}
              min={25}
              max={200}
              step={25}
              className="cursor-pointer"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => handleZoomChange(Math.min(200, zoom + 25))}
                disabled={zoom >= 200}
                className="h-6 w-6"
              >
                <ZoomInIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in</TooltipContent>
          </Tooltip>
          <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">
            {zoom}%
          </span>
        </div>
      </div>

      <div className="h-7 border-b px-3 flex items-center gap-2 shrink-0 bg-muted/20">
        <GlobeIcon className="size-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate">
          {displayUrlInput || "/"}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center p-4">
        <div 
          className={cn(
            "h-full overflow-auto",
            deviceFrame !== "desktop" && "bg-muted/30 rounded-lg"
          )}
          style={{
            width: deviceFrame !== "desktop" ? DEVICE_FRAMES[deviceFrame].width : "100%",
          }}
        >
          {renderPreview()}
        </div>
      </div>
    </div>
  );
};

const MarkdownPreview = ({ content }: { content: string }) => {
  const htmlContent = useMemo(() => {
    let text = content;

    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      return `<pre class="not-prose bg-muted p-4 rounded-lg overflow-x-auto"><code class="text-sm">${escapeHtml(code.trim())}</code></pre>`;
    });

    text = text.replace(/`([^`]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm">$1</code>');
    text = text.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold mt-6 mb-3">$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mt-6 mb-4">$1</h1>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/^\- (.+)$/gm, '<li class="ml-4">$1</li>');
    text = text.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 hover:underline">$1</a>');
    text = text.replace(/\n\n/g, '</p><p class="my-2">');
    text = text.replace(/\n/g, '<br />');

    return `<p>${text}</p>`;
  }, [content]);

  return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />;
};

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};
