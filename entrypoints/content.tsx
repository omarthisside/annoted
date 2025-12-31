import React from "react";
import { createRoot } from "react-dom/client";
import { defineContentScript } from "wxt/sandbox";
import { Toolbar } from "../components/Toolbar";
import type { Tool, Color, ShapeMode, PenWidth } from "../utils/types";
import { drawShape, drawLine, drawHighlighter, drawHighlighterPath, drawText, getColorValue } from "../utils/canvas";
import { jsPDF } from "jspdf";
import "../styles/global.css";

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let redrawAllRef: (() => void) | null = null;

// Store all completed drawings
const drawingHistory: Array<{
      type: "pen" | "highlighter" | "shape" | "text";
  tool: Tool;
  start: { x: number; y: number };
  end?: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  color: Color;
  shapeMode?: ShapeMode;
      penWidth?: PenWidth;
      text?: string;
}> = [];

    // Track current position in history for undo/redo
    // historyIndex represents how many items to show (0 = none, length = all)
    let historyIndex: number | null = null; // null means showing all items

    // localStorage utilities
    const getStorageKey = () => {
      // Use the full URL as the key so each page has its own annotations
      return `proofly-annotations-${window.location.href}`;
    };

    const saveToLocalStorage = () => {
      try {
        const storageKey = getStorageKey();
        const data = {
          drawingHistory: drawingHistory,
          historyIndex: historyIndex,
          timestamp: Date.now()
        };
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log("[Content] Saved annotations to localStorage:", drawingHistory.length, "items");
      } catch (error) {
        console.error("[Content] Failed to save to localStorage:", error);
      }
    };

    const loadFromLocalStorage = () => {
      try {
        const storageKey = getStorageKey();
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.drawingHistory && Array.isArray(data.drawingHistory)) {
            // Clear current history and load saved
            drawingHistory.length = 0;
            drawingHistory.push(...data.drawingHistory);
            historyIndex = data.historyIndex !== undefined ? data.historyIndex : null;
            console.log("[Content] Loaded annotations from localStorage:", drawingHistory.length, "items");
            return true;
          }
        }
      } catch (error) {
        console.error("[Content] Failed to load from localStorage:", error);
      }
      return false;
    };

    // Pen width localStorage utilities (global preference, not page-specific)
    const savePenWidthToLocalStorage = (width: PenWidth) => {
      try {
        localStorage.setItem("proofly-pen-width", JSON.stringify(width));
        console.log("[Content] Saved pen width to localStorage:", width);
      } catch (error) {
        console.error("[Content] Failed to save pen width to localStorage:", error);
      }
    };

    const loadPenWidthFromLocalStorage = (): PenWidth => {
      try {
        const saved = localStorage.getItem("proofly-pen-width");
        if (saved) {
          const width = JSON.parse(saved) as PenWidth;
          // Validate that it's a valid pen width (matches Toolbar options: 2, 4, 6, 8, 10)
          const validWidths: PenWidth[] = [2, 4, 6, 8, 10];
          if (validWidths.includes(width)) {
            console.log("[Content] Loaded pen width from localStorage:", width);
            return width;
          }
        }
      } catch (error) {
        console.error("[Content] Failed to load pen width from localStorage:", error);
      }
      return 4; // Default pen width (matches toolbar options: 2, 4, 6, 8, 10)
    };

    const updateCanvasSize = () => {
      if (!canvas) return;
      
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
      );
      const docWidth = Math.max(
        document.body.scrollWidth,
        document.body.offsetWidth,
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
        document.documentElement.offsetWidth
      );
      
      canvas.width = docWidth;
      canvas.height = docHeight;
      canvas.style.width = `${docWidth}px`;
      canvas.style.height = `${docHeight}px`;
    };

    const initCanvas = () => {
  if (canvas) return;

  canvas = document.createElement("canvas");
  canvas.id = "proofly-canvas";
  
  // Calculate full document size for scrollable content
  const docHeight = Math.max(
    document.body.scrollHeight,
    document.body.offsetHeight,
    document.documentElement.clientHeight,
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight
  );
  const docWidth = Math.max(
    document.body.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.clientWidth,
    document.documentElement.scrollWidth,
    document.documentElement.offsetWidth
  );
  
  // Canvas internal size matches document dimensions for coordinate system
  canvas.width = docWidth;
  canvas.height = docHeight;
  
  // Canvas display size - absolute positioned to cover full document
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: ${docWidth}px;
    height: ${docHeight}px;
    margin: 0;
    padding: 0;
    border: 0;
    pointer-events: none;
    overflow: hidden;
    display: block;
    box-sizing: border-box;
  `;

  ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Append canvas to overlay container
  const overlay = document.getElementById("proofly-overlay");
  if (overlay) {
    overlay.appendChild(canvas);
  }

  window.addEventListener("resize", () => {
    if (canvas) {
      updateCanvasSize();
      if (redrawAllRef) redrawAllRef();
    }
  });
      
  // Update canvas size when content changes
  const observer = new MutationObserver(() => {
    if (canvas) {
      updateCanvasSize();
      if (redrawAllRef) redrawAllRef();
    }
  });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    };

    const findAnnotationAtPoint = (x: number, y: number): number => {
      // Check annotations in reverse order (most recent first)
      const itemsToCheck = historyIndex === null 
        ? drawingHistory 
        : drawingHistory.slice(0, historyIndex);
      
      for (let i = itemsToCheck.length - 1; i >= 0; i--) {
        const drawing = itemsToCheck[i];
        const hitThreshold = 10; // pixels
        
        if ((drawing.type === "pen" || drawing.type === "highlighter") && drawing.path) {
          // Check if point is near any segment of the pen path
          for (let j = 0; j < drawing.path.length - 1; j++) {
            const p1 = drawing.path[j];
            const p2 = drawing.path[j + 1];
            const dist = distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            if (dist < hitThreshold) {
              return i;
            }
      }
    } else if (drawing.type === "shape" && drawing.end) {
          // Check if point is within shape bounds
          const minX = Math.min(drawing.start.x, drawing.end.x);
          const maxX = Math.max(drawing.start.x, drawing.end.x);
          const minY = Math.min(drawing.start.y, drawing.end.y);
          const maxY = Math.max(drawing.start.y, drawing.end.y);
          
          if (x >= minX - hitThreshold && x <= maxX + hitThreshold &&
              y >= minY - hitThreshold && y <= maxY + hitThreshold) {
            return i;
          }
        } else if (drawing.type === "text") {
          // Text is handled via HTML elements, skip here
          continue;
        }
      }
      return -1;
    };

    const distanceToLineSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      
      if (lengthSquared === 0) {
        // Point to point distance
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
      }
      
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      
      return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
    };

    // Handler functions are now defined inside the AnnotationOverlay component using useCallback

    const cleanupCanvas = () => {
  if (canvas && canvas.parentNode) {
    canvas.parentNode.removeChild(canvas);
    canvas = null;
    ctx = null;
  }
  drawingHistory.length = 0;
      historyIndex = null;
    };

    const AnnotationOverlay = () => {
  const [activeTool, setActiveTool] = React.useState<Tool>(null);
  const [selectedColor, setSelectedColor] = React.useState<Color>("white");
  const [shapeMode, setShapeMode] = React.useState<ShapeMode>("outline");
      const [penWidth, setPenWidthState] = React.useState<PenWidth>(loadPenWidthFromLocalStorage());
      
      // Wrapper function to save pen width to localStorage when it changes
      const setPenWidth = React.useCallback((width: PenWidth) => {
        setPenWidthState(width);
        savePenWidthToLocalStorage(width);
      }, []);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [startPoint, setStartPoint] = React.useState({ x: 0, y: 0 });
  const [currentPoint, setCurrentPoint] = React.useState({ x: 0, y: 0 });
  const [currentPenPath, setCurrentPenPath] = React.useState<
    Array<{ x: number; y: number }>
  >([]);
      const [textInput, setTextInput] = React.useState<{
        visible: boolean;
        x: number;
        y: number;
        editingIndex?: number; // Index of text in history if editing existing text
      } | null>(null);
      const [draggingText, setDraggingText] = React.useState<{
        index: number;
        offsetX: number;
        offsetY: number;
      } | null>(null);
      const [draggingAnnotation, setDraggingAnnotation] = React.useState<{
        index: number;
        offsetX: number;
        offsetY: number;
      } | null>(null);

  // Redraw all function - needs to be inside component to access customColor
  const redrawAll = React.useCallback(() => {
    if (!ctx || !canvas) {
      console.warn("[Content] redrawAll: canvas or ctx not available");
      return;
    }

    console.log("[Content] redrawAll: clearing and redrawing", drawingHistory.length, "items");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw only up to the current history index
    const itemsToDraw = historyIndex === null 
      ? drawingHistory 
      : drawingHistory.slice(0, historyIndex);

    itemsToDraw.forEach((drawing) => {
      if (drawing.type === "pen" && drawing.path && drawing.path.length > 1) {
        for (let i = 1; i < drawing.path.length; i++) {
          drawLine(ctx!, drawing.path[i - 1], drawing.path[i], drawing.color, drawing.penWidth || 3);
        }
      } else if (drawing.type === "highlighter" && drawing.path && drawing.path.length > 1) {
        // Draw highlighter as a continuous path for smooth highlighting
        drawHighlighterPath(ctx!, drawing.path, drawing.color, drawing.penWidth || 3);
      } else if (drawing.type === "shape" && drawing.end) {
        drawShape(
          ctx!,
          drawing.tool,
          drawing.start,
          drawing.end,
          drawing.color,
          drawing.shapeMode || "outline",
          drawing.penWidth || 3
        );
      } else if (drawing.type === "text" && drawing.text) {
        // Text is rendered as HTML elements, not on canvas
        // Skip canvas drawing for text
      }
    });
  }, []);

  // Set redrawAll reference for external callers
  React.useEffect(() => {
    redrawAllRef = redrawAll;
  }, [redrawAll]);

  // Define handlers using useCallback to avoid initialization issues
  const handleUndo = React.useCallback(() => {
    if (drawingHistory.length === 0) return;
    
    // If showing all items, hide the last one
    if (historyIndex === null) {
      historyIndex = drawingHistory.length - 1; // Show all but last item
    } else if (historyIndex > 0) {
      historyIndex--; // Hide one more item
    }
    // If historyIndex reaches 0, we've undone everything
    redrawAll();
    saveToLocalStorage();
  }, []);

  const handleRedo = React.useCallback(() => {
    // If we've undone something, show one more item
    if (historyIndex !== null && historyIndex < drawingHistory.length) {
      historyIndex++;
      // If we've redone everything, show all items
      if (historyIndex === drawingHistory.length) {
        historyIndex = null;
      }
      redrawAll();
      saveToLocalStorage();
    }
  }, []);

  const handleClearAll = React.useCallback(() => {
    drawingHistory.length = 0;
    historyIndex = null;
    redrawAll();
  }, []);

  const handleScreenshot = React.useCallback(async () => {
    if (!canvas) return;
    
    // Show Apple-like flash animation immediately for user feedback
    const flashOverlay = document.createElement("div");
    flashOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: white;
      opacity: 0;
      z-index: 9999999;
      pointer-events: none;
      animation: flash 0.25s ease-out;
    `;
    document.body.appendChild(flashOverlay);
    
    // Remove flash overlay after animation
    setTimeout(() => {
      if (flashOverlay.parentNode) {
        flashOverlay.parentNode.removeChild(flashOverlay);
      }
    }, 250);
    
    // Trigger screenshot capture
    console.log("[Content] Sending downloadScreenshot message");
    
    // Check if background script is available
    if (!chrome.runtime?.id) {
      console.error("[Content] Chrome runtime not available");
      alert("Extension runtime not available. Please reload the extension.");
      return;
    }
    
    chrome.runtime.sendMessage({ action: "downloadScreenshot" }, (response) => {
      console.log("[Content] Received response:", response);
      if (chrome.runtime.lastError) {
        console.error("[Content] Screenshot error:", chrome.runtime.lastError);
        alert(`Screenshot failed: ${chrome.runtime.lastError.message}\n\nPlease check the background script console (chrome://extensions -> Service Worker) for more details.`);
      } else if (response?.success) {
        console.log("[Content] Screenshot captured and downloaded successfully");
      } else if (response?.error) {
        console.error("[Content] Screenshot error:", response.error);
        alert(`Screenshot failed: ${response.error}`);
      } else {
        console.warn("[Content] No response or success flag from background script");
        console.warn("[Content] This might mean the background script isn't running. Check chrome://extensions -> Service Worker");
        alert("No response from background script. Please check the Service Worker console (chrome://extensions -> your extension -> Service Worker).");
      }
    });
  }, []);

  const handleDownload = React.useCallback(async () => {
    if (!canvas) return;
    
    // Show Apple-like flash animation
    const flashOverlay = document.createElement("div");
    flashOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: white;
      opacity: 0;
      z-index: 9999999;
      pointer-events: none;
      animation: flash 0.25s ease-out;
    `;
    document.body.appendChild(flashOverlay);
    
    setTimeout(() => {
      if (flashOverlay.parentNode) {
        flashOverlay.parentNode.removeChild(flashOverlay);
      }
    }, 250);
    
    console.log("[Content] Sending downloadFullPage message");
    chrome.runtime.sendMessage({ action: "downloadFullPage" }, (response) => {
      console.log("[Content] Received response:", response);
      if (chrome.runtime.lastError) {
        console.error("[Content] Full page capture error:", chrome.runtime.lastError);
        alert(`Full page capture failed: ${chrome.runtime.lastError.message}`);
      } else if (response?.success) {
        console.log("[Content] Full page captured and downloaded successfully");
      } else if (response?.error) {
        console.error("[Content] Full page capture error:", response.error);
        alert(`Full page capture failed: ${response.error}`);
      }
    });
  }, []);

  React.useEffect(() => {
    initCanvas();
    // Load annotations from localStorage after canvas is initialized
    if (loadFromLocalStorage()) {
      // Small delay to ensure canvas is fully ready
      setTimeout(() => {
    redrawAll();
      }, 100);
    } else {
      redrawAll();
    }
  }, []);

  React.useEffect(() => {
      // Change cursor and pointer-events on extension overlay
      const overlay = document.getElementById("proofly-overlay");
      if (overlay) {
        if (activeTool === "move") {
          overlay.setAttribute("data-cursor", "move");
        } else if (activeTool === "eraser") {
          overlay.setAttribute("data-cursor", "pointer");
        } else if (activeTool === "pen" || activeTool === "highlighter" || activeTool === "text") {
          overlay.setAttribute("data-cursor", "crosshair");
      } else if (activeTool) {
          overlay.setAttribute("data-cursor", "crosshair");
      } else {
          overlay.removeAttribute("data-cursor");
      }
      
      // Only allow pointer events when a tool is active, otherwise let clicks pass through
      // IMPORTANT: Set pointer-events on overlay, not just canvas, so events can reach canvas
      if (activeTool) {
        // Enable pointer events on overlay so events can reach canvas
        overlay.style.pointerEvents = "auto";
        // Enable pointer events on canvas when tool is active
        const canvasElement = document.getElementById("proofly-canvas") as HTMLCanvasElement;
        if (canvasElement) {
          canvasElement.style.pointerEvents = "auto";
          console.log("[Content] Pointer-events enabled - overlay and canvas for tool:", activeTool);
        } else {
          console.warn("[Content] Canvas element not found in DOM!");
        }
      } else {
        overlay.style.pointerEvents = "none";
        const canvasElement = document.getElementById("proofly-canvas") as HTMLCanvasElement;
        if (canvasElement) {
          canvasElement.style.pointerEvents = "none";
        }
      }
    }
    
    // Apply cursor to page elements when tool is active (minimal, scoped CSS)
    const isDrawingTool = activeTool === "pen" || activeTool === "highlighter" || activeTool === "text" || 
                          activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow";
    
    // Inject minimal cursor styles only when needed (removed when tool is deselected)
    let cursorStyle = document.getElementById("proofly-cursor-style");
    if (activeTool && !cursorStyle) {
      cursorStyle = document.createElement("style");
      cursorStyle.id = "proofly-cursor-style";
      let cursorValue = "default";
      if (activeTool === "move") cursorValue = "move";
      else if (activeTool === "eraser") cursorValue = "pointer";
      else if (isDrawingTool) cursorValue = "crosshair";
      
      cursorStyle.textContent = `
        body *:not(input):not(textarea):not([contenteditable="true"]):not(button):not(a) {
          cursor: ${cursorValue} !important;
        }
      `;
      document.head.appendChild(cursorStyle);
    } else if (!activeTool && cursorStyle) {
      cursorStyle.remove();
    } else if (activeTool && cursorStyle) {
      // Update cursor if tool changed
      let cursorValue = "default";
      if (activeTool === "move") cursorValue = "move";
      else if (activeTool === "eraser") cursorValue = "pointer";
      else if (isDrawingTool) cursorValue = "crosshair";
      cursorStyle.textContent = `
        body *:not(input):not(textarea):not([contenteditable="true"]):not(button):not(a) {
          cursor: ${cursorValue} !important;
        }
      `;
    }
    
    // Disable text selection when drawing (minimal, scoped)
    let selectionStyle = document.getElementById("proofly-selection-style");
    if (isDrawingTool && !selectionStyle) {
      selectionStyle = document.createElement("style");
      selectionStyle.id = "proofly-selection-style";
      selectionStyle.textContent = `
        body *:not(input):not(textarea):not([contenteditable="true"]) {
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
          user-select: none !important;
        }
      `;
      document.head.appendChild(selectionStyle);
    } else if (!isDrawingTool && selectionStyle) {
      selectionStyle.remove();
    }
  }, [activeTool]);

      // Keyboard shortcuts - only active when extension is enabled
      React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
          // Handle shortcuts (extension is always enabled)
          
          // Don't handle shortcuts if user is typing in an input
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement ||
            (e.target as HTMLElement).isContentEditable
          ) {
            return;
          }

          // Check if it's one of our shortcut keys
          const shortcutKeys = ["p", "h", "t", "m", "s", "z", "y", "x", "c", "d", "e"];
          const isShortcutKey = shortcutKeys.includes(e.key.toLowerCase()) || 
                                ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "y"));

          if (isShortcutKey) {
            // Prevent default and stop propagation early for all shortcuts
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
          }

          // Handle Ctrl/Cmd + Z for undo/redo
          if (e.ctrlKey || e.metaKey) {
            if (e.key === "z" && !e.shiftKey) {
              handleUndo();
              return;
            } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
              handleRedo();
              return;
            }
            return;
          }

          // Handle single key shortcuts
          switch (e.key.toLowerCase()) {
            case "p":
              setActiveTool(activeTool === "pen" ? null : "pen");
              break;
            case "h":
              setActiveTool(activeTool === "highlighter" ? null : "highlighter");
              break;
            case "t":
              setActiveTool(activeTool === "text" ? null : "text");
              break;
            case "m":
              setActiveTool(activeTool === "move" ? null : "move");
              break;
            case "s":
              // Toggle shapes menu or select rectangle
              if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
                setActiveTool(null);
              } else {
                setActiveTool("rectangle");
              }
              break;
            case "z":
              handleUndo();
              break;
            case "y":
              handleRedo();
              break;
            case "x":
              handleClearAll();
              break;
            case "e":
              setActiveTool(activeTool === "eraser" ? null : "eraser");
              break;
            case "c":
              handleScreenshot();
              break;
            case "d":
              handleDownload();
              break;
          }
        };

        // Use capture phase to intercept events early
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
          document.removeEventListener("keydown", handleKeyDown, true);
        };
      }, [activeTool, handleUndo, handleRedo, handleClearAll, handleScreenshot, handleDownload]);

  React.useEffect(() => {
    if (!ctx || !canvas) return;

    const handleMouseDown = (e: MouseEvent) => {
      console.log("[Content] MouseDown - activeTool:", activeTool, "target:", e.target, "canvas:", canvas, "ctx:", ctx);
      if (!activeTool) {
        console.log("[Content] No active tool, ignoring");
        return;
      }
      if (!canvas || !ctx) {
        console.error("[Content] Canvas or context not available!");
        return;
      }

          // Don't handle clicks on the toolbar or text input
          const target = e.target as HTMLElement;
          if (
            target.closest('.proofly-toolbar') || 
            target.closest('textarea')
          ) {
            return;
          }

          // Handle eraser clicks on text annotations
          if (activeTool === "eraser") {
            const textElement = target.closest('[data-proofly-text]');
            if (textElement) {
              const textIndex = parseInt(textElement.getAttribute('data-text-index') || '-1');
              if (textIndex >= 0 && textIndex < drawingHistory.length) {
                drawingHistory.splice(textIndex, 1);
                if (historyIndex !== null && historyIndex > textIndex) {
                  historyIndex--;
                }
                redrawAll();
                saveToLocalStorage();
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }
          }

          // Don't handle clicks on existing text elements (unless eraser is active)
          if (!activeTool || activeTool !== "eraser") {
            if (target.closest('[data-proofly-text]')) {
              return;
            }
          }

          // Use page coordinates - they match the canvas coordinate system (full document)
          const x = e.pageX;
          const y = e.pageY;
          console.log("[Content] MouseDown at page coords:", x, y, "canvas size:", canvas?.width, canvas?.height);

          if (activeTool === "text") {
            // For text, show input field at click position
            console.log("[Content] Text tool clicked at:", x, y);
            setTextInput({ visible: true, x, y });
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          if (activeTool === "eraser") {
            // Find which annotation was clicked and delete it
            const clickedIndex = findAnnotationAtPoint(x, y);
            if (clickedIndex !== -1) {
              // Remove the annotation from history
              drawingHistory.splice(clickedIndex, 1);
              // If we're in the middle of undo/redo, adjust historyIndex
              if (historyIndex !== null && historyIndex > clickedIndex) {
                historyIndex--;
              }
              redrawAll();
              saveToLocalStorage();
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            return;
          }

          if (activeTool === "move") {
            // Find which annotation was clicked
            const clickedIndex = findAnnotationAtPoint(x, y);
            if (clickedIndex !== -1) {
              const annotation = drawingHistory[clickedIndex];
              if ((annotation.type === "pen" || annotation.type === "highlighter") && annotation.path) {
                // Calculate offset from first point
                const firstPoint = annotation.path[0];
                setDraggingAnnotation({
                  index: clickedIndex,
                  offsetX: x - firstPoint.x,
                  offsetY: y - firstPoint.y,
                });
              } else if (annotation.type === "shape" && annotation.start) {
                // Calculate offset from start point
                setDraggingAnnotation({
                  index: clickedIndex,
                  offsetX: x - annotation.start.x,
                  offsetY: y - annotation.start.y,
                });
              } else if (annotation.type === "text") {
                // Text is handled separately via HTML elements
                setDraggingText({
                  index: clickedIndex,
                  offsetX: x - annotation.start.x,
                  offsetY: y - annotation.start.y,
                });
              }
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            return;
          }

      setIsDrawing(true);
      setStartPoint({ x, y });
      setCurrentPoint({ x, y });

      if (activeTool === "pen" || activeTool === "highlighter") {
        setCurrentPenPath([{ x, y }]);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDrawing || !activeTool || !ctx || !canvas) return;

      // Use page coordinates - they match the canvas coordinate system (full document)
      const x = e.pageX;
      const y = e.pageY;
      
      // Debug: log first few moves to verify coordinates
      if (currentPenPath.length < 3) {
        console.log("[Content] MouseMove - page:", x, y, "canvas:", canvas?.width, canvas?.height);
      }

      setCurrentPoint({ x, y });

      if (activeTool === "pen") {
        const newPath = [...currentPenPath, { x, y }];
        setCurrentPenPath(newPath);
        if (currentPenPath.length > 0) {
          const lastPoint = currentPenPath[currentPenPath.length - 1];
          // Ensure coordinates are within canvas bounds
          if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
            drawLine(ctx, lastPoint, { x, y }, selectedColor, penWidth);
          } else {
            console.warn("[Content] Coordinates out of bounds:", x, y, "canvas:", canvas.width, canvas.height);
          }
        }
      } else if (activeTool === "highlighter") {
        const newPath = [...currentPenPath, { x, y }];
        setCurrentPenPath(newPath);
        // Redraw the entire highlighter path for smooth continuous highlighting
        if (newPath.length > 1) {
          // Clear and redraw to avoid overlapping strokes
          redrawAll();
          drawHighlighterPath(ctx, newPath, selectedColor, penWidth);
        }
      } else {
        // Redraw all + current shape
        redrawAll();
            drawShape(ctx, activeTool, startPoint, { x, y }, selectedColor, shapeMode, penWidth);
      }
    };

    const handleMouseUp = () => {
      if (!isDrawing || !activeTool || !ctx || !canvas) return;

      if (activeTool === "pen" || activeTool === "highlighter") {
        // Save pen/highlighter path to history
        if (currentPenPath.length > 1) {
              // If we're in the middle of undo/redo, remove future items
              if (historyIndex !== null && historyIndex < drawingHistory.length) {
                drawingHistory.splice(historyIndex);
              }
          drawingHistory.push({
            type: activeTool === "pen" ? "pen" : "highlighter",
            tool: activeTool,
            start: currentPenPath[0],
            path: [...currentPenPath],
            color: selectedColor,
                penWidth: penWidth,
          });
              historyIndex = null; // Reset to show all items
              saveToLocalStorage();
        }
        setCurrentPenPath([]);
      } else {
        // Save shape to history
            // If we're in the middle of undo/redo, remove future items
            if (historyIndex !== null && historyIndex < drawingHistory.length) {
              drawingHistory.splice(historyIndex);
            }
        drawingHistory.push({
          type: "shape",
          tool: activeTool,
          start: startPoint,
          end: currentPoint,
          color: selectedColor,
          shapeMode,
              penWidth: penWidth,
        });
            historyIndex = null; // Reset to show all items
            saveToLocalStorage();
      }

      setIsDrawing(false);
      redrawAll();
    };

    // Attach handlers to canvas element - ensure canvas exists and is in DOM
    const canvasElement = document.getElementById("proofly-canvas") as HTMLCanvasElement;
    if (canvasElement && canvas && ctx) {
      console.log("[Content] Attaching event handlers to canvas element");
      canvasElement.addEventListener("mousedown", handleMouseDown, { passive: false });
      canvasElement.addEventListener("mousemove", handleMouseMove, { passive: false });
      canvasElement.addEventListener("mouseup", handleMouseUp, { passive: false });

    return () => {
        console.log("[Content] Removing event handlers from canvas");
        canvasElement.removeEventListener("mousedown", handleMouseDown);
        canvasElement.removeEventListener("mousemove", handleMouseMove);
        canvasElement.removeEventListener("mouseup", handleMouseUp);
      };
    } else {
      console.warn("[Content] Canvas not ready - element:", !!canvasElement, "canvas:", !!canvas, "ctx:", !!ctx);
      // Don't attach to document as fallback - wait for canvas to be ready
      return () => {};
    }
  }, [
    activeTool,
    isDrawing,
    startPoint,
    currentPoint,
    selectedColor,
    shapeMode,
    currentPenPath,
        penWidth,
      ]);


  const handleShapeModeToggle = () => {
    setShapeMode((prev) => (prev === "outline" ? "filled" : "outline"));
  };

  // Listen for canvas data requests
  React.useEffect(() => {
    const listener = (
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      if (message.action === "getCanvasData") {
        if (canvas) {
        const dataUrl = canvas.toDataURL("image/png");
        sendResponse({ canvasData: dataUrl });
        } else {
          sendResponse({ canvasData: null });
        }
        return true;
      }
      
      if (message.action === "captureFullPage") {
        // Handle full page capture: scroll 100vh at a time, capture each section, combine into PDF
        (async () => {
          let originalScrollX = 0;
          let originalScrollY = 0;
          let progressOverlay: HTMLElement | null = null;
          
          // Function to show preview modal
          const showPreviewModal = (pdfDataUrl: string, imageDataUrl: string, width: number, height: number) => {
            // Remove any existing modal
            const existingModal = document.getElementById("proofly-preview-modal");
            if (existingModal) {
              existingModal.remove();
            }
            
            // Create full screen modal
            const modal = document.createElement("div");
            modal.id = "proofly-preview-modal";
            modal.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              width: 100vw;
              height: 100vh;
              background: rgba(0, 0, 0, 0.95);
              z-index: 10000001;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              padding: 20px;
              box-sizing: border-box;
            `;
            
            // Create header with title and buttons
            const header = document.createElement("div");
            header.style.cssText = `
              width: 100%;
              max-width: 90vw;
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 20px;
              padding: 0 20px;
            `;
            
            const title = document.createElement("h2");
            title.textContent = "Full Page Preview";
            title.style.cssText = `
              color: white;
              font-family: Arial, sans-serif;
              font-size: 24px;
              font-weight: bold;
              margin: 0;
            `;
            
            const buttonContainer = document.createElement("div");
            buttonContainer.style.cssText = `
              display: flex;
              gap: 12px;
            `;
            
            // Download button
            const downloadBtn = document.createElement("button");
            downloadBtn.textContent = "Download PDF";
            downloadBtn.style.cssText = `
              background: #ff6b35;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              font-family: Arial, sans-serif;
              transition: background 0.2s;
            `;
            downloadBtn.onmouseover = () => {
              downloadBtn.style.background = "#e55a2b";
            };
            downloadBtn.onmouseout = () => {
              downloadBtn.style.background = "#ff6b35";
            };
            downloadBtn.onclick = async () => {
              // Get page title for filename
              const pageTitle = document.title || "page";
              const sanitizedTitle = pageTitle
                .replace(/[^a-z0-9]/gi, "-")
                .toLowerCase()
                .substring(0, 50);
              const date = new Date().toISOString().split("T")[0];
              const filename = `proofly-fullscreen-${sanitizedTitle}-${date}.pdf`;
              
              // Create download link
              const link = document.createElement("a");
              link.href = pdfDataUrl;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              
              // Close modal after download
              modal.remove();
              document.removeEventListener("keydown", handleEscape);
            };
            
            // Close button
            const closeBtn = document.createElement("button");
            closeBtn.textContent = "Close";
            closeBtn.style.cssText = `
              background: rgba(255, 255, 255, 0.1);
              color: white;
              border: 1px solid rgba(255, 255, 255, 0.2);
              padding: 12px 24px;
              border-radius: 8px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              font-family: Arial, sans-serif;
              transition: background 0.2s;
            `;
            closeBtn.onmouseover = () => {
              closeBtn.style.background = "rgba(255, 255, 255, 0.2)";
            };
            closeBtn.onmouseout = () => {
              closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
            };
            
            // Close on Escape key
            const handleEscape = (e: KeyboardEvent) => {
              if (e.key === "Escape") {
                modal.remove();
                document.removeEventListener("keydown", handleEscape);
              }
            };
            
            closeBtn.onclick = () => {
              modal.remove();
              document.removeEventListener("keydown", handleEscape);
            };
            
            buttonContainer.appendChild(downloadBtn);
            buttonContainer.appendChild(closeBtn);
            header.appendChild(title);
            header.appendChild(buttonContainer);
            
            // Create preview container
            const previewContainer = document.createElement("div");
            previewContainer.style.cssText = `
              width: 100%;
              max-width: 90vw;
              height: calc(100vh - 120px);
              overflow: auto;
              background: white;
              border-radius: 8px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
              box-sizing: border-box;
            `;
            
            // Create image to show preview
            const previewImg = document.createElement("img");
            previewImg.src = imageDataUrl;
            previewImg.style.cssText = `
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
              border-radius: 4px;
            `;
            previewImg.alt = "Full page preview";
            
            // Also allow clicking to download
            previewImg.style.cursor = "pointer";
            previewImg.title = "Click to download";
            previewImg.onclick = () => {
              downloadBtn.click();
            };
            
            previewContainer.appendChild(previewImg);
            
            modal.appendChild(header);
            modal.appendChild(previewContainer);
            
            document.addEventListener("keydown", handleEscape);
            
            // Close on background click
            modal.onclick = (e) => {
              if (e.target === modal) {
                modal.remove();
                document.removeEventListener("keydown", handleEscape);
              }
            };
            
            document.body.appendChild(modal);
          };
          
          // Declare fixed/sticky elements array outside try block for error handling
          let fixedStickyElements: Array<{ element: HTMLElement; originalDisplay: string; originalVisibility: string }> = [];
          
          try {
            const { pageWidth, pageHeight, viewportWidth, viewportHeight } = message;
            
            // Store viewport dimensions for use in stitching
            const viewportW = viewportWidth;
            const viewportH = viewportHeight;
            
            // Create progress overlay with better styling
            progressOverlay = document.createElement("div");
            progressOverlay.style.cssText = `
              position: fixed;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              background: rgba(0, 0, 0, 0.9);
              color: white;
              padding: 24px 32px;
              border-radius: 12px;
              z-index: 10000000;
              font-family: Arial, sans-serif;
              font-size: 16px;
              box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
              min-width: 300px;
              text-align: center;
            `;
            document.body.appendChild(progressOverlay);
            
            const updateProgress = (current: number, total: number, phase: string, detail?: string) => {
              if (progressOverlay) {
                const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
                progressOverlay.innerHTML = `
                  <div style="font-size: 18px; font-weight: bold; margin-bottom: 12px;">${phase}</div>
                  <div style="font-size: 14px; margin-bottom: 8px;">${detail || `${current} / ${total} screenshots`}</div>
                  <div style="background: rgba(255, 255, 255, 0.2); border-radius: 4px; height: 8px; margin-top: 12px; overflow: hidden;">
                    <div style="background: #4CAF50; height: 100%; width: ${percentage}%; transition: width 0.3s;"></div>
                  </div>
                  <div style="font-size: 12px; margin-top: 8px; opacity: 0.8;">${percentage}%</div>
                `;
              }
            };
            
            // Save current scroll position
            originalScrollX = window.scrollX || 0;
            originalScrollY = window.scrollY || 0;
            
            // Create canvas for the full stitched image
            const fullCanvas = document.createElement("canvas");
            fullCanvas.width = pageWidth;
            fullCanvas.height = pageHeight;
            const fullCtx = fullCanvas.getContext("2d", { 
              alpha: false, // No transparency needed for screenshots, improves performance
              desynchronized: false, // Ensure high quality rendering
              willReadFrequently: false // Optimize for drawing, not reading
            });
            
            if (!fullCtx) {
              chrome.runtime.sendMessage({ action: "fullPageCaptureResult", error: "Failed to create canvas context" });
              return;
            }
            
            // Enable high-quality image rendering
            fullCtx.imageSmoothingEnabled = true;
            fullCtx.imageSmoothingQuality = "high"; // Use highest quality smoothing
            
            // Get actual page dimensions
            const actualPageHeight = Math.max(
              document.body.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight
            );
            const actualViewportHeight = window.innerHeight;
            const actualPageWidth = Math.max(
              document.body.scrollWidth,
              document.body.offsetWidth,
              document.documentElement.clientWidth,
              document.documentElement.scrollWidth,
              document.documentElement.offsetWidth,
              viewportWidth
            );
            
            // Calculate how many screenshots we need (scroll 100vh at a time)
            const totalScreenshots = Math.ceil(actualPageHeight / actualViewportHeight);
            
            console.log(`[Content] Page height: ${actualPageHeight}px, Viewport height: ${actualViewportHeight}px`);
            console.log(`[Content] Will capture ${totalScreenshots} screenshots (scrolling 100vh at a time)`);
            
            updateProgress(0, totalScreenshots, "Preparing...", "Starting capture");
            
            // Update canvas size to match actual page dimensions
            fullCanvas.width = actualPageWidth;
            fullCanvas.height = actualPageHeight;
            fullCtx.clearRect(0, 0, actualPageWidth, actualPageHeight);
            fullCtx.fillStyle = "#ffffff";
            fullCtx.fillRect(0, 0, actualPageWidth, actualPageHeight);
            
            // Scroll to top first
            window.scrollTo(0, 0);
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Find and handle fixed/sticky elements (headers, navbars, etc.)
            // These appear on every scroll position, so we need to hide them after the first capture
            // Initialize the array (it was declared outside try block)
            fixedStickyElements = [];
            
            // Find all elements with position: fixed or position: sticky
            const allElements = document.querySelectorAll('*');
            allElements.forEach((el) => {
              const htmlEl = el as HTMLElement;
              const computedStyle = window.getComputedStyle(htmlEl);
              const position = computedStyle.position;
              
              // Check if element is fixed or sticky
              if (position === 'fixed' || position === 'sticky') {
                // Skip elements that are likely not headers (e.g., tooltips, modals, our own overlay)
                const zIndex = parseInt(computedStyle.zIndex) || 0;
                const isOurOverlay = htmlEl.closest('#proofly-overlay') || htmlEl.id === 'proofly-overlay' || htmlEl.id === 'proofly-preview-modal';
                const isProgressOverlay = htmlEl === progressOverlay;
                
                // Only hide elements that are likely headers/navbars (typically at top, not too high z-index)
                // Or if they're sticky (which are often headers)
                if (!isOurOverlay && !isProgressOverlay && (position === 'sticky' || (position === 'fixed' && zIndex < 10000))) {
                  fixedStickyElements.push({
                    element: htmlEl,
                    originalDisplay: htmlEl.style.display || '',
                    originalVisibility: htmlEl.style.visibility || ''
                  });
                }
              }
            });
            
            console.log(`[Content] Found ${fixedStickyElements.length} fixed/sticky elements to handle`);
            
            // Function to hide fixed/sticky elements
            const hideFixedElements = () => {
              fixedStickyElements.forEach(({ element }) => {
                element.style.visibility = 'hidden';
              });
            };
            
            // Function to show fixed/sticky elements
            const showFixedElements = () => {
              fixedStickyElements.forEach(({ element }) => {
                element.style.visibility = '';
              });
            };
            
            // Function to restore original styles
            const restoreFixedElements = () => {
              fixedStickyElements.forEach(({ element, originalDisplay, originalVisibility }) => {
                element.style.display = originalDisplay;
                element.style.visibility = originalVisibility;
              });
            };
            
            // Capture each section by scrolling 100vh at a time
            const screenshots: Array<{ dataUrl: string; y: number }> = [];
            
            for (let i = 0; i < totalScreenshots; i++) {
              // Calculate scroll position (100vh increments)
              const scrollY = i * actualViewportHeight;
              
              // For the last screenshot, scroll to the bottom to capture remaining content
              const finalScrollY = i === totalScreenshots - 1 
                ? Math.max(0, actualPageHeight - actualViewportHeight)
                : scrollY;
              
              updateProgress(i, totalScreenshots, "Capturing screenshots...", `Section ${i + 1} of ${totalScreenshots}`);
              console.log(`[Content] Scrolling to position ${finalScrollY}px (screenshot ${i + 1}/${totalScreenshots})`);
              
              // Scroll to position
              window.scrollTo(0, finalScrollY);
              document.documentElement.scrollTop = finalScrollY;
              document.body.scrollTop = finalScrollY;
              
              // Wait for scroll and page to render
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Verify scroll position
              const currentScrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
              if (Math.abs(currentScrollY - finalScrollY) > 10) {
                console.warn(`[Content] Scroll mismatch! Expected ${finalScrollY}, got ${currentScrollY}. Retrying...`);
                window.scrollTo(0, finalScrollY);
                document.documentElement.scrollTop = finalScrollY;
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              // Hide fixed/sticky elements for all screenshots except the first one (where we capture the header)
              // For the first screenshot (scrollY = 0), keep them visible to capture the header once
              if (finalScrollY > 0) {
                hideFixedElements();
                // Wait a bit for the hide to take effect
                await new Promise(resolve => setTimeout(resolve, 100));
              } else {
                // First screenshot - show fixed elements to capture header
                showFixedElements();
              }
              
              // Hide progress overlay and toolbar before taking screenshot (so they don't appear in the capture)
              if (progressOverlay) {
                progressOverlay.style.display = 'none';
              }
              
              // Hide toolbar
              const toolbar = document.querySelector('.proofly-toolbar') as HTMLElement;
              let toolbarOriginalDisplay = '';
              if (toolbar) {
                toolbarOriginalDisplay = toolbar.style.display || '';
                toolbar.style.display = 'none';
              }
              
              // Hide arrow indicator (the chevron that peeks from the right edge)
              const arrowIndicator = document.querySelector('.proofly-arrow-indicator') as HTMLElement | null;
              let arrowOriginalDisplay = '';
              if (arrowIndicator) {
                arrowOriginalDisplay = arrowIndicator.style.display || '';
                arrowIndicator.style.display = 'none';
              }
              
              // Small delay to ensure overlay, toolbar, and arrow are hidden before capture
              await new Promise(resolve => setTimeout(resolve, 50));
              
              // Request screenshot for this viewport
              const screenshotData = await new Promise<string>((resolve, reject) => {
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
                      reject(new Error("No screenshot data received"));
                    }
                  }
                );
              });
              
              // Show progress overlay, toolbar, and arrow indicator again after screenshot is taken
              if (progressOverlay) {
                progressOverlay.style.display = 'block';
              }
              
              if (toolbar) {
                toolbar.style.display = toolbarOriginalDisplay;
              }
              
              if (arrowIndicator) {
                arrowIndicator.style.display = arrowOriginalDisplay;
              }
              
              // Show fixed elements again after capture (for next iteration)
              if (finalScrollY === 0) {
                // After first capture, hide them for subsequent captures
                hideFixedElements();
              }
              
              if (!screenshotData || screenshotData.length < 100) {
                console.error(`[Content] Invalid screenshot data for section ${i + 1}`);
                continue;
              }
              
              screenshots.push({
                dataUrl: screenshotData,
                y: finalScrollY
              });
              
              console.log(`[Content] ✓ Captured screenshot ${i + 1}/${totalScreenshots} at Y=${finalScrollY}px`);
            }
            
            // Restore fixed/sticky elements to their original state
            restoreFixedElements();
            
            // Sort screenshots by Y position (top to bottom)
            screenshots.sort((a, b) => a.y - b.y);
            
            updateProgress(0, screenshots.length, "Stitching screenshots...", "Combining images");
            console.log(`[Content] All ${screenshots.length} screenshots captured, starting to stitch...`);
            
            // Load and draw each screenshot sequentially onto the canvas
            for (let i = 0; i < screenshots.length; i++) {
              const screenshot = screenshots[i];
              if (!screenshot.dataUrl || screenshot.dataUrl.length < 100) {
                console.warn(`[Content] Skipping invalid screenshot ${i + 1}`);
                continue;
              }
              
              await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  try {
                    // Screenshot dimensions from Chrome API
                    const screenshotWidth = img.width;
                    const screenshotHeight = img.height;
                    
                    // Use the actual viewport dimensions (not page dimensions)
                    // These are the dimensions of the visible area we're capturing
                    const viewportWidth = viewportW;
                    const viewportHeight = viewportH;
                    
                    // Chrome's captureVisibleTab may capture at device pixel ratio
                    // We need to scale the screenshot to match the viewport size
                    // The screenshot might be 2x or 3x larger on high-DPI displays
                    const devicePixelRatio = window.devicePixelRatio || 1;
                    
                    // Calculate the scale needed to fit screenshot to viewport
                    // If screenshot is 2x viewport (due to DPR), we scale it down to 1x
                    const scaleX = viewportWidth / screenshotWidth;
                    const scaleY = viewportHeight / screenshotHeight;
                    
                    console.log(`[Content] Screenshot ${i + 1}: ${screenshotWidth}x${screenshotHeight}, Viewport: ${viewportWidth}x${viewportHeight}, DPR: ${devicePixelRatio}, Scale: ${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`);
                    
                    // Enable high-quality image rendering for this draw operation
                    const previousSmoothing = fullCtx.imageSmoothingEnabled;
                    const previousQuality = fullCtx.imageSmoothingQuality;
                    fullCtx.imageSmoothingEnabled = true;
                    fullCtx.imageSmoothingQuality = "high";
                    
                    // Draw the full screenshot, scaled to viewport size, at the correct Y position
                    // This ensures the entire screenshot is drawn without cropping
                    fullCtx.drawImage(
                      img, 
                      0, 0, screenshotWidth, screenshotHeight,  // Source: entire screenshot
                      0, screenshot.y, viewportWidth, viewportHeight  // Destination: scaled to viewport at Y position
                    );
                    
                    // Restore previous smoothing settings (though we keep them high)
                    fullCtx.imageSmoothingEnabled = previousSmoothing;
                    fullCtx.imageSmoothingQuality = previousQuality;
                    
                    updateProgress(i + 1, screenshots.length, "Stitching screenshots...", `Combined ${i + 1} of ${screenshots.length}`);
                    console.log(`[Content] ✓ Stitched screenshot ${i + 1}/${screenshots.length} at Y=${screenshot.y}px`);
                  } catch (drawError) {
                    console.error(`[Content] Error drawing screenshot ${i + 1}:`, drawError);
                  }
                  resolve();
                };
                img.onerror = (error) => {
                  console.warn(`[Content] ✗ Failed to load screenshot ${i + 1}:`, error);
                  resolve(); // Continue even if one fails
                };
                img.src = screenshot.dataUrl;
              });
            }
            
            console.log(`[Content] Finished stitching all screenshots. Canvas size: ${fullCanvas.width}x${fullCanvas.height}`);
            
            updateProgress(screenshots.length, screenshots.length, "Adding annotations...", "Drawing annotations");
            console.log(`[Content] Adding annotations to canvas...`);
            
            // Draw the annotation canvas on top
            if (canvas) {
              fullCtx.drawImage(canvas, 0, 0);
              console.log(`[Content] Annotations added`);
            }
            
            // Restore scroll position
            window.scrollTo(originalScrollX, originalScrollY);
            
            // Restore fixed/sticky elements (they were already restored after the loop, but ensure they're visible)
            // This is a safety check in case something went wrong
            fixedStickyElements.forEach(({ element }) => {
              element.style.visibility = '';
            });
            
            updateProgress(screenshots.length, screenshots.length, "Generating PDF...", "Creating PDF file");
            console.log("[Content] Converting stitched canvas to PDF...");
            
            // Always generate PDF for full page captures
            try {
              // Convert canvas to PDF
              // jsPDF has a maximum page size, so for very large pages we might need to scale
              // Maximum dimensions in points (1 point = 1/72 inch)
              // Standard PDF max is around 14400 points (200 inches)
              const maxDimension = 14400;
              let pdfWidth = actualPageWidth;
              let pdfHeight = actualPageHeight;
              let scale = 1;
              
              // Scale down if page is too large for PDF limits
              if (actualPageWidth > maxDimension || actualPageHeight > maxDimension) {
                scale = Math.min(maxDimension / actualPageWidth, maxDimension / actualPageHeight);
                pdfWidth = actualPageWidth * scale;
                pdfHeight = actualPageHeight * scale;
                console.log(`[Content] Page too large for PDF, scaling by ${scale.toFixed(2)} to ${pdfWidth}x${pdfHeight}`);
              }
              
              const pdf = new jsPDF({
                orientation: pdfWidth > pdfHeight ? 'landscape' : 'portrait',
                unit: 'px',
                format: [pdfWidth, pdfHeight],
                compress: true
              });
              
              // Convert canvas to image data URL
              // Use PNG format for maximum quality (lossless)
              // PNG provides the best quality, though it may result in larger file sizes
              const imageData = fullCanvas.toDataURL("image/png");
              
              // Add image to PDF at calculated size
              pdf.addImage(imageData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
              
              // Get PDF as data URL
              const pdfDataUrl = pdf.output('dataurlstring');
              console.log("[Content] Full page PDF generated successfully, size:", pdfDataUrl.length, "bytes");
              
              // Remove progress overlay
              if (progressOverlay && progressOverlay.parentNode) {
                progressOverlay.parentNode.removeChild(progressOverlay);
              }
              
              // Show preview modal instead of immediately downloading
              showPreviewModal(pdfDataUrl, imageData, actualPageWidth, actualPageHeight);
              
              // Send success response (but don't trigger download - preview modal handles it)
              chrome.runtime.sendMessage({ action: "fullPageCaptureResult", screenshotData: pdfDataUrl, isPDF: true, previewShown: true });
            } catch (pdfError: any) {
              console.error("[Content] PDF generation error:", pdfError);
              
              // Remove progress overlay
              if (progressOverlay && progressOverlay.parentNode) {
                progressOverlay.parentNode.removeChild(progressOverlay);
              }
              
              // Send error - don't fallback to PNG, user wants PDF
              chrome.runtime.sendMessage({ 
                action: "fullPageCaptureResult", 
                error: `PDF generation failed: ${pdfError.message}. Please try again or use a smaller page.` 
              });
            }
            
          } catch (error: any) {
            // Restore scroll position on error
            window.scrollTo(originalScrollX, originalScrollY);
            console.error("[Content] Full page capture error:", error);
            
            // Restore fixed/sticky elements on error (in case they were hidden)
            if (fixedStickyElements.length > 0) {
              fixedStickyElements.forEach(({ element, originalDisplay, originalVisibility }) => {
                element.style.display = originalDisplay;
                element.style.visibility = originalVisibility;
              });
            }
            
            // Restore toolbar on error (in case it was hidden)
            const toolbar = document.querySelector('.proofly-toolbar') as HTMLElement;
            if (toolbar && toolbar.style.display === 'none') {
              toolbar.style.display = '';
            }
            
            // Restore arrow indicator on error
            const arrowIndicator = document.querySelector('.proofly-arrow-indicator') as HTMLElement | null;
            if (arrowIndicator && arrowIndicator.style.display === 'none') {
              arrowIndicator.style.display = '';
            }
            
            // Remove progress overlay on error
            if (progressOverlay && progressOverlay.parentNode) {
              progressOverlay.parentNode.removeChild(progressOverlay);
            }
            
            chrome.runtime.sendMessage({ action: "fullPageCaptureResult", error: error.message });
          }
        })();
        return true; // Keep channel open for async response
      }
      
      return false;
    };

    // Removed toggle functionality - overlay is always visible
  }, []);

      // Can undo if we have items to hide (not at the beginning)
      const canUndo = drawingHistory.length > 0 && (historyIndex === null || historyIndex > 0);
      // Can redo if we've undone something (historyIndex is not null and not at the end)
      const canRedo = historyIndex !== null && historyIndex < drawingHistory.length;

      const handleTextSubmit = (text: string) => {
        if (!text.trim() || !textInput) return;

        // If we're in the middle of undo/redo, remove future items
        if (historyIndex !== null && historyIndex < drawingHistory.length) {
          drawingHistory.splice(historyIndex);
        }

        if (textInput.editingIndex !== undefined) {
          // Update existing text
          const index = textInput.editingIndex;
          if (index >= 0 && index < drawingHistory.length) {
            drawingHistory[index] = {
              ...drawingHistory[index],
              text: text.trim(),
              start: { x: textInput.x, y: textInput.y },
            };
          }
        } else {
          // Add new text
          drawingHistory.push({
            type: "text",
            tool: "text",
            start: { x: textInput.x, y: textInput.y },
            color: selectedColor,
            text: text.trim(),
          });
        }
        historyIndex = null; // Reset to show all items

        setTextInput(null);
        redrawAll();
        saveToLocalStorage();
      };

      const handleTextClick = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        // Only allow editing if text tool is selected
        if (activeTool !== "text") {
          return;
        }
        const textItem = drawingHistory[index];
        if (textItem && textItem.type === "text" && textItem.text) {
          setTextInput({
            visible: true,
            x: textItem.start.x,
            y: textItem.start.y,
            editingIndex: index,
          });
        }
      };

      const handleTextMouseDown = (e: React.MouseEvent, index: number) => {
        e.stopPropagation();
        const textItem = drawingHistory[index];
        if (textItem && textItem.type === "text") {
          // Only allow dragging if move tool is active
          if (activeTool === "move") {
            setDraggingText({
              index,
              offsetX: e.pageX - textItem.start.x,
              offsetY: e.pageY - textItem.start.y,
            });
          } else if (activeTool === "text") {
            // Only allow editing if text tool is active
            handleTextClick(e, index);
          }
          // If neither move nor text tool is active, do nothing
        }
      };

      React.useEffect(() => {
        if (!draggingText) return;

        const handleMouseMove = (e: MouseEvent) => {
          const textItem = drawingHistory[draggingText.index];
          if (textItem && textItem.type === "text") {
            // Update position based on mouse position minus offset
            const newX = e.pageX - draggingText.offsetX;
            const newY = e.pageY - draggingText.offsetY;
            drawingHistory[draggingText.index] = {
              ...textItem,
              start: { x: newX, y: newY },
            };
            redrawAll();
            saveToLocalStorage();
          }
        };

        const handleMouseUp = () => {
          setDraggingText(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

    return () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        };
      }, [draggingText]);

      React.useEffect(() => {
        if (!draggingAnnotation) return;

        const handleMouseMove = (e: MouseEvent) => {
          const annotation = drawingHistory[draggingAnnotation.index];
          if (!annotation) return;

          const newX = e.pageX - draggingAnnotation.offsetX;
          const newY = e.pageY - draggingAnnotation.offsetY;

          if ((annotation.type === "pen" || annotation.type === "highlighter") && annotation.path) {
            // Move all points in the path by the same offset
            const oldFirstPoint = annotation.path[0];
            const deltaX = newX - oldFirstPoint.x;
            const deltaY = newY - oldFirstPoint.y;
            
            const newPath = annotation.path.map(point => ({
              x: point.x + deltaX,
              y: point.y + deltaY,
            }));
            
            drawingHistory[draggingAnnotation.index] = {
              ...annotation,
              path: newPath,
              start: newPath[0],
            };
          } else if (annotation.type === "shape" && annotation.end) {
            // Move both start and end points by the same offset
            const oldStart = annotation.start;
            const deltaX = newX - oldStart.x;
            const deltaY = newY - oldStart.y;
            
            drawingHistory[draggingAnnotation.index] = {
              ...annotation,
              start: { x: newX, y: newY },
              end: {
                x: annotation.end.x + deltaX,
                y: annotation.end.y + deltaY,
              },
            };
          }
          
          redrawAll();
        };

        const handleMouseUp = () => {
          setDraggingAnnotation(null);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        return () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        };
      }, [draggingAnnotation]);

  return (
        <>
    <Toolbar
      activeTool={activeTool}
      selectedColor={selectedColor}
      shapeMode={shapeMode}
      onToolSelect={setActiveTool}
      onColorSelect={setSelectedColor}
      onShapeModeToggle={handleShapeModeToggle}
            penWidth={penWidth}
            onPenWidthChange={setPenWidth}
      onScreenshot={handleScreenshot}
      onDownload={handleDownload}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onClearAll={handleClearAll}
            canUndo={canUndo}
            canRedo={canRedo}
          />
          {/* Render text annotations as HTML elements */}
          {(historyIndex === null ? drawingHistory : drawingHistory.slice(0, historyIndex)).map((drawing, index) => {
            if (drawing.type === "text" && drawing.text && textInput?.editingIndex !== index) {
              return (
                <div
                  key={`text-${index}`}
                  data-proofly-text
                  data-text-index={index}
                  onClick={(e) => {
                    if (activeTool === "eraser") {
                      // Delete text annotation when eraser is active
                      drawingHistory.splice(index, 1);
                      if (historyIndex !== null && historyIndex > index) {
                        historyIndex--;
                      }
                      redrawAll();
                      saveToLocalStorage();
                      e.preventDefault();
                      e.stopPropagation();
                    } else {
                      handleTextClick(e, index);
                    }
                  }}
                  onMouseDown={(e) => {
                    if (activeTool === "eraser") {
                      e.preventDefault();
                      e.stopPropagation();
                    } else {
                      handleTextMouseDown(e, index);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: `${drawing.start.x}px`,
                    top: `${drawing.start.y}px`,
                    zIndex: 999997,
                    pointerEvents: "auto",
                    cursor: activeTool === "eraser" ? "pointer" : activeTool === "move" ? "move" : activeTool === "text" ? "pointer" : "default",
                    padding: "8px 12px",
                    fontSize: "14px",
                    fontFamily: "Arial, sans-serif",
                    color: "#333",
                    backgroundColor: "#FFF9C4",
                    border: "1px solid rgba(0, 0, 0, 0.1)",
                    borderRadius: "4px",
                    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                    whiteSpace: "pre-wrap",
                    wordWrap: "break-word",
                    maxWidth: "200px",
                    minWidth: "120px",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  {drawing.text}
                </div>
              );
            }
            return null;
          })}

          {textInput?.visible && (
            <div
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: `${textInput.x}px`,
                top: `${textInput.y}px`,
                zIndex: 1000000,
                pointerEvents: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <textarea
                autoFocus
                defaultValue={textInput.editingIndex !== undefined ? drawingHistory[textInput.editingIndex]?.text || "" : ""}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setTextInput(null);
                  }
                  // Enter creates new line, don't prevent default
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: "14px",
                  fontFamily: "Arial, sans-serif",
                  color: "#333",
                  backgroundColor: "#FFF9C4",
                  border: "1px solid rgba(0, 0, 0, 0.1)",
                  borderRadius: "4px",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
                  outline: "none",
                  minWidth: "150px",
                  minHeight: "60px",
                  maxWidth: "200px",
                  resize: "both",
                  pointerEvents: "auto",
                  userSelect: "text",
                  WebkitUserSelect: "text",
                  whiteSpace: "pre-wrap",
                  wordWrap: "break-word",
                }}
              />
              <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTextInput(null);
                  }}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: "rgba(255, 0, 0, 0.7)",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Discard"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const textarea = e.currentTarget.parentElement?.previousElementSibling as HTMLTextAreaElement;
                    if (textarea && textarea.value.trim()) {
                      handleTextSubmit(textarea.value);
                    } else {
                      if (textInput.editingIndex !== undefined) {
                        // If editing and empty, remove the text
                        drawingHistory.splice(textInput.editingIndex, 1);
                        historyIndex = null;
                        redrawAll();
                        saveToLocalStorage();
                      }
                      setTextInput(null);
                    }
                  }}
                  style={{
                    padding: "4px 8px",
                    backgroundColor: "rgba(0, 200, 0, 0.7)",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Save"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      );
    };

    // Simple container reference
    let overlayContainer: HTMLElement | null = null;

    const injectOverlay = () => {
      if (document.getElementById("proofly-overlay")) {
        console.log("[Content] Overlay already exists");
        return;
      }

      console.log("[Content] Injecting overlay");
      
      // Create simple container at end of body
      overlayContainer = document.createElement("div");
      overlayContainer.id = "proofly-overlay";
      
      // Overlay uses absolute positioning to cover full document
      // This allows canvas to scroll with page while staying isolated
      const updateOverlaySize = () => {
        if (!overlayContainer) return;
        const docHeight = Math.max(
          document.body.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.clientHeight,
          document.documentElement.scrollHeight,
          document.documentElement.offsetHeight
        );
        const docWidth = Math.max(
          document.body.scrollWidth,
          document.body.offsetWidth,
          document.documentElement.clientWidth,
          document.documentElement.scrollWidth,
          document.documentElement.offsetWidth
        );
        overlayContainer.style.cssText = `
          position: absolute;
    top: 0;
    left: 0;
          width: ${docWidth}px;
          height: ${docHeight}px;
          z-index: 2147483647;
    pointer-events: none;
          margin: 0;
          padding: 0;
          border: 0;
        `;
      };
      updateOverlaySize();
      
      // Update overlay size on resize and content changes
      const resizeHandler = () => {
        updateOverlaySize();
        if (canvas) {
          updateCanvasSize();
          if (redrawAllRef) redrawAllRef();
        }
      };
      window.addEventListener("resize", resizeHandler);
      
      // Watch for DOM changes that might affect document size
      const domObserver = new MutationObserver(() => {
        resizeHandler();
      });
      domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
      });
      
      // Append to end of body
      if (document.body) {
        document.body.appendChild(overlayContainer);
      } else {
        // Wait for body to be ready
        const bodyObserver = new MutationObserver((mutations, obs) => {
          if (document.body && overlayContainer) {
            document.body.appendChild(overlayContainer);
            obs.disconnect();
          }
        });
        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
      }

      // Initialize canvas inside the overlay container (wait for overlay to be in DOM)
      setTimeout(() => {
        initCanvas();
        
        // Verify canvas was created
        if (!canvas || !ctx) {
          console.error("[Content] Failed to initialize canvas!");
          return;
        }
        console.log("[Content] Canvas initialized:", {
          width: canvas.width,
          height: canvas.height,
          inDOM: !!document.getElementById("proofly-canvas")
        });
      }, 0);

      // Mount React
      const root = createRoot(overlayContainer);
  root.render(
    <React.StrictMode>
      <AnnotationOverlay />
    </React.StrictMode>
  );
      console.log("[Content] Overlay injected successfully");
    };

    // Inject overlay automatically on page load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
    injectOverlay();
      });
    } else {
    injectOverlay();
  }
    
    console.log("[Content] Annoted content script loaded and ready");
  },
});
