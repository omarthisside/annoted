import { defineContentScript } from "wxt/sandbox";
import { drawShape, drawLine, getColorValue } from "../utils/canvas";
import type { Tool, Color, ShapeMode } from "../utils/types";
import LZString from "lz-string";

// Annotation data structure - uses document coordinates
interface Annotation {
  id: string; // Unique ID for deletion tracking
  type: "pen" | "highlighter" | "rectangle" | "circle" | "arrow";
  start: { x: number; y: number };
  end?: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  color: Color;
  shapeMode?: ShapeMode;
  penWidth?: number; // Stroke width for pen, highlighter, and shapes
}

interface TextAnnotation {
  id: string;
  x: number; // Document coordinates
  y: number; // Document coordinates
  text: string;
  color: Color;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let isActive = false;

    // State
    let activeTool: Tool = null;
    let selectedColor: Color = "red";
    let shapeMode: ShapeMode = "outline";
    let lastUsedShape: "rectangle" | "circle" | "arrow" = "rectangle";
    let penWidth: number = 4; // Default medium width
    let isDrawing = false;
    let startPoint: { x: number; y: number } | null = null;
    let currentPath: Array<{ x: number; y: number }> = [];
    let mouse = { x: 0, y: 0 };
    
    // Annotations stored in document coordinates
    const annotations: Annotation[] = [];
    const textAnnotations: TextAnnotation[] = [];
    
    // Dragging state
    let draggingAnnotation: number | null = null;
    let draggingText: { id: string; offsetX: number; offsetY: number } | null = null;
    let moveStartPos: { x: number; y: number } | null = null;
    let moveStartAnnotation: Annotation | null = null;
    let moveStartText: TextAnnotation | null = null;

    // Undo/Redo system - Command-based history
    type Command =
      | { type: "addPen"; annotation: Annotation }
      | { type: "addHighlighter"; annotation: Annotation }
      | { type: "addShape"; annotation: Annotation }
      | { type: "addText"; annotation: TextAnnotation }
      | { type: "editText"; id: string; oldText: string; newText: string }
      | { type: "moveAnnotation"; index: number; oldStart: { x: number; y: number }; oldEnd?: { x: number; y: number }; oldPath?: Array<{ x: number; y: number }>; newStart: { x: number; y: number }; newEnd?: { x: number; y: number }; newPath?: Array<{ x: number; y: number }> }
      | { type: "moveText"; id: string; oldPos: { x: number; y: number }; newPos: { x: number; y: number } }
      | { type: "deleteText"; annotation: TextAnnotation }
      | { type: "delete"; targetId: string; deletedAnnotation?: Annotation; deletedText?: TextAnnotation }
      | { type: "clear_all"; deletedAnnotations: Annotation[]; deletedTexts: TextAnnotation[] };

    let undoStack: Command[] = [];
    let redoStack: Command[] = [];

    // Normalize URL for storage key
    const getStorageKey = () => {
      const url = window.location.href.split("#")[0].split("?")[0];
      return `annoted:session:${url}`;
    };

    // Save session to localStorage
    const saveSession = () => {
      try {
        const session = {
          version: 1,
          pageUrl: window.location.href.split("#")[0].split("?")[0],
          toolState: {
            activeTool,
            color: selectedColor,
            penWidth,
            shapeType: lastUsedShape,
            shapeFillMode: shapeMode,
          },
          actions: undoStack,
        };
        localStorage.setItem(getStorageKey(), JSON.stringify(session));
      } catch (e) {
        console.warn("[Annoted] Failed to save session:", e);
      }
    };

    // Load session from localStorage
    const loadSession = (): { actions: Command[]; toolState?: any } => {
      try {
        const stored = localStorage.getItem(getStorageKey());
        if (stored) {
          const session = JSON.parse(stored);
          // Only restore if URL matches (excluding hash/query)
          const currentUrl = window.location.href.split("#")[0].split("?")[0];
          const storedUrl = session.pageUrl || session.url;
          const normalizedStoredUrl = storedUrl ? storedUrl.split("#")[0].split("?")[0] : "";
          
          if (currentUrl === normalizedStoredUrl) {
            return {
              actions: session.actions || [],
              toolState: session.toolState,
            };
          }
        }
      } catch (e) {
        console.warn("[Annoted] Failed to load session:", e);
        // Clear malformed session
        try {
          localStorage.removeItem(getStorageKey());
        } catch (clearError) {
          // Ignore clear errors
        }
      }
      return { actions: [] };
    };

    // URL-based sharing
    const SAFE_LIMIT = 6000;
    const HARD_LIMIT = 8000;

    const generateShareUrl = (): { url: string | null; size: number; status: "safe" | "warning" | "blocked" } => {
      try {
        const session = {
          v: 1,
          pageUrl: window.location.href.split("#")[0].split("?")[0],
          actions: undoStack,
          toolState: {
            activeTool,
            color: selectedColor,
            penWidth,
            shapeType: lastUsedShape,
            shapeFillMode: shapeMode,
          },
        };

        const json = JSON.stringify(session);
        const compressed = LZString.compressToEncodedURIComponent(json);
        const size = compressed.length;

        if (size > HARD_LIMIT) {
          return { url: null, size, status: "blocked" };
        }

        const baseUrl = window.location.href.split("#")[0].split("?")[0];
        const shareUrl = `${baseUrl}#annoted=${compressed}`;

        if (size > SAFE_LIMIT) {
          return { url: shareUrl, size, status: "warning" };
        }

        return { url: shareUrl, size, status: "safe" };
      } catch (e) {
        console.warn("[Annoted] Failed to generate share URL:", e);
        return { url: null, size: 0, status: "blocked" };
      }
    };

    const showShareModal = () => {
      const result = generateShareUrl();

      // Remove existing modal if any
      const existing = document.getElementById("annoted-share-modal");
      if (existing) existing.remove();

      const modal = document.createElement("div");
      modal.id = "annoted-share-modal";
      modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        padding: 24px;
        z-index: 2147483650;
        pointer-events: auto;
        min-width: 400px;
        max-width: 500px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      if (result.status === "blocked") {
        modal.innerHTML = `
          <h3 style="color: #ffffff; margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Cannot Share</h3>
          <p style="color: rgba(255, 255, 255, 0.9); margin: 0 0 20px 0; line-height: 1.5;">
            This annotation session is too large to share as a link (${result.size} characters).
          </p>
          <p style="color: rgba(255, 255, 255, 0.75); margin: 0 0 20px 0; line-height: 1.5; font-size: 14px;">
            Try using screenshot export or full-page capture instead.
          </p>
          <button id="annoted-share-close" style="
            width: 100%;
            padding: 10px;
            background: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 8px;
            color: #ffffff;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 120ms ease;
          ">Close</button>
        `;
      } else {
        const warningText = result.status === "warning" 
          ? `<p style="color: rgba(255, 200, 0, 0.9); margin: 0 0 16px 0; line-height: 1.5; font-size: 14px;">⚠️ This link may not work everywhere due to size (${result.size} characters).</p>`
          : "";

        modal.innerHTML = `
          <h3 style="color: #ffffff; margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Share Annotations</h3>
          <p style="color: rgba(255, 255, 255, 0.9); margin: 0 0 16px 0; line-height: 1.5;">
            Anyone with Annoted installed will see these annotations instantly.
          </p>
          ${warningText}
          <p style="color: rgba(255, 255, 255, 0.75); margin: 0 0 20px 0; line-height: 1.5; font-size: 14px;">
            Best for small to medium annotations.
          </p>
          <div style="
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 16px;
            word-break: break-all;
            font-size: 12px;
            color: rgba(255, 255, 255, 0.8);
            max-height: 120px;
            overflow-y: auto;
          " id="annoted-share-url">${result.url}</div>
          <div style="display: flex; gap: 8px;">
            <button id="annoted-share-copy" style="
              flex: 1;
              padding: 10px;
              background: rgba(255, 255, 255, 0.2);
              border: none;
              border-radius: 8px;
              color: #ffffff;
              cursor: pointer;
              font-size: 14px;
              transition: background-color 120ms ease;
            ">Copy Link</button>
            <button id="annoted-share-close" style="
              flex: 1;
              padding: 10px;
              background: rgba(255, 255, 255, 0.1);
              border: none;
              border-radius: 8px;
              color: #ffffff;
              cursor: pointer;
              font-size: 14px;
              transition: background-color 120ms ease;
            ">Close</button>
          </div>
        `;

        const copyBtn = modal.querySelector("#annoted-share-copy");
        copyBtn?.addEventListener("click", () => {
          if (result.url) {
            navigator.clipboard.writeText(result.url).then(() => {
              const btn = copyBtn as HTMLElement;
              const originalText = btn.textContent;
              btn.textContent = "Copied!";
              btn.style.background = "rgba(0, 255, 0, 0.2)";
              setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = "rgba(255, 255, 255, 0.2)";
              }, 2000);
            }).catch(() => {
              // Fallback: select text
              const urlEl = document.getElementById("annoted-share-url");
              if (urlEl) {
                const range = document.createRange();
                range.selectNodeContents(urlEl);
                const selection = window.getSelection();
                selection?.removeAllRanges();
                selection?.addRange(range);
              }
            });
          }
        });

        copyBtn?.addEventListener("mouseenter", () => {
          (copyBtn as HTMLElement).style.background = "rgba(255, 255, 255, 0.3)";
        });
        copyBtn?.addEventListener("mouseleave", () => {
          (copyBtn as HTMLElement).style.background = "rgba(255, 255, 255, 0.2)";
        });
      }

      const closeBtn = modal.querySelector("#annoted-share-close");
      closeBtn?.addEventListener("click", () => {
        modal.remove();
      });

      closeBtn?.addEventListener("mouseenter", () => {
        (closeBtn as HTMLElement).style.background = "rgba(255, 255, 255, 0.2)";
      });
      closeBtn?.addEventListener("mouseleave", () => {
        (closeBtn as HTMLElement).style.background = "rgba(255, 255, 255, 0.1)";
      });

      // Close on backdrop click
      const backdrop = document.createElement("div");
      backdrop.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.3);
        z-index: 2147483649;
        pointer-events: auto;
      `;
      backdrop.onclick = () => {
        modal.remove();
        backdrop.remove();
      };

      overlay.appendChild(backdrop);
      overlay.appendChild(modal);
    };

    // Restore from URL hash
    const restoreFromUrl = () => {
      try {
        const hash = window.location.hash;
        const match = hash.match(/annoted=([^&]+)/);
        if (!match) return false;

        const compressed = match[1];
        const json = LZString.decompressFromEncodedURIComponent(compressed);
        if (!json) {
          console.warn("[Annoted] Failed to decompress share data");
          return false;
        }

        const session = JSON.parse(json);
        
        // Validate version
        if (session.v !== 1) {
          console.warn("[Annoted] Unsupported share version:", session.v);
          return false;
        }

        // Validate page URL matches
        const currentUrl = window.location.href.split("#")[0].split("?")[0];
        const sharedUrl = session.pageUrl || "";
        if (currentUrl !== sharedUrl) {
          console.warn("[Annoted] Page URL mismatch:", currentUrl, "vs", sharedUrl);
          return false;
        }

        // Restore tool state
        if (session.toolState) {
          activeTool = session.toolState.activeTool || null;
          selectedColor = session.toolState.color || "red";
          penWidth = session.toolState.penWidth || 4;
          lastUsedShape = session.toolState.shapeType || "rectangle";
          shapeMode = session.toolState.shapeFillMode || "outline";
        }

        // Restore annotations by replaying actions
        if (session.actions && Array.isArray(session.actions)) {
          replayCommands(session.actions);
          redrawAll();
          updateTextAnnotations();
          
          // Save to localStorage
          undoStack = JSON.parse(JSON.stringify(session.actions));
          saveSession();
        }

        // Clean up URL hash
        const newHash = hash.replace(/annoted=[^&]+&?/, "").replace(/^#&/, "#").replace(/^#$/, "");
        if (newHash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search + newHash);
        } else {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }

        return true;
      } catch (e) {
        console.warn("[Annoted] Failed to restore from URL:", e);
        // Clear hash on error
        const hash = window.location.hash.replace(/annoted=[^&]+&?/, "").replace(/^#&/, "#").replace(/^#$/, "");
        if (hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search + hash);
        } else {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }
        return false;
      }
    };

    // Replay commands to restore state
    const replayCommands = (commands: Command[]) => {
      // Clear current state
      annotations.length = 0;
      textAnnotations.length = 0;

      // Replay all commands in order
      commands.forEach((cmd) => {
        if (cmd.type === "addPen" || cmd.type === "addHighlighter" || cmd.type === "addShape") {
          annotations.push(JSON.parse(JSON.stringify(cmd.annotation)));
        } else if (cmd.type === "addText") {
          textAnnotations.push(JSON.parse(JSON.stringify(cmd.annotation)));
        } else if (cmd.type === "editText") {
          const text = textAnnotations.find((t) => t.id === cmd.id);
          if (text) {
            text.text = cmd.newText;
          }
        } else if (cmd.type === "moveAnnotation") {
          const ann = annotations[cmd.index];
          if (ann) {
            ann.start = { ...cmd.newStart };
            if (cmd.newEnd) ann.end = { ...cmd.newEnd };
            if (cmd.newPath) ann.path = cmd.newPath.map((p) => ({ ...p }));
          }
        } else if (cmd.type === "moveText") {
          const text = textAnnotations.find((t) => t.id === cmd.id);
          if (text) {
            text.x = cmd.newPos.x;
            text.y = cmd.newPos.y;
          }
        } else if (cmd.type === "deleteText") {
          // Remove text annotation
          const index = textAnnotations.findIndex((t) => t.id === cmd.annotation.id);
          if (index > -1) {
            textAnnotations.splice(index, 1);
          }
        } else if (cmd.type === "delete") {
          // Remove annotation or text
          if (cmd.deletedAnnotation) {
            const index = annotations.findIndex((a) => a.id === cmd.targetId);
            if (index > -1) {
              annotations.splice(index, 1);
            }
          } else if (cmd.deletedText) {
            const index = textAnnotations.findIndex((t) => t.id === cmd.targetId);
            if (index > -1) {
              textAnnotations.splice(index, 1);
            }
          }
        } else if (cmd.type === "clear_all") {
          // Clear all annotations
          annotations.length = 0;
          textAnnotations.length = 0;
        }
      });

      // Redraw
      redrawAll();
      updateTextAnnotations();
    };

    // Execute command and add to history
    const executeCommand = (cmd: Command) => {
      if (cmd.type === "addPen" || cmd.type === "addHighlighter" || cmd.type === "addShape") {
        annotations.push(JSON.parse(JSON.stringify(cmd.annotation)));
      } else if (cmd.type === "addText") {
        textAnnotations.push(JSON.parse(JSON.stringify(cmd.annotation)));
      } else if (cmd.type === "editText") {
        const text = textAnnotations.find((t) => t.id === cmd.id);
        if (text) {
          text.text = cmd.newText;
        }
      } else if (cmd.type === "moveAnnotation") {
        const ann = annotations[cmd.index];
        if (ann) {
          ann.start = { ...cmd.newStart };
          if (cmd.newEnd) ann.end = { ...cmd.newEnd };
          if (cmd.newPath) ann.path = cmd.newPath.map((p) => ({ ...p }));
        }
      } else if (cmd.type === "moveText") {
        const text = textAnnotations.find((t) => t.id === cmd.id);
        if (text) {
          text.x = cmd.newPos.x;
          text.y = cmd.newPos.y;
        }
      } else if (cmd.type === "deleteText") {
        const index = textAnnotations.findIndex((t) => t.id === cmd.annotation.id);
        if (index > -1) {
          textAnnotations.splice(index, 1);
        }
      } else if (cmd.type === "delete") {
        if (cmd.deletedAnnotation) {
          const index = annotations.findIndex((a) => a.id === cmd.targetId);
          if (index > -1) {
            annotations.splice(index, 1);
          }
        } else if (cmd.deletedText) {
          const index = textAnnotations.findIndex((t) => t.id === cmd.targetId);
          if (index > -1) {
            textAnnotations.splice(index, 1);
          }
        }
      } else if (cmd.type === "clear_all") {
        annotations.length = 0;
        textAnnotations.length = 0;
      }

      // Add to undo stack and clear redo
      undoStack.push(JSON.parse(JSON.stringify(cmd)));
      redoStack = [];
      saveSession();
      redrawAll();
      updateTextAnnotations();
      updateToolbar();
    };

    // Undo last action
    const undo = () => {
      if (undoStack.length === 0) return;

      const cmd = undoStack.pop()!;
      redoStack.push(cmd);

      // Replay remaining commands
      replayCommands(undoStack);
      saveSession();
      updateToolbar();
    };

    // Redo last undone action
    const redo = () => {
      if (redoStack.length === 0) return;

      const cmd = redoStack.pop()!;
      undoStack.push(cmd);

      // Replay all commands including the redone one
      replayCommands(undoStack);
      saveSession();
      updateToolbar();
    };

    // Create overlay container - PRESERVE EXISTING STRUCTURE
    const overlay = document.createElement("div");
    overlay.id = "annoted-overlay";
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
    pointer-events: none;
      margin: 0;
      padding: 0;
      border: 0;
    `;
    document.body.appendChild(overlay);

    // Create canvas - VIEWPORT SIZED (annotations stored in document coordinates)
    const createCanvas = () => {
      if (canvas) {
        canvas.remove();
      }

      canvas = document.createElement("canvas");
      canvas.id = "canvas-draw";
      // Canvas is viewport-sized for event capture
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
      // Canvas is fixed to viewport - annotations scroll via coordinate conversion
      canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: transparent;
        pointer-events: none;
        margin: 0;
        padding: 0;
        border: 0;
      `;
      overlay.appendChild(canvas);

  ctx = canvas.getContext("2d");
  if (!ctx) return;

      // Redraw on scroll so annotations appear to scroll with page
      const handleScroll = () => {
      redrawAll();
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
    };

    // Redraw all annotations - convert document coordinates to viewport coordinates
    const redrawAll = () => {
      if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Convert document coordinates to viewport coordinates
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      annotations.forEach((ann) => {
        if ((ann.type === "pen" || ann.type === "highlighter") && ann.path) {
          ctx!.strokeStyle = getColorValue(ann.color);
          ctx!.lineWidth = ann.penWidth || 4;
          ctx!.lineJoin = "round";
          ctx!.lineCap = "round";
          
          // Highlighter uses semi-transparent strokes
          if (ann.type === "highlighter") {
            ctx!.globalAlpha = 0.35;
          } else {
            ctx!.globalAlpha = 1.0;
          }
          
          ctx!.beginPath();
          // Convert document coords to viewport coords
          const firstPoint = ann.path[0];
          const viewportX = firstPoint.x - scrollX;
          const viewportY = firstPoint.y - scrollY;
          if (viewportY >= -50 && viewportY <= window.innerHeight + 50) {
            ctx!.moveTo(viewportX, viewportY);
            for (let i = 1; i < ann.path.length; i++) {
              const p = ann.path[i];
              const vx = p.x - scrollX;
              const vy = p.y - scrollY;
              if (vy >= -50 && vy <= window.innerHeight + 50) {
                ctx!.lineTo(vx, vy);
              }
            }
            ctx!.stroke();
          }
          ctx!.globalAlpha = 1.0; // Reset alpha
        } else if (ann.end) {
          // Shapes - convert to viewport coordinates
          const start = { x: ann.start.x - scrollX, y: ann.start.y - scrollY };
          const end = { x: ann.end.x - scrollX, y: ann.end.y - scrollY };
          // Only draw if visible in viewport
          if (
            (start.y >= -100 && start.y <= window.innerHeight + 100) ||
            (end.y >= -100 && end.y <= window.innerHeight + 100)
          ) {
            drawShape(ctx!, ann.type, start, end, ann.color, ann.shapeMode || "outline", (ann.penWidth || 4) as any);
          }
        }
      });
    };

    // Update text annotations DOM - convert document coords to viewport
    const updateTextAnnotations = () => {
      // Remove old text elements
      const oldTexts = overlay.querySelectorAll(".annoted-text");
      oldTexts.forEach((el) => el.remove());

      // Add text annotations - use fixed positioning, convert document to viewport
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      
      textAnnotations.forEach((text) => {
        // Only show if in viewport
        const viewportY = text.y - scrollY;
        if (viewportY < -100 || viewportY > window.innerHeight + 100) {
          return;
        }
        
        const div = document.createElement("div");
        div.id = text.id;
        div.className = "annoted-text";
        div.style.cssText = `
          position: fixed;
          left: ${text.x - scrollX}px;
          top: ${viewportY}px;
          pointer-events: auto;
          z-index: 2147483648;
          margin: 0;
          padding: 0;
        `;
        const input = document.createElement("input");
        input.type = "text";
        input.value = text.text;
        input.placeholder = "Type text...";
        input.style.cssText = `
          padding: 8px;
          border: 2px solid ${getColorValue(text.color)};
          background: white;
          min-width: 200px;
          font-size: 14px;
        `;
        let lastTextValue = text.text;
        input.oninput = (e) => {
          text.text = (e.target as HTMLInputElement).value;
        };
        input.onblur = () => {
          const newText = text.text;
          if (newText !== lastTextValue) {
            executeCommand({
              type: "editText",
              id: text.id,
              oldText: lastTextValue,
              newText: newText,
            });
            lastTextValue = newText;
          }
          if (!text.text.trim()) {
            const index = textAnnotations.findIndex((t) => t.id === text.id);
            if (index > -1) {
              const deletedText = textAnnotations[index];
              executeCommand({ type: "deleteText", annotation: deletedText });
              textAnnotations.splice(index, 1);
              updateTextAnnotations();
            }
          }
        };
        div.appendChild(input);
        overlay.appendChild(div);
      });
    };

    // Icon SVG helper - Lucide-style icons
    const createIcon = (name: string): string => {
      const icons: Record<string, string> = {
        pencil: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
        highlighter: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 5.5-1.4-1.4a2 2 0 0 0-2.8 0L9.5 6.5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M3 19h18"/><path d="M9 3h6"/></svg>`,
        move: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
        minus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        square: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`,
        circle: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`,
        arrowRight: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
        squareDashed: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`,
        squareFilled: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`,
        check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
        eraser: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`,
        trash2: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
        type: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
        palette: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
        undo: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
        redo: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>`,
        camera: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
        scan: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>`,
        share: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
        download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      };
      return icons[name] || "";
    };

    // Close any open dropdowns
    const closeDropdowns = () => {
      const dropdowns = overlay.querySelectorAll(".annoted-dropdown");
      dropdowns.forEach((d) => d.remove());
    };

    // Create dropdown menu with enhanced UI support
    type DropdownItem = {
      label?: string;
      onClick: () => void;
      icon?: string;
      isSelected?: boolean;
      color?: string; // For color swatches
      width?: number; // For width preview
    };

    const createDropdown = (x: number, y: number, items: Array<DropdownItem>) => {
      closeDropdowns();
      const dropdown = document.createElement("div");
      dropdown.className = "annoted-dropdown";
      dropdown.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        padding: 4px;
        z-index: 2147483649;
        pointer-events: auto;
        min-width: 120px;
      `;

      items.forEach((item) => {
        if (item.label?.startsWith("─")) {
          // Separator
          const sep = document.createElement("div");
          sep.textContent = item.label;
          sep.style.cssText = `
            width: 100%;
            padding: 4px 12px;
            text-align: center;
            color: #ccc;
            font-size: 12px;
            pointer-events: none;
          `;
          dropdown.appendChild(sep);
        } else {
          const btn = document.createElement("button");
          btn.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: ${item.isSelected ? "rgba(255, 255, 255, 0.2)" : "transparent"};
            text-align: left;
            cursor: pointer;
            font-size: 14px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #ffffff;
            transition: background-color 120ms ease;
          `;
          
          // Add icon if provided
          if (item.icon) {
            const iconEl = document.createElement("div");
            iconEl.innerHTML = createIcon(item.icon);
            iconEl.style.cssText = `
              width: 18px;
              height: 18px;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              color: #ffffff;
            `;
            btn.appendChild(iconEl);
          }
          
          // Color swatch
          if (item.color) {
            const swatch = document.createElement("div");
            swatch.style.cssText = `
              width: 20px;
              height: 20px;
              border-radius: 50%;
              background: ${item.color};
              border: ${item.color === "#ffffff" || item.color === "white" ? "1px solid #ccc" : "1px solid rgba(0,0,0,0.1)"};
              flex-shrink: 0;
              position: relative;
              transition: transform 0.2s;
            `;
            if (item.isSelected) {
              // Add check icon overlay
              const check = document.createElement("div");
              check.innerHTML = createIcon("check");
              check.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: ${item.color === "#ffffff" || item.color === "white" ? "#000" : "#fff"};
                width: 14px;
                height: 14px;
                display: flex;
                align-items: center;
                justify-content: center;
              `;
              swatch.appendChild(check);
              swatch.style.border = "2px solid rgba(255, 255, 255, 0.6)";
            }
            btn.onmouseenter = () => {
              btn.style.background = "rgba(255, 255, 255, 0.12)";
            };
            btn.onmouseleave = () => {
              btn.style.background = item.isSelected ? "rgba(255, 255, 255, 0.2)" : "transparent";
            };
            btn.appendChild(swatch);
            if (item.label) {
              const labelEl = document.createElement("span");
              labelEl.textContent = item.label;
              labelEl.style.cssText = `
                color: #ffffff;
              `;
              btn.appendChild(labelEl);
            }
          } else if (item.width !== undefined) {
            // Width preview
            const widthContainer = document.createElement("div");
            widthContainer.style.cssText = `
              display: flex;
              align-items: center;
              gap: 8px;
              flex: 1;
            `;
            const line = document.createElement("div");
            line.style.cssText = `
              width: 40px;
              height: ${item.width}px;
              background: #ffffff;
              border-radius: 2px;
              flex-shrink: 0;
            `;
            widthContainer.appendChild(line);
            if (item.label) {
              const labelEl = document.createElement("span");
              labelEl.textContent = item.label;
              labelEl.style.cssText = `
                color: #ffffff;
              `;
              widthContainer.appendChild(labelEl);
            }
            if (item.isSelected) {
              const check = document.createElement("div");
              check.innerHTML = createIcon("check");
              check.style.cssText = `
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                color: #ffffff;
              `;
              widthContainer.appendChild(check);
            }
            btn.appendChild(widthContainer);
            if (item.isSelected) {
              btn.style.background = "rgba(255, 255, 255, 0.2)";
            }
            btn.onmouseenter = () => {
              btn.style.background = "rgba(255, 255, 255, 0.12)";
            };
            btn.onmouseleave = () => {
              btn.style.background = item.isSelected ? "rgba(255, 255, 255, 0.2)" : "transparent";
            };
          } else {
            // Regular item with optional icon and label
            if (item.label) {
              const labelEl = document.createElement("span");
              labelEl.textContent = item.label;
              labelEl.style.cssText = `
                color: #ffffff;
              `;
              btn.appendChild(labelEl);
            }
            if (item.isSelected) {
              const check = document.createElement("div");
              check.innerHTML = createIcon("check");
              check.style.cssText = `
                width: 16px;
                height: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                margin-left: auto;
                color: #ffffff;
              `;
              btn.appendChild(check);
              btn.style.background = "rgba(255, 255, 255, 0.2)";
            }
            btn.onmouseenter = () => {
              btn.style.background = "rgba(255, 255, 255, 0.12)";
            };
            btn.onmouseleave = () => {
              btn.style.background = item.isSelected ? "rgba(255, 255, 255, 0.2)" : "transparent";
            };
          }
          
          btn.onclick = () => {
            item.onClick();
            closeDropdowns();
          };
          dropdown.appendChild(btn);
        }
      });

      overlay.appendChild(dropdown);

      // Close on outside click
      setTimeout(() => {
        const closeOnClick = (e: MouseEvent) => {
          if (!dropdown.contains(e.target as Node)) {
            closeDropdowns();
            document.removeEventListener("click", closeOnClick);
          }
        };
        setTimeout(() => document.addEventListener("click", closeOnClick), 0);
      }, 0);
    };

    // Background detection for adaptive theming
    let lastDetectedTheme: "light" | "dark" | null = null;
    
    const detectBackgroundTheme = (): "light" | "dark" => {
      const toolbar = document.getElementById("annoted-toolbar");
      if (!toolbar) return "dark"; // Default to dark (white icons)
      
      const rect = toolbar.getBoundingClientRect();
      // Sample a point behind the toolbar (slightly to the left)
      const sampleX = rect.left - 20;
      const sampleY = rect.top + rect.height / 2;
      
      // Get element at sample point
      const element = document.elementFromPoint(sampleX, sampleY);
      if (!element) return "dark";
      
      // Get computed style
      const style = window.getComputedStyle(element);
      const bgColor = style.backgroundColor;
      
      // Parse RGB values
      const rgbMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!rgbMatch) return "dark";
      
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      
      // Calculate perceived luminance
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      
      return luminance < 0.5 ? "dark" : "light";
    };
    
    const updateToolbarTheme = () => {
      const toolbar = document.getElementById("annoted-toolbar");
      if (!toolbar) return;
      
      const theme = detectBackgroundTheme();
      
      // Only update if theme changed
      if (theme === lastDetectedTheme) return;
      lastDetectedTheme = theme;
      
      // Set CSS variables
      if (theme === "dark") {
        toolbar.style.setProperty("--icon-color", "rgba(255, 255, 255, 0.95)");
        toolbar.style.setProperty("--icon-color-active", "rgba(255, 255, 255, 1)");
        toolbar.style.setProperty("--label-color", "rgba(255, 255, 255, 0.7)");
        toolbar.style.setProperty("--label-color-active", "rgba(255, 255, 255, 0.9)");
        toolbar.style.setProperty("--icon-color-disabled", "rgba(255, 255, 255, 0.3)");
        toolbar.style.setProperty("--hover-bg", "rgba(255, 255, 255, 0.18)");
        toolbar.style.setProperty("--active-bg", "rgba(255, 255, 255, 0.28)");
        toolbar.style.setProperty("--active-border", "rgba(255, 255, 255, 0.4)");
        toolbar.style.setProperty("--active-glow", "rgba(255, 255, 255, 0.3)");
      } else {
        toolbar.style.setProperty("--icon-color", "rgba(0, 0, 0, 0.9)");
        toolbar.style.setProperty("--icon-color-active", "rgba(0, 0, 0, 1)");
        toolbar.style.setProperty("--label-color", "rgba(0, 0, 0, 0.6)");
        toolbar.style.setProperty("--label-color-active", "rgba(0, 0, 0, 0.8)");
        toolbar.style.setProperty("--icon-color-disabled", "rgba(0, 0, 0, 0.3)");
        toolbar.style.setProperty("--hover-bg", "rgba(0, 0, 0, 0.08)");
        toolbar.style.setProperty("--active-bg", "rgba(0, 0, 0, 0.15)");
        toolbar.style.setProperty("--active-border", "rgba(0, 0, 0, 0.2)");
        toolbar.style.setProperty("--active-glow", "rgba(0, 0, 0, 0.15)");
      }
      
      // Update all buttons
      const buttons = toolbar.querySelectorAll("button");
      buttons.forEach((btn) => {
        const isActive = btn.style.border.includes("solid");
        const isDisabled = btn.disabled;
        const iconContainer = btn.querySelector("div:first-child") as HTMLElement;
        const labelEl = btn.querySelector("div:last-child") as HTMLElement;
        
        if (iconContainer) {
          iconContainer.style.color = isDisabled 
            ? "var(--icon-color-disabled)" 
            : isActive 
            ? "var(--icon-color-active)" 
            : "var(--icon-color)";
        }
        
        if (labelEl && labelEl.textContent && labelEl.textContent.length < 20) {
          // It's a label, not an icon
          labelEl.style.color = isActive 
            ? "var(--label-color-active)" 
            : "var(--label-color)";
        }
      });
      
      // Update dropdowns
      const dropdowns = document.querySelectorAll(".annoted-dropdown");
      dropdowns.forEach((dropdown) => {
        const dropdownEl = dropdown as HTMLElement;
        dropdownEl.style.setProperty("--icon-color", theme === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)");
        dropdownEl.style.setProperty("--label-color", theme === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.9)");
        dropdownEl.style.setProperty("--hover-bg", theme === "dark" ? "rgba(255, 255, 255, 0.15)" : "rgba(0, 0, 0, 0.08)");
        dropdownEl.style.setProperty("--selected-bg", theme === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.1)");
        
        const dropdownButtons = dropdown.querySelectorAll("button");
        dropdownButtons.forEach((btn) => {
          const icons = btn.querySelectorAll("svg, div[style*='color']");
          icons.forEach((icon) => {
            (icon as HTMLElement).style.color = "var(--icon-color)";
          });
          const labels = btn.querySelectorAll("span");
          labels.forEach((label) => {
            label.style.color = "var(--label-color)";
          });
        });
      });
    };
    
    // Throttled update function
    let themeUpdateTimeout: number | null = null;
    const scheduleThemeUpdate = () => {
      if (themeUpdateTimeout) return;
      themeUpdateTimeout = window.setTimeout(() => {
        updateToolbarTheme();
        themeUpdateTimeout = null;
      }, 100);
    };

    // Vertical toolbar with icons
    const createToolbar = () => {
      const toolbar = document.createElement("div");
      toolbar.id = "annoted-toolbar";
      toolbar.style.cssText = `
        position: fixed;
        top: 50%;
        right: 16px;
        transform: translateY(-50%);
        z-index: 2147483648;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 8px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      // Helper to create icon button with optional label
      const createIconButton = (iconName: string, isActive: boolean, onClick: () => void, onRightClick?: () => void, disabled?: boolean, label?: string) => {
        const btn = document.createElement("button");
        btn.disabled = disabled || false;
        btn.style.cssText = `
          width: 40px;
          min-height: 48px;
          padding: 4px 0;
          border: none;
          background: ${isActive ? "rgba(255, 255, 255, 0.2)" : "transparent"};
          border-radius: 10px;
          cursor: ${disabled ? "not-allowed" : "pointer"};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          color: #ffffff;
          opacity: ${disabled ? 0.5 : 1};
          transition: background-color 120ms ease;
        `;
        
        // Icon container
        const iconContainer = document.createElement("div");
        iconContainer.innerHTML = createIcon(iconName);
        iconContainer.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          color: #ffffff;
        `;
        btn.appendChild(iconContainer);
        
        // Label if provided
        if (label) {
          const labelEl = document.createElement("div");
          labelEl.textContent = label;
          labelEl.style.cssText = `
            font-size: 8px;
            color: rgba(255, 255, 255, 0.75);
            text-align: center;
            line-height: 1;
            margin-top: 2px;
          `;
          btn.appendChild(labelEl);
        }
        
        // Hover effects
        if (!disabled) {
          btn.onmouseenter = () => {
            if (!isActive) {
              btn.style.background = "rgba(255, 255, 255, 0.12)";
            }
          };
          btn.onmouseleave = () => {
            if (!isActive) {
              btn.style.background = "transparent";
            }
          };
        }
        
        btn.onclick = (e) => {
          e.preventDefault();
          if (!disabled) onClick();
        };
        if (onRightClick) {
          btn.oncontextmenu = (e) => {
            e.preventDefault();
            if (!disabled) {
              const rect = btn.getBoundingClientRect();
              onRightClick();
            }
          };
        }
        return btn;
      };

      // Pen tool
      toolbar.appendChild(
        createIconButton("pencil", activeTool === "pen", () => {
          activeTool = activeTool === "pen" ? null : "pen";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          saveSession();
          updateToolbar();
        }, undefined, false, "Pen")
      );

      // Highlighter tool
      toolbar.appendChild(
        createIconButton("highlighter", activeTool === "highlighter", () => {
          activeTool = activeTool === "highlighter" ? null : "highlighter";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          saveSession();
          updateToolbar();
        }, undefined, false, "Highlighter")
      );

      // Pen width selector
      const widthBtn = document.createElement("button");
      widthBtn.title = "Pen Width";
      widthBtn.style.cssText = `
        width: 40px;
        min-height: 48px;
        padding: 4px 0;
        border: none;
        background: transparent;
        border-radius: 10px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        position: relative;
        transition: background-color 120ms ease;
      `;
      widthBtn.onmouseenter = () => {
        widthBtn.style.background = "rgba(255, 255, 255, 0.12)";
      };
      widthBtn.onmouseleave = () => {
        widthBtn.style.background = "transparent";
      };
      // Add visual indicator showing current width
      const widthIndicator = document.createElement("div");
      widthIndicator.style.cssText = `
        width: ${Math.min(penWidth * 2, 20)}px;
        height: ${penWidth}px;
        background: #ffffff;
        border-radius: 2px;
      `;
      widthBtn.appendChild(widthIndicator);
      // Add label
      const widthLabel = document.createElement("div");
      widthLabel.textContent = "Width";
      widthLabel.style.cssText = `
        font-size: 8px;
        color: rgba(255, 255, 255, 0.75);
        text-align: center;
        line-height: 1;
        margin-top: 2px;
      `;
      widthBtn.appendChild(widthLabel);
      widthBtn.oncontextmenu = (e) => {
        e.preventDefault();
        const rect = widthBtn.getBoundingClientRect();
        const widths = [
          { label: "Thin", value: 2 },
          { label: "Medium", value: 4 },
          { label: "Thick", value: 8 },
          { label: "Extra Thick", value: 12 },
        ];
        const items: DropdownItem[] = [];
        widths.forEach((w) => {
          items.push({
            label: `${w.label} (${w.value}px)`,
            width: w.value,
            isSelected: penWidth === w.value,
            onClick: () => {
              penWidth = w.value;
              saveSession();
              updateToolbar();
            },
          });
        });
        createDropdown(rect.left - 130, rect.top, items);
      };
      toolbar.appendChild(widthBtn);

      // Move tool
      toolbar.appendChild(
        createIconButton("move", activeTool === "move", () => {
          activeTool = activeTool === "move" ? null : "move";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          saveSession();
          updateToolbar();
        }, undefined, false, "Move")
      );

      // Shapes tool (grouped)
      const isShapeActive = activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow";
      const shapesBtn = createIconButton(
        "square",
        isShapeActive,
        () => {
            // Left click: toggle last used shape
            if (isShapeActive) {
              activeTool = null;
              if (canvas) {
                canvas.style.pointerEvents = "none";
              }
      } else {
              activeTool = lastUsedShape;
              if (canvas) {
                canvas.style.pointerEvents = "auto";
              }
            }
            saveSession();
            updateToolbar();
        },
        () => {
          // Right click: show shape dropdown
          const rect = shapesBtn.getBoundingClientRect();
            createDropdown(rect.left - 130, rect.top, [
              {
                label: "Rectangle",
                icon: "square",
                isSelected: lastUsedShape === "rectangle",
                onClick: () => {
                  lastUsedShape = "rectangle";
                  activeTool = "rectangle";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  saveSession();
                  updateToolbar();
                },
              },
              {
                label: "Circle",
                icon: "circle",
                isSelected: lastUsedShape === "circle",
                onClick: () => {
                  lastUsedShape = "circle";
                  activeTool = "circle";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  saveSession();
                  updateToolbar();
                },
              },
              {
                label: "Arrow",
                icon: "arrowRight",
                isSelected: lastUsedShape === "arrow",
                onClick: () => {
                  lastUsedShape = "arrow";
                  activeTool = "arrow";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  saveSession();
                  updateToolbar();
                },
              },
              { label: "────────", onClick: () => { closeDropdowns(); } },
              {
                label: shapeMode === "outline" ? "Outline" : "Outline",
                icon: "square",
                isSelected: shapeMode === "outline",
                onClick: () => {
                  shapeMode = "outline";
                  saveSession();
                  updateToolbar();
                },
              },
              {
                label: shapeMode === "filled" ? "Filled" : "Filled",
                icon: "squareFilled",
                isSelected: shapeMode === "filled",
                onClick: () => {
                  shapeMode = "filled";
                  saveSession();
                  updateToolbar();
                },
              },
            ]);
          },
          false,
          "Shapes"
        );
      toolbar.appendChild(shapesBtn);

      // Text tool
      toolbar.appendChild(
        createIconButton("type", activeTool === "text", () => {
          activeTool = activeTool === "text" ? null : "text";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          saveSession();
          updateToolbar();
        }, undefined, false, "Text")
      );

      // Color picker
      const colorBtn = createIconButton("palette", false, () => {
        // Left click: cycle color
        const colors: Color[] = ["red", "blue", "yellow", "white"];
        const currentIndex = colors.indexOf(selectedColor);
        selectedColor = colors[(currentIndex + 1) % colors.length];
        saveSession();
        updateToolbar();
      }, undefined, false, "Color");
      // Color indicator
      const colorIndicator = document.createElement("div");
      colorIndicator.style.cssText = `
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 12px;
        height: 12px;
        background: ${getColorValue(selectedColor)};
        border-radius: 2px;
        border: 1px solid rgba(255, 255, 255, 0.6);
      `;
      colorBtn.style.position = "relative";
      colorBtn.appendChild(colorIndicator);
      colorBtn.oncontextmenu = (e) => {
        e.preventDefault();
        const rect = colorBtn.getBoundingClientRect();
        const colors: Color[] = ["red", "blue", "yellow", "white"];
        const colorLabels: Record<Color, string> = { 
          red: "Red", 
          blue: "Blue", 
          yellow: "Yellow", 
          white: "Black"
        };
        const colorValues: Record<Color, string> = {
          red: "#ff3b30",
          blue: "#007aff",
          yellow: "#ffcc00",
          white: "#000000", // Black for UI
        };
        createDropdown(rect.left - 130, rect.top, colors.map((color) => ({
          label: colorLabels[color],
          color: colorValues[color],
          isSelected: selectedColor === color,
          onClick: () => {
            selectedColor = color;
            saveSession();
            updateToolbar();
          },
        })));
      };
      toolbar.appendChild(colorBtn);

      // Undo button
      toolbar.appendChild(
        createIconButton("undo", false, () => {
          undo();
        }, undefined, undoStack.length === 0, "Undo")
      );

      // Redo button
      toolbar.appendChild(
        createIconButton("redo", false, () => {
          redo();
        }, undefined, redoStack.length === 0, "Redo")
      );

      // Eraser tool
      toolbar.appendChild(
        createIconButton("eraser", activeTool === "eraser", () => {
          activeTool = activeTool === "eraser" ? null : "eraser";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          saveSession();
          updateToolbar();
        }, undefined, false, "Eraser")
      );

      // Clear All button
      toolbar.appendChild(
        createIconButton("trash2", false, () => {
          if (annotations.length === 0 && textAnnotations.length === 0) return;
          
          // Create clear_all command
          const deletedAnnotations = JSON.parse(JSON.stringify(annotations));
          const deletedTexts = JSON.parse(JSON.stringify(textAnnotations));
          
          executeCommand({
            type: "clear_all",
            deletedAnnotations,
            deletedTexts,
          });
          
          annotations.length = 0;
          textAnnotations.length = 0;
    redrawAll();
          updateTextAnnotations();
        }, undefined, false, "Clear")
      );

      // Viewport screenshot button
      toolbar.appendChild(
        createIconButton("camera", false, () => {
          captureViewport();
        }, undefined, false, "Capture")
      );

      // Full page screenshot button
      toolbar.appendChild(
        createIconButton("scan", false, () => {
          showFullPageCaptureModal();
        }, undefined, false, "Full Page")
      );

      // Share button
      toolbar.appendChild(
        createIconButton("share", false, () => {
          showShareModal();
        }, undefined, false, "Share")
      );

      overlay.appendChild(toolbar);
    };

    const updateToolbar = () => {
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) {
        toolbar.remove();
      }
      createToolbar();
    };

    // Hit test for annotations at a point (document coordinates)
    const hitTestAnnotation = (x: number, y: number): { annotation?: Annotation; text?: TextAnnotation } | null => {
      // Check text annotations first (they're on top)
      for (let i = textAnnotations.length - 1; i >= 0; i--) {
        const text = textAnnotations[i];
        const el = document.getElementById(text.id);
        if (el) {
          const rect = el.getBoundingClientRect();
          // Convert viewport coords to document coords for comparison
          const elX = text.x;
          const elY = text.y;
          const elWidth = rect.width;
          const elHeight = rect.height;
          
          if (
            x >= elX &&
            x <= elX + elWidth &&
            y >= elY &&
            y <= elY + elHeight
          ) {
            return { text };
          }
        }
      }
      
      // Check canvas annotations (reverse order for top-most)
      for (let i = annotations.length - 1; i >= 0; i--) {
        const ann = annotations[i];
        
        if (ann.path && ann.path.length > 0) {
          // Check if point is near pen/highlighter path
          for (const point of ann.path) {
            const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
            if (dist < 20) {
              return { annotation: ann };
            }
          }
        } else if (ann.end) {
          // Check if point is inside shape bounding box
          const minX = Math.min(ann.start.x, ann.end.x);
          const maxX = Math.max(ann.start.x, ann.end.x);
          const minY = Math.min(ann.start.y, ann.end.y);
          const maxY = Math.max(ann.start.y, ann.end.y);
          if (x >= minX - 10 && x <= maxX + 10 && y >= minY - 10 && y <= maxY + 10) {
            return { annotation: ann };
          }
        }
      }
      
      return null;
    };

    // Mouse handlers - USE DOCUMENT COORDINATES (pageX/pageY)
    const handleMouseDown = (e: MouseEvent) => {
      if (!activeTool || !canvas || !ctx) return;
      if ((e.target as HTMLElement).closest("#annoted-toolbar")) return;

      // Use pageX/pageY for document coordinates
      const x = e.pageX;
      const y = e.pageY;

      if (activeTool === "eraser") {
        const hit = hitTestAnnotation(x, y);
        if (hit) {
          if (hit.text) {
            executeCommand({
              type: "delete",
              targetId: hit.text.id,
              deletedText: JSON.parse(JSON.stringify(hit.text)),
            });
            const index = textAnnotations.findIndex((t) => t.id === hit.text!.id);
            if (index > -1) {
              textAnnotations.splice(index, 1);
            }
            updateTextAnnotations();
          } else if (hit.annotation) {
            executeCommand({
              type: "delete",
              targetId: hit.annotation.id,
              deletedAnnotation: JSON.parse(JSON.stringify(hit.annotation)),
            });
            const index = annotations.findIndex((a) => a.id === hit.annotation!.id);
            if (index > -1) {
              annotations.splice(index, 1);
            }
            redrawAll();
          }
        }
        return;
      }

      if (activeTool === "text") {
        const id = `text-${Date.now()}`;
        const textAnn: TextAnnotation = { id, x, y, text: "", color: selectedColor };
        executeCommand({ type: "addText", annotation: textAnn });
        updateTextAnnotations();
        const input = document.getElementById(id) as HTMLInputElement;
        if (input) {
          input.focus();
        }
        return;
      }

      if (activeTool === "move") {
        // Check text annotations
        for (let i = textAnnotations.length - 1; i >= 0; i--) {
          const text = textAnnotations[i];
          const el = document.getElementById(text.id);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom
            ) {
              draggingText = {
                id: text.id,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
              };
              moveStartPos = { x: text.x, y: text.y };
              moveStartText = JSON.parse(JSON.stringify(text));
              return;
            }
          }
        }
        // Check canvas annotations (simplified hit test - check last few)
        for (let i = annotations.length - 1; i >= Math.max(0, annotations.length - 5); i--) {
          const ann = annotations[i];
          if (ann.end) {
            const minX = Math.min(ann.start.x, ann.end.x);
            const maxX = Math.max(ann.start.x, ann.end.x);
            const minY = Math.min(ann.start.y, ann.end.y);
            const maxY = Math.max(ann.start.y, ann.end.y);
            if (x >= minX - 10 && x <= maxX + 10 && y >= minY - 10 && y <= maxY + 10) {
              draggingAnnotation = i;
              moveStartPos = { x, y };
              moveStartAnnotation = JSON.parse(JSON.stringify(ann));
              return;
            }
          } else if (ann.path && ann.path.length > 0) {
            // Check if near pen path
            for (const point of ann.path) {
              const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
              if (dist < 20) {
                draggingAnnotation = i;
                moveStartPos = { x, y };
                moveStartAnnotation = JSON.parse(JSON.stringify(ann));
                return;
              }
            }
          }
        }
        return;
      }

      // Start drawing
      isDrawing = true;
      startPoint = { x, y };

      if (activeTool === "pen" || activeTool === "highlighter") {
        currentPath = [{ x, y }];
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas || !ctx) return;

      const x = e.pageX;
      const y = e.pageY;
      
      // Update mouse for handleMouseUp
      mouse = { x, y };

      if (draggingText) {
        const text = textAnnotations.find((t) => t.id === draggingText!.id);
        if (text) {
          // Update position for preview (will be committed on mouseup)
          text.x = x - draggingText.offsetX;
          text.y = y - draggingText.offsetY;
          updateTextAnnotations();
        }
        return;
      }

      if (draggingAnnotation !== null && moveStartPos && moveStartAnnotation) {
        const ann = annotations[draggingAnnotation];
        // Calculate delta from mouse start position
        const dx = x - moveStartPos.x;
        const dy = y - moveStartPos.y;
        
        // Update annotation from original state
        ann.start.x = moveStartAnnotation.start.x + dx;
        ann.start.y = moveStartAnnotation.start.y + dy;
        if (ann.end && moveStartAnnotation.end) {
          ann.end.x = moveStartAnnotation.end.x + dx;
          ann.end.y = moveStartAnnotation.end.y + dy;
        }
        if (ann.path && moveStartAnnotation.path) {
          ann.path = moveStartAnnotation.path.map((p) => ({
            x: p.x + dx,
            y: p.y + dy,
          }));
        }
        redrawAll();
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      if (activeTool === "pen" || activeTool === "highlighter") {
        currentPath.push({ x, y });
        redrawAll();
        // Draw current path in viewport coordinates
        if (ctx) {
          ctx.strokeStyle = getColorValue(selectedColor);
          ctx.lineWidth = penWidth;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          
          if (activeTool === "highlighter") {
            ctx.globalAlpha = 0.35;
      } else {
            ctx.globalAlpha = 1.0;
          }
          
          ctx.beginPath();
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          const firstPoint = currentPath[0];
          ctx.moveTo(firstPoint.x - scrollX, firstPoint.y - scrollY);
          for (let i = 1; i < currentPath.length; i++) {
            const p = currentPath[i];
            ctx.lineTo(p.x - scrollX, p.y - scrollY);
          }
          ctx.stroke();
          ctx.globalAlpha = 1.0; // Reset alpha
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        // Preview shape in viewport coordinates
        redrawAll();
        if (ctx) {
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          const start = { x: startPoint.x - scrollX, y: startPoint.y - scrollY };
          const end = { x: x - scrollX, y: y - scrollY };
          drawShape(ctx, activeTool, start, end, selectedColor, shapeMode, penWidth as any);
        }
      }
    };

    const handleMouseUp = () => {
      if (draggingText && moveStartPos && moveStartText) {
        const text = textAnnotations.find((t) => t.id === draggingText!.id);
        if (text) {
          const newPos = { x: text.x, y: text.y };
          executeCommand({
            type: "moveText",
            id: text.id,
            oldPos: { x: moveStartText.x, y: moveStartText.y },
            newPos: newPos,
          });
          updateTextAnnotations();
        }
        draggingText = null;
        moveStartPos = null;
        moveStartText = null;
        return;
      }

      if (draggingAnnotation !== null && moveStartPos && moveStartAnnotation) {
        const ann = annotations[draggingAnnotation];
        // Capture current state (after move)
        const newStart = { x: ann.start.x, y: ann.start.y };
        const newEnd = ann.end ? { ...ann.end } : undefined;
        const newPath = ann.path ? ann.path.map((p) => ({ ...p })) : undefined;
        
        // Original state from moveStartAnnotation
        const oldStart = { ...moveStartAnnotation.start };
        const oldEnd = moveStartAnnotation.end ? { ...moveStartAnnotation.end } : undefined;
        const oldPath = moveStartAnnotation.path ? moveStartAnnotation.path.map((p) => ({ ...p })) : undefined;
        
        executeCommand({
          type: "moveAnnotation",
          index: draggingAnnotation,
          oldStart,
          oldEnd,
          oldPath,
          newStart,
          newEnd,
          newPath,
        });
        redrawAll();
        draggingAnnotation = null;
        moveStartPos = null;
        moveStartAnnotation = null;
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      const x = mouse.x;
      const y = mouse.y;

      if (activeTool === "pen") {
        if (currentPath.length > 1) {
          const annotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random()}`,
            type: "pen",
            start: currentPath[0],
            path: [...currentPath],
            color: selectedColor,
            penWidth,
          };
          executeCommand({ type: "addPen", annotation });
        }
      } else if (activeTool === "highlighter") {
        if (currentPath.length > 1) {
          const annotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random()}`,
            type: "highlighter",
            start: currentPath[0],
            path: [...currentPath],
            color: selectedColor,
            penWidth,
          };
          executeCommand({ type: "addHighlighter", annotation });
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        const annotation: Annotation = {
          id: `ann-${Date.now()}-${Math.random()}`,
          type: activeTool,
          start: startPoint,
          end: { x, y },
          color: selectedColor,
          shapeMode,
          penWidth,
        };
        executeCommand({ type: "addShape", annotation });
      }

      isDrawing = false;
      startPoint = null;
      currentPath = [];
      redrawAll();
    };

    // Activate annotation mode
    const activate = () => {
      if (isActive) return;
      isActive = true;

      createCanvas();
      
      // Check for shared annotations in URL hash first
      const restoredFromUrl = restoreFromUrl();
      
      if (!restoredFromUrl) {
        // Load session from localStorage if no URL share
        const session = loadSession();
        if (session.actions.length > 0) {
          undoStack = session.actions;
          replayCommands(undoStack);
        }
        
        // Restore tool state if available
        if (session.toolState) {
          const ts = session.toolState;
          if (ts.color) selectedColor = ts.color;
          if (ts.penWidth) penWidth = ts.penWidth;
          if (ts.shapeType) lastUsedShape = ts.shapeType;
          if (ts.shapeFillMode) shapeMode = ts.shapeFillMode;
          // Restore active tool if it was set
          if (ts.activeTool !== undefined && ts.activeTool !== null) {
            activeTool = ts.activeTool;
          }
        }
      }
      
      createToolbar();

      if (!canvas || !ctx) return;

      // Enable pointer events
      overlay.style.pointerEvents = "auto";
      // Set canvas pointer events based on restored active tool
      canvas.style.pointerEvents = activeTool ? "auto" : "none";

      // Track mouse for coordinates (document coordinates)
      canvas.addEventListener("mousemove", (e) => {
        mouse.x = e.pageX;
        mouse.y = e.pageY;
      }, false);

      // Attach mouse events
      canvas.addEventListener("mousedown", handleMouseDown);
      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseup", handleMouseUp);
      canvas.addEventListener("mouseleave", handleMouseUp);
      
      // Update text positions on scroll
      const handleTextScroll = () => {
        updateTextAnnotations();
      };
      window.addEventListener("scroll", handleTextScroll, { passive: true });
    };

    // Deactivate annotation mode
    const deactivate = () => {
      if (!isActive) return;
      isActive = false;

      if (canvas) {
        canvas.remove();
        canvas = null;
      }
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) toolbar.remove();
      const oldTexts = overlay.querySelectorAll(".annoted-text");
      oldTexts.forEach((el) => el.remove());

      overlay.style.pointerEvents = "none";
    };

    // Handle resize - canvas stays viewport-sized
    const handleResize = () => {
      if (!isActive || !canvas || !ctx) return;

      // Canvas is viewport-sized, just update dimensions
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      ctx.putImageData(imageData, 0, 0);
      redrawAll();
    };

    window.addEventListener("resize", handleResize);

    // Keyboard shortcuts removed - toolbar buttons are the only way to change tools

    // Helper: Wait for browser repaint and layout flush
    const waitForRepaint = async (delayMs: number = 150): Promise<void> => {
      // Wait for two animation frames to ensure repaint
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      
      // Force layout read to flush any pending layout changes
      document.body.getBoundingClientRect();
      
      // Additional delay to ensure visibility changes are applied
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    };

    // Helper: Detach overlay from render tree for first screenshot (compositor-level fix)
    const detachOverlayForFirstCapture = (): {
      overlayDisplay: string;
      canvasDisplay: string;
    } => {
      const overlayEl = document.getElementById("annoted-overlay");
      const canvasEl = document.getElementById("canvas-draw");
      
      const original = {
        overlayDisplay: overlayEl ? overlayEl.style.display || "" : "",
        canvasDisplay: canvasEl ? canvasEl.style.display || "" : "",
      };

      // Use display:none to completely remove from render tree
      if (overlayEl) {
        overlayEl.style.display = "none";
      }
      if (canvasEl) {
        canvasEl.style.display = "none";
      }

      return original;
    };

    // Helper: Restore overlay to render tree
    const restoreOverlayAfterFirstCapture = (original: {
      overlayDisplay: string;
      canvasDisplay: string;
    }) => {
      const overlayEl = document.getElementById("annoted-overlay");
      const canvasEl = document.getElementById("canvas-draw");

      if (overlayEl) {
        if (original.overlayDisplay) {
          overlayEl.style.display = original.overlayDisplay;
        } else {
          overlayEl.style.removeProperty("display");
        }
      }
      
      if (canvasEl) {
        if (original.canvasDisplay) {
          canvasEl.style.display = original.canvasDisplay;
        } else {
          canvasEl.style.removeProperty("display");
        }
      }
    };

    // Helper: Extended settling phase for first screenshot only
    const waitForFirstCaptureSettling = async (): Promise<{
      originalBackground: string;
      overlayState: { overlayDisplay: string; canvasDisplay: string };
    }> => {
      // Detach overlay from render tree (compositor-level fix)
      const overlayState = detachOverlayForFirstCapture();
      
      // Triple requestAnimationFrame for thorough repaint
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      
      // Extended delay for compositor to fully remove overlay
      await new Promise((resolve) => setTimeout(resolve, 300));
      
      // Force layout flush
      document.documentElement.offsetHeight;
      
      // Temporarily set white background to prevent blending artifacts
      const originalBackground = document.documentElement.style.background || "";
      document.documentElement.style.background = "#ffffff";
      
      // Wait for background change to apply
      await new Promise((resolve) => requestAnimationFrame(resolve));
      
      return { originalBackground, overlayState };
    };

    // Helper: Restore background after first capture
    const restoreBackground = (originalBackground: string) => {
      if (originalBackground) {
        document.documentElement.style.background = originalBackground;
      } else {
        document.documentElement.style.removeProperty("background");
      }
    };

    // Helper: Hide scrollbar during capture
    const hideScrollbar = (): {
      scrollbarWidth: string;
      msOverflowStyle: string;
      overflow: string;
    } => {
      const style = document.documentElement.style;
      const original = {
        scrollbarWidth: style.scrollbarWidth || "",
        msOverflowStyle: (style as any).msOverflowStyle || "",
        overflow: style.overflow || "",
      };

      style.scrollbarWidth = "none";
      (style as any).msOverflowStyle = "none";
      style.overflow = "hidden";

      return original;
    };

    // Helper: Restore scrollbar
    const restoreScrollbar = (original: {
      scrollbarWidth: string;
      msOverflowStyle: string;
      overflow: string;
    }) => {
      const style = document.documentElement.style;
      
      if (original.scrollbarWidth) {
        style.scrollbarWidth = original.scrollbarWidth;
      } else {
        style.removeProperty("scrollbar-width");
      }

      if (original.msOverflowStyle) {
        (style as any).msOverflowStyle = original.msOverflowStyle;
      } else {
        style.removeProperty("-ms-overflow-style");
      }

      if (original.overflow) {
        style.overflow = original.overflow;
      } else {
        style.removeProperty("overflow");
      }
    };

    // Helper: Ensure annotation canvas is visible and ready for capture
    const ensureCanvasVisible = () => {
      if (canvas) {
        canvas.style.visibility = "visible";
        canvas.style.opacity = "1";
        // Ensure canvas is above page content
        if (canvas.parentElement) {
          canvas.parentElement.style.zIndex = "2147483647";
        }
      }
    };

    // Helper: Detect and store sticky/fixed elements (excluding Annoted)
    const detectStickyFixedElements = (): HTMLElement[] => {
      const stickyFixedElements: HTMLElement[] = [];
      const allElements = document.querySelectorAll("*");

      allElements.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;

        // Skip Annoted elements
        if (
          el.id === "annoted-overlay" ||
          el.id === "annoted-canvas" ||
          el.id === "annoted-toolbar" ||
          el.id?.startsWith("annoted-")
        ) {
          return;
        }

        // Check computed style for fixed/sticky positioning
        const computedStyle = window.getComputedStyle(el);
        const position = computedStyle.position;

        if (position === "fixed" || position === "sticky") {
          stickyFixedElements.push(el);
        }
      });

      return stickyFixedElements;
    };

    // Helper: Hide Annoted UI elements only
    const hideAnnotedUI = (): Array<{ element: HTMLElement; originalVisibility: string }> => {
      const hiddenElements: Array<{ element: HTMLElement; originalVisibility: string }> = [];

      // Hide Annoted toolbar
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) {
        hiddenElements.push({
          element: toolbar,
          originalVisibility: toolbar.style.visibility || "",
        });
        toolbar.style.visibility = "hidden";
      }

      // Hide any open dropdowns
      const dropdowns = document.querySelectorAll('[id^="annoted-dropdown"]');
      dropdowns.forEach((dropdown) => {
        if (dropdown instanceof HTMLElement) {
          hiddenElements.push({
            element: dropdown,
            originalVisibility: dropdown.style.visibility || "",
          });
          dropdown.style.visibility = "hidden";
        }
      });

      // Hide capture modal if present
      const modal = document.getElementById("annoted-capture-modal");
      if (modal) {
        hiddenElements.push({
          element: modal,
          originalVisibility: modal.style.visibility || "",
        });
        modal.style.visibility = "hidden";
      }

      // Hide backdrop if present
      const backdrop = document.querySelector('[style*="background: rgba(0,0,0,0.3)"]');
      if (backdrop && backdrop instanceof HTMLElement) {
        hiddenElements.push({
          element: backdrop,
          originalVisibility: backdrop.style.visibility || "",
        });
        backdrop.style.visibility = "hidden";
      }

      return hiddenElements;
    };

    // Helper: Detect and store sidebar elements (excluding Annoted)
    const detectSidebars = (): HTMLElement[] => {
      const sidebars: HTMLElement[] = [];
      const allElements = document.querySelectorAll("*");

      allElements.forEach((el) => {
        if (!(el instanceof HTMLElement)) return;

        // Skip Annoted elements
        if (
          el.id === "annoted-overlay" ||
          el.id === "annoted-canvas" ||
          el.id === "annoted-toolbar" ||
          el.id?.startsWith("annoted-")
        ) {
          return;
        }

        // Check for sidebar patterns
        let isSidebar = false;

        // Check role attribute
        const role = el.getAttribute("role");
        if (role === "navigation") {
          isSidebar = true;
        }

        // Check semantic HTML
        if (el.tagName.toLowerCase() === "aside") {
          isSidebar = true;
        }

        // Check class names
        const className = el.className?.toLowerCase() || "";
        if (
          className.includes("sidebar") ||
          className.includes("sidenav") ||
          className.includes("nav-drawer") ||
          className.includes("side-nav") ||
          className.includes("side-bar")
        ) {
          isSidebar = true;
        }

        // Check ID
        const id = el.id?.toLowerCase() || "";
        if (
          id.includes("sidebar") ||
          id.includes("sidenav") ||
          id.includes("nav-drawer") ||
          id.includes("side-nav") ||
          id.includes("side-bar")
        ) {
          isSidebar = true;
        }

        if (isSidebar) {
          sidebars.push(el);
        }
      });

      return sidebars;
    };

    // Helper: Hide sticky/fixed website elements
    const hideStickyFixedElements = (
      stickyFixedElements: HTMLElement[]
    ): Array<{ element: HTMLElement; originalVisibility: string }> => {
      const hiddenElements: Array<{ element: HTMLElement; originalVisibility: string }> = [];

      stickyFixedElements.forEach((el) => {
        // Only hide if it's not already hidden
        const currentVisibility = el.style.visibility || "";
        if (currentVisibility !== "hidden") {
          hiddenElements.push({
            element: el,
            originalVisibility: currentVisibility,
          });
          el.style.visibility = "hidden";
        }
      });

      return hiddenElements;
    };

    // Helper: Hide sidebar elements
    const hideSidebars = (
      sidebars: HTMLElement[]
    ): Array<{ element: HTMLElement; originalVisibility: string }> => {
      const hiddenElements: Array<{ element: HTMLElement; originalVisibility: string }> = [];

      sidebars.forEach((el) => {
        // Only hide if it's not already hidden
        const currentVisibility = el.style.visibility || "";
        if (currentVisibility !== "hidden") {
          hiddenElements.push({
            element: el,
            originalVisibility: currentVisibility,
          });
          el.style.visibility = "hidden";
        }
      });

      return hiddenElements;
    };

    // Helper: Restore elements after capture
    const restoreElementsAfterCapture = (
      hiddenElements: Array<{ element: HTMLElement; originalVisibility: string }>
    ) => {
      hiddenElements.forEach(({ element, originalVisibility }) => {
        if (element && element.isConnected) {
          if (originalVisibility) {
            element.style.visibility = originalVisibility;
          } else {
            element.style.removeProperty("visibility");
          }
        }
      });
    };

    // Capture current viewport with annotations
    const captureViewport = async () => {
      // Hide Annoted UI only (keep sticky/fixed headers visible for viewport capture)
      const hiddenAnnotedUI = hideAnnotedUI();
      try {
        // Wait for UI to hide and browser to repaint
        await waitForRepaint(150);

        // Request screenshot from background script
        chrome.runtime.sendMessage(
          { action: "captureVisibleTab" },
          (response) => {
            // Restore UI immediately after capture
            restoreElementsAfterCapture(hiddenAnnotedUI);

            if (chrome.runtime.lastError) {
              console.error("[Annoted] Screenshot error:", chrome.runtime.lastError);
              return;
            }
            if (response?.dataUrl) {
              // Download the screenshot
              const link = document.createElement("a");
              link.href = response.dataUrl;
              link.download = `annoted-viewport-${Date.now()}.png`;
              link.click();
            }
          }
        );
      } catch (error) {
        console.error("[Annoted] Viewport capture error:", error);
        restoreElementsAfterCapture(hiddenAnnotedUI);
      }
    };

    // Show full page capture modal
    const showFullPageCaptureModal = () => {
      // Create modal
      const modal = document.createElement("div");
      modal.id = "annoted-capture-modal";
      modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border-radius: 12px;
        padding: 24px;
        z-index: 2147483650;
        pointer-events: auto;
        min-width: 300px;
        font-family: Arial, sans-serif;
      `;

      const title = document.createElement("div");
      title.textContent = "Full Page Capture";
      title.style.cssText = `
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 16px;
        color: #000;
      `;
      modal.appendChild(title);

      const formatLabel = document.createElement("div");
      formatLabel.textContent = "Export Format:";
      formatLabel.style.cssText = `
        font-size: 14px;
        margin-bottom: 8px;
        color: #666;
      `;
      modal.appendChild(formatLabel);

      let selectedFormat: "png" | "pdf" = "png";

      const formatContainer = document.createElement("div");
      formatContainer.style.cssText = `
        display: flex;
        gap: 8px;
        margin-bottom: 20px;
      `;

      const pngBtn = document.createElement("button");
      pngBtn.textContent = "PNG";
      pngBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        border: 2px solid #000;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      `;
      pngBtn.onclick = () => {
        selectedFormat = "png";
        pngBtn.style.borderColor = "#000";
        pngBtn.style.background = "#f0f0f0";
        pdfBtn.style.borderColor = "#ccc";
        pdfBtn.style.background = "white";
      };
      // Set initial state
      selectedFormat = "png";
      pngBtn.style.borderColor = "#000";
      pngBtn.style.background = "#f0f0f0";

      const pdfBtn = document.createElement("button");
      pdfBtn.textContent = "PDF";
      pdfBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        border: 2px solid #ccc;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      `;
      pdfBtn.onclick = () => {
        selectedFormat = "pdf";
        pdfBtn.style.borderColor = "#000";
        pdfBtn.style.background = "#f0f0f0";
        pngBtn.style.borderColor = "#ccc";
        pngBtn.style.background = "white";
      };

      formatContainer.appendChild(pngBtn);
      formatContainer.appendChild(pdfBtn);
      modal.appendChild(formatContainer);

      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      `;

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = `
        padding: 10px 20px;
        border: 1px solid #ccc;
        background: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      `;
      cancelBtn.onclick = () => {
        modal.remove();
      };

      const captureBtn = document.createElement("button");
      captureBtn.textContent = "Capture";
      captureBtn.style.cssText = `
        padding: 10px 20px;
        border: none;
        background: #000;
        color: white;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
      `;
      captureBtn.onclick = () => {
        modal.remove();
        captureFullPage(selectedFormat);
      };

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(captureBtn);
      modal.appendChild(buttonContainer);

      // Close on outside click
      const backdrop = document.createElement("div");
      backdrop.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0,0,0,0.3);
        z-index: 2147483649;
        pointer-events: auto;
      `;
      backdrop.onclick = () => {
        modal.remove();
        backdrop.remove();
      };

      overlay.appendChild(backdrop);
      overlay.appendChild(modal);
    };

    // Capture full page with scrolling and stitching (called from modal)
    const captureFullPage = async (format: "png" | "pdf") => {
      // Detect elements once before capture
      const stickyFixedElements = detectStickyFixedElements();
      const sidebars = detectSidebars();
      
      // Hide Annoted UI before capture
      const hiddenAnnotedUI = hideAnnotedUI();
      
      // Hide sidebars before capture (they should never appear)
      const hiddenSidebars = hideSidebars(sidebars);
      
      // Hide scrollbar during capture
      const originalScrollbar = hideScrollbar();
      
      // Ensure annotation canvas is visible and ready
      ensureCanvasVisible();
      
      // Wait for elements to hide and browser to repaint
      await waitForRepaint(150);
      
      // Show loading indicator (will be hidden during actual capture)
      const loading = document.createElement("div");
      loading.id = "annoted-capture-loading";
      loading.textContent = "Capturing full page...";
      loading.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0,0,0,0.8);
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        z-index: 2147483651;
    pointer-events: none;
        font-family: Arial, sans-serif;
        font-size: 14px;
        visibility: hidden;
      `;
      overlay.appendChild(loading);
      
      // Show loading indicator initially
      loading.style.visibility = "visible";

      // Track background and overlay state for safety restoration
      let firstCaptureBackground = "";
      let firstCaptureOverlayState: { overlayDisplay: string; canvasDisplay: string } | null = null;

      try {

        // Get page dimensions
        const pageWidth = Math.max(
          document.body.scrollWidth,
          document.body.offsetWidth,
          document.documentElement.clientWidth,
          document.documentElement.scrollWidth,
          document.documentElement.offsetWidth
        );
        const pageHeight = Math.max(
          document.body.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.clientHeight,
          document.documentElement.scrollHeight,
          document.documentElement.offsetHeight
        );
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Calculate number of slices needed
        const slicesX = Math.ceil(pageWidth / viewportWidth);
        const slicesY = Math.ceil(pageHeight / viewportHeight);
        const totalSlices = slicesX * slicesY;

        const slices: string[] = [];
        let currentSlice = 0;

        // Save original scroll position
        const originalScrollY = window.scrollY;
        const originalScrollX = window.scrollX;

        // Capture slices
        let hiddenStickyElements: Array<{ element: HTMLElement; originalVisibility: string }> = [];
        let firstCaptureOverlayState: { overlayDisplay: string; canvasDisplay: string } | null = null;
        
        for (let y = 0; y < slicesY; y++) {
          for (let x = 0; x < slicesX; x++) {
            const scrollX = Math.min(x * viewportWidth, pageWidth - viewportWidth);
            const scrollY = Math.min(y * viewportHeight, pageHeight - viewportHeight);

            // Scroll to position
            window.scrollTo(scrollX, scrollY);
            
            // Wait for scroll to complete with proper repaint timing
            await waitForRepaint(150);
            
            // Ensure canvas is visible before redrawing
            ensureCanvasVisible();
            
            // Redraw annotations after scroll
            redrawAll();
            updateTextAnnotations();
            
            // Wait for annotations to render
            await waitForRepaint(100);

            // For first slice (top-left): Keep sticky/fixed elements visible
            // For subsequent slices: Hide sticky/fixed elements to prevent repetition
            const isFirstSlice = y === 0 && x === 0;
            let originalBackground = "";
            
            if (isFirstSlice) {
              // First slice: Restore sticky/fixed elements if they were hidden
              restoreElementsAfterCapture(hiddenStickyElements);
              hiddenStickyElements = [];
              // Wait for elements to restore
              await waitForRepaint(150);
              
              // Extended settling phase for first capture only
              const backgroundState = await waitForFirstCaptureSettling();
              originalBackground = backgroundState.originalBackground;
            } else {
              // Subsequent slices: Hide sticky/fixed elements
              if (hiddenStickyElements.length === 0) {
                hiddenStickyElements = hideStickyFixedElements(stickyFixedElements);
                // Wait for elements to hide
                await waitForRepaint(150);
              }
            }

            // Hide loading indicator during capture
            loading.style.visibility = "hidden";
            
            // Final wait and layout flush before capture (subsequent captures only)
            await waitForRepaint(100);

            // Capture this slice
            const sliceDataUrl = await new Promise<string>((resolve, reject) => {
              chrome.runtime.sendMessage(
                { action: "captureVisibleTab" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  if (response?.dataUrl) {
                    resolve(response.dataUrl);
                  } else {
                    reject(new Error("Failed to capture slice"));
                  }
                }
              );
            });

            slices.push(sliceDataUrl);
            currentSlice++;
            
            // Update loading text and show briefly (then hide for next capture)
            loading.textContent = `Capturing... ${currentSlice}/${totalSlices}`;
            loading.style.visibility = "visible";
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        // Restore sticky/fixed elements after all captures
        restoreElementsAfterCapture(hiddenStickyElements);
        
        // Restore sidebars after all captures
        restoreElementsAfterCapture(hiddenSidebars);

        // Restore original scroll position
        window.scrollTo(originalScrollX, originalScrollY);
        await new Promise((resolve) => setTimeout(resolve, 100));
        redrawAll();
        updateTextAnnotations();

        // Remove loading indicator
        loading.remove();

        // Stitch slices together
        const stitchedImage = await stitchImages(slices, slicesX, slicesY, viewportWidth, viewportHeight, pageWidth, pageHeight);

        // Export based on format
        if (format === "pdf") {
          await exportAsPDF(stitchedImage, pageWidth, pageHeight);
    } else {
          downloadImage(stitchedImage, "annoted-fullpage");
        }
      } catch (error) {
        console.error("[Annoted] Full page capture error:", error);
        // Fallback to viewport capture
        alert("Full page capture failed. Falling back to viewport capture.");
        captureViewport();
      } finally {
        // Always restore overlay (safety measure - in case first capture failed)
        if (firstCaptureOverlayState) {
          restoreOverlayAfterFirstCapture(firstCaptureOverlayState);
        }
        // Always restore background (safety measure)
        if (firstCaptureBackground !== undefined && firstCaptureBackground !== "") {
          restoreBackground(firstCaptureBackground);
        }
        // Always restore scrollbar
        restoreScrollbar(originalScrollbar);
        // Always restore Annoted UI elements
        restoreElementsAfterCapture(hiddenAnnotedUI);
        // Always restore sidebars
        restoreElementsAfterCapture(hiddenSidebars);
        // Remove loading if still present
        const loadingEl = document.getElementById("annoted-capture-loading");
        if (loadingEl) loadingEl.remove();
      }
    };

    // Stitch image slices together
    const stitchImages = async (
      slices: string[],
      slicesX: number,
      slicesY: number,
      viewportWidth: number,
      viewportHeight: number,
      pageWidth: number,
      pageHeight: number
    ): Promise<string> => {
      return new Promise((resolve, reject) => {
        // Create offscreen canvas for stitching
        const canvas = document.createElement("canvas");
        canvas.width = pageWidth;
        canvas.height = pageHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to create canvas context"));
          return;
        }

        let loadedCount = 0;
        const images: HTMLImageElement[] = [];

        slices.forEach((dataUrl, index) => {
          const img = new Image();
          img.onload = () => {
            images[index] = img;
            loadedCount++;

            if (loadedCount === slices.length) {
              // All images loaded, stitch them
              let sliceIndex = 0;
              for (let y = 0; y < slicesY; y++) {
                for (let x = 0; x < slicesX; x++) {
                  const img = images[sliceIndex];
                  const destX = x * viewportWidth;
                  const destY = y * viewportHeight;
                  
                  // Calculate actual dimensions for last slices
                  const sliceWidth = x === slicesX - 1 ? pageWidth - destX : viewportWidth;
                  const sliceHeight = y === slicesY - 1 ? pageHeight - destY : viewportHeight;

                  ctx.drawImage(img, 0, 0, img.width, img.height, destX, destY, sliceWidth, sliceHeight);
                  sliceIndex++;
                }
              }

              // Convert to data URL
              resolve(canvas.toDataURL("image/png", 1.0));
            }
          };
          img.onerror = () => {
            reject(new Error(`Failed to load slice ${index}`));
          };
          img.src = dataUrl;
        });
      });
    };

    // Export as PDF using jsPDF
    const exportAsPDF = async (imageDataUrl: string, width: number, height: number) => {
      try {
        // Dynamic import of jsPDF
        const { jsPDF } = await import("jspdf");
        
        // Calculate PDF dimensions (A4 ratio or maintain aspect)
        const pdfWidth = 210; // A4 width in mm
        const aspectRatio = height / width;
        const pdfHeight = pdfWidth * aspectRatio;

        const pdf = new jsPDF({
          orientation: pdfHeight > pdfWidth ? "portrait" : "landscape",
          unit: "mm",
          format: [pdfWidth, pdfHeight],
        });

        // Add image to PDF
        pdf.addImage(imageDataUrl, "PNG", 0, 0, pdfWidth, pdfHeight, undefined, "FAST");

        // Download PDF
        const filename = `annoted-fullpage-${Date.now()}.pdf`;
        pdf.save(filename);
      } catch (error) {
        console.error("[Annoted] PDF export error:", error);
        // Fallback to PNG
        downloadImage(imageDataUrl, "annoted-fullpage");
      }
    };

    // Download image helper
    const downloadImage = (dataUrl: string, prefix: string) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${prefix}-${Date.now()}.png`;
      link.click();
    };

    // Listen for activation message
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "toggle") {
        if (isActive) {
          deactivate();
    } else {
          activate();
        }
        sendResponse({ active: isActive });
      } else if (message.action === "captureFullPage") {
        // Handle full page capture request from background
        const { pageWidth, pageHeight, viewportWidth, viewportHeight } = message;
        captureFullPageInternal(pageWidth, pageHeight, viewportWidth, viewportHeight)
          .then((result) => {
            chrome.runtime.sendMessage({
              action: "fullPageCaptureResult",
              screenshotData: result.dataUrl,
              isPDF: result.isPDF,
            });
          })
          .catch((error) => {
            chrome.runtime.sendMessage({
              action: "fullPageCaptureResult",
              error: error.message,
            });
          });
        sendResponse({ success: true });
      } else if (message.action === "getCanvasData") {
        // Return canvas data for compositing (if needed)
        if (canvas) {
          sendResponse({ canvasData: canvas.toDataURL("image/png") });
        } else {
          sendResponse({ canvasData: null });
        }
      }
      return true;
    });

    // Inject fallback script for non-installed users
    const injectFallbackScript = () => {
      // Only inject if there's an annoted= hash
      if (!window.location.hash.includes("annoted=")) return;

      const script = document.createElement("script");
      script.textContent = `
        (function() {
          setTimeout(function() {
            if (typeof window.__ANNOTED_INSTALLED__ === 'undefined') {
              // Extension not installed, redirect to Chrome Web Store
              const hash = window.location.hash;
              const match = hash.match(/annoted=([^&]+)/);
              if (match) {
                // Preserve the original URL
                const originalUrl = window.location.href;
                // Redirect to Chrome Web Store (update with actual store URL)
                window.location.href = 'https://chrome.google.com/webstore/detail/annoted/YOUR_EXTENSION_ID?utm_source=share&url=' + encodeURIComponent(originalUrl);
              }
            }
          }, 300);
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove(); // Clean up after injection
    };

    // Inject fallback script on page load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectFallbackScript);
    } else {
      injectFallbackScript();
    }

    // Internal full page capture (called from background or modal)
    const captureFullPageInternal = async (
      pageWidth: number,
      pageHeight: number,
      viewportWidth: number,
      viewportHeight: number
    ): Promise<{ dataUrl: string; isPDF: boolean }> => {
      // Detect elements once before capture
      const stickyFixedElements = detectStickyFixedElements();
      const sidebars = detectSidebars();
      
      // Hide Annoted UI before capture
      const hiddenAnnotedUI = hideAnnotedUI();
      
      // Hide sidebars before capture (they should never appear)
      const hiddenSidebars = hideSidebars(sidebars);
      
      // Hide scrollbar during capture
      const originalScrollbar = hideScrollbar();
      
      // Ensure annotation canvas is visible and ready
      ensureCanvasVisible();
      
      // Wait for elements to hide and browser to repaint
      await waitForRepaint(150);
      
      // Track background and overlay state for safety restoration
      let firstCaptureBackground = "";
      let firstCaptureOverlayState: { overlayDisplay: string; canvasDisplay: string } | null = null;
      
      try {
        // Save original scroll position
        const originalScrollY = window.scrollY;
        const originalScrollX = window.scrollX;

        // Calculate number of slices needed
        const slicesX = Math.ceil(pageWidth / viewportWidth);
        const slicesY = Math.ceil(pageHeight / viewportHeight);
        const totalSlices = slicesX * slicesY;

        const slices: string[] = [];
        let hiddenStickyElements: Array<{ element: HTMLElement; originalVisibility: string }> = [];
        let firstCaptureOverlayState: { overlayDisplay: string; canvasDisplay: string } | null = null;

        // Capture slices
        for (let y = 0; y < slicesY; y++) {
          for (let x = 0; x < slicesX; x++) {
            const scrollX = Math.min(x * viewportWidth, pageWidth - viewportWidth);
            const scrollY = Math.min(y * viewportHeight, pageHeight - viewportHeight);

            // Scroll to position
            window.scrollTo(scrollX, scrollY);
            
            // Wait for scroll to complete with proper repaint timing
            await waitForRepaint(150);
            
            // Ensure canvas is visible before redrawing
            ensureCanvasVisible();
            
            // Redraw annotations after scroll
            redrawAll();
            updateTextAnnotations();
            
            // Wait for annotations to render
            await waitForRepaint(100);

            // For first slice (top-left): Keep sticky/fixed elements visible
            // For subsequent slices: Hide sticky/fixed elements to prevent repetition
            const isFirstSlice = y === 0 && x === 0;
            let originalBackground = "";
            
            if (isFirstSlice) {
              // First slice: Restore sticky/fixed elements if they were hidden
              restoreElementsAfterCapture(hiddenStickyElements);
              hiddenStickyElements = [];
              // Wait for elements to restore
              await waitForRepaint(150);
              
              // Extended settling phase for first capture only (detaches overlay from render tree)
              const settlingState = await waitForFirstCaptureSettling();
              originalBackground = settlingState.originalBackground;
              firstCaptureBackground = originalBackground; // Track for safety restoration
              
              // Store overlay state for restoration
              const overlayState = settlingState.overlayState;
              firstCaptureOverlayState = overlayState; // Track for safety restoration
              
              // Minimal final wait before first capture
              await waitForRepaint(50);

              // Capture first slice
              const sliceDataUrl = await new Promise<string>((resolve, reject) => {
                chrome.runtime.sendMessage(
                  { action: "captureVisibleTab" },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                      return;
                    }
                    if (response?.dataUrl) {
                      resolve(response.dataUrl);
                    } else {
                      reject(new Error("Failed to capture slice"));
                    }
                  }
                );
              });

              slices.push(sliceDataUrl);
              
              // Restore overlay immediately after first capture
              restoreOverlayAfterFirstCapture(overlayState);
              firstCaptureOverlayState = null; // Clear after successful restoration
              
              // Restore background immediately after first capture
              if (originalBackground !== undefined) {
                restoreBackground(originalBackground);
              }
              
              // Ensure canvas is visible again for subsequent operations
              ensureCanvasVisible();
              
              // Continue to next iteration
              continue;
            } else {
              // Subsequent slices: Hide sticky/fixed elements
              if (hiddenStickyElements.length === 0) {
                hiddenStickyElements = hideStickyFixedElements(stickyFixedElements);
                // Wait for elements to hide
                await waitForRepaint(150);
              }
            }

            // Final wait and layout flush before capture
            // Use shorter delay for subsequent captures
            if (isFirstSlice) {
              // First capture already has extended settling, minimal final wait
              await waitForRepaint(50);
            } else {
              // Subsequent captures use normal timing
              await waitForRepaint(100);
            }

            // Capture this slice
            const sliceDataUrl = await new Promise<string>((resolve, reject) => {
              chrome.runtime.sendMessage(
                { action: "captureVisibleTab" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                  }
                  if (response?.dataUrl) {
                    resolve(response.dataUrl);
                  } else {
                    reject(new Error("Failed to capture slice"));
                  }
                }
              );
            });

            slices.push(sliceDataUrl);
          }
        }

        // Restore sticky/fixed elements after all captures
        restoreElementsAfterCapture(hiddenStickyElements);
        
        // Restore sidebars after all captures
        restoreElementsAfterCapture(hiddenSidebars);

        // Restore original scroll position
        window.scrollTo(originalScrollX, originalScrollY);
        await new Promise((resolve) => setTimeout(resolve, 100));
        redrawAll();
        updateTextAnnotations();

        // Stitch slices together
        const stitchedImage = await stitchImages(slices, slicesX, slicesY, viewportWidth, viewportHeight, pageWidth, pageHeight);

        return { dataUrl: stitchedImage, isPDF: false };
      } finally {
        // Always restore overlay (safety measure - in case first capture failed)
        if (firstCaptureOverlayState) {
          restoreOverlayAfterFirstCapture(firstCaptureOverlayState);
        }
        // Always restore background (safety measure)
        if (firstCaptureBackground !== undefined && firstCaptureBackground !== "") {
          restoreBackground(firstCaptureBackground);
        }
        // Always restore scrollbar
        restoreScrollbar(originalScrollbar);
        // Always restore Annoted UI elements
        restoreElementsAfterCapture(hiddenAnnotedUI);
        // Always restore sidebars
        restoreElementsAfterCapture(hiddenSidebars);
      }
    };
  },
});
