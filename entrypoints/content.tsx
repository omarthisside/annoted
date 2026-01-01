import { defineContentScript } from "wxt/sandbox";
import { drawShape, drawLine, getColorValue } from "../utils/canvas";
import type { Tool, Color, ShapeMode } from "../utils/types";

// Annotation data structure - uses document coordinates
interface Annotation {
  type: "pen" | "rectangle" | "circle" | "arrow";
  start: { x: number; y: number };
  end?: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  color: Color;
  shapeMode?: ShapeMode;
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
        if (ann.type === "pen" && ann.path) {
          ctx!.strokeStyle = getColorValue(ann.color);
          ctx!.lineWidth = 3;
          ctx!.lineJoin = "round";
          ctx!.lineCap = "round";
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
        } else if (ann.end) {
          // Shapes - convert to viewport coordinates
          const start = { x: ann.start.x - scrollX, y: ann.start.y - scrollY };
          const end = { x: ann.end.x - scrollX, y: ann.end.y - scrollY };
          // Only draw if visible in viewport
          if (
            (start.y >= -100 && start.y <= window.innerHeight + 100) ||
            (end.y >= -100 && end.y <= window.innerHeight + 100)
          ) {
            drawShape(ctx!, ann.type, start, end, ann.color, ann.shapeMode || "outline", 3);
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
        input.oninput = (e) => {
          text.text = (e.target as HTMLInputElement).value;
        };
        input.onblur = () => {
          if (!text.text.trim()) {
            const index = textAnnotations.findIndex((t) => t.id === text.id);
            if (index > -1) {
              textAnnotations.splice(index, 1);
              updateTextAnnotations();
            }
          }
        };
        div.appendChild(input);
        overlay.appendChild(div);
      });
    };

    // Simple toolbar
    const createToolbar = () => {
      const toolbar = document.createElement("div");
      toolbar.id = "annoted-toolbar";
      toolbar.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483648;
        background: white;
        padding: 12px 16px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        display: flex;
        gap: 12px;
        pointer-events: auto;
        font-family: Arial, sans-serif;
      `;

      const tools: Array<{ tool: Tool; label: string; shortcut?: string }> = [
        { tool: "pen", label: "Pen", shortcut: "P" },
        { tool: "rectangle", label: "Rect" },
        { tool: "circle", label: "Circle" },
        { tool: "arrow", label: "Arrow" },
        { tool: "text", label: "Text" },
        { tool: "move", label: "Move", shortcut: "M" },
      ];

      tools.forEach(({ tool, label, shortcut }) => {
        const btn = document.createElement("button");
        btn.textContent = shortcut ? `${label} (${shortcut})` : label;
        btn.style.cssText = `
          padding: 8px 12px;
          border: ${activeTool === tool ? "2px solid #000" : "1px solid #ccc"};
          background: ${activeTool === tool ? "#f0f0f0" : "white"};
          cursor: pointer;
          font-size: 14px;
        `;
        btn.onclick = () => {
          activeTool = activeTool === tool ? null : tool;
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          updateToolbar();
        };
        toolbar.appendChild(btn);
      });

      // Color picker
      const colorBtn = document.createElement("button");
      colorBtn.textContent = "Color";
      colorBtn.style.cssText = `
        padding: 8px 12px;
        border: 1px solid #ccc;
        background: white;
        cursor: pointer;
        font-size: 14px;
      `;
      const colors: Color[] = ["red", "blue", "yellow", "white"];
      let colorIndex = 0;
      colorBtn.onclick = () => {
        colorIndex = (colorIndex + 1) % colors.length;
        selectedColor = colors[colorIndex];
        colorBtn.style.borderColor = getColorValue(selectedColor);
      };
      colorBtn.style.borderColor = getColorValue(selectedColor);
      toolbar.appendChild(colorBtn);

      // Shape mode toggle (for shapes)
      const modeBtn = document.createElement("button");
      modeBtn.textContent = shapeMode === "outline" ? "Outline" : "Filled";
      modeBtn.style.cssText = `
        padding: 8px 12px;
        border: 1px solid #ccc;
        background: white;
        cursor: pointer;
        font-size: 14px;
      `;
      modeBtn.onclick = () => {
        shapeMode = shapeMode === "outline" ? "filled" : "outline";
        modeBtn.textContent = shapeMode === "outline" ? "Outline" : "Filled";
      };
      toolbar.appendChild(modeBtn);

      // Clear button
      const clearBtn = document.createElement("button");
      clearBtn.textContent = "Clear";
      clearBtn.style.cssText = `
        padding: 8px 12px;
        border: 1px solid #ccc;
        background: white;
        cursor: pointer;
        font-size: 14px;
      `;
      clearBtn.onclick = () => {
        annotations.length = 0;
        textAnnotations.length = 0;
    redrawAll();
        updateTextAnnotations();
      };
      toolbar.appendChild(clearBtn);

      overlay.appendChild(toolbar);
    };

    const updateToolbar = () => {
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) {
        toolbar.remove();
      }
      createToolbar();
    };

    // Mouse handlers - USE DOCUMENT COORDINATES (pageX/pageY)
    const handleMouseDown = (e: MouseEvent) => {
      if (!activeTool || !canvas || !ctx) return;
      if ((e.target as HTMLElement).closest("#annoted-toolbar")) return;

      // Use pageX/pageY for document coordinates
      const x = e.pageX;
      const y = e.pageY;

      if (activeTool === "text") {
        const id = `text-${Date.now()}`;
        textAnnotations.push({ id, x, y, text: "", color: selectedColor });
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
              return;
            }
          } else if (ann.path && ann.path.length > 0) {
            // Check if near pen path
            for (const point of ann.path) {
              const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
              if (dist < 20) {
                draggingAnnotation = i;
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

      if (activeTool === "pen") {
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
          text.x = x - draggingText.offsetX;
          text.y = y - draggingText.offsetY;
          updateTextAnnotations();
        }
        return;
      }

      if (draggingAnnotation !== null) {
        const ann = annotations[draggingAnnotation];
        const dx = x - (ann.end ? ann.end.x : ann.start.x);
        const dy = y - (ann.end ? ann.end.y : ann.start.y);
        
        ann.start.x += dx;
        ann.start.y += dy;
        if (ann.end) {
          ann.end.x += dx;
          ann.end.y += dy;
        }
        if (ann.path) {
          ann.path.forEach((p) => {
            p.x += dx;
            p.y += dy;
          });
        }
        redrawAll();
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      if (activeTool === "pen") {
        currentPath.push({ x, y });
        redrawAll();
        // Draw current path in viewport coordinates
        if (ctx) {
          ctx.strokeStyle = getColorValue(selectedColor);
          ctx.lineWidth = 3;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
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
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        // Preview shape in viewport coordinates
        redrawAll();
        if (ctx) {
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          const start = { x: startPoint.x - scrollX, y: startPoint.y - scrollY };
          const end = { x: x - scrollX, y: y - scrollY };
          drawShape(ctx, activeTool, start, end, selectedColor, shapeMode, 3);
        }
      }
    };

    const handleMouseUp = () => {
      if (draggingText) {
        draggingText = null;
        return;
      }

      if (draggingAnnotation !== null) {
        draggingAnnotation = null;
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      const x = mouse.x;
      const y = mouse.y;

      if (activeTool === "pen") {
        if (currentPath.length > 1) {
          annotations.push({
            type: "pen",
            start: currentPath[0],
            path: [...currentPath],
            color: selectedColor,
          });
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        annotations.push({
          type: activeTool,
          start: startPoint,
          end: { x, y },
          color: selectedColor,
          shapeMode,
        });
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
      createToolbar();

      if (!canvas || !ctx) return;

      // Enable pointer events
      overlay.style.pointerEvents = "auto";
      canvas.style.pointerEvents = "auto";

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

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        activeTool = activeTool === "pen" ? null : "pen";
        if (canvas) {
          canvas.style.pointerEvents = activeTool ? "auto" : "none";
        }
        updateToolbar();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        activeTool = activeTool === "move" ? null : "move";
        if (canvas) {
          canvas.style.pointerEvents = activeTool ? "auto" : "none";
        }
        updateToolbar();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Listen for activation message
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "toggle") {
        if (isActive) {
          deactivate();
    } else {
          activate();
        }
        sendResponse({ active: isActive });
      }
      return true;
    });
  },
});
